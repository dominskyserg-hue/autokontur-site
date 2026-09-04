// ============================================================
// Імпорт TecDoc → tecdoc_crosses / tecdoc_compatibility, ЛИШЕ для
// артикулів, які реально є у вашому каталозі (products.article) —
// не весь каталог TecDoc (десятки мільйонів деталей), а тільки те,
// що стосується того, що ви продаєте.
//
// Схема РЕАЛЬНОГО дампу (tecdoc2016q1.sql, HeidiSQL/MySQL-експорт
// без жодного CREATE TABLE — з'ясована ЕМПІРИЧНО, по зразках рядків,
// офіційної документації немає):
//
//   articles(id, article_number, brand_id, ...)
//   brands(id, code, full_name, ...)
//   manufacturers(id, ..., code, full_name, ...)   — марки авто
//   models(id, manufacturer_id, tecdoc_code, year_from_yyyymm,
//          year_to_yyyymm, ...)
//   art_lookup(article_id, clean_number, type_byte, other_brand_id,
//              raw_number, ...)                     — кроси/OEM
//   link_art(id, article_id, ?, model_id)            — застосовність
//            до моделі авто (без деталізації двигун/рік — модель ще
//            є 147-мільйонна таблиця link_la_typ з точнішою
//            прив'язкою до модифікації, її семантику по 4 рядках
//            надійно не розібрати — свідомо не використовується)
//
// Двофазний алгоритм (обидві фази — весь час стрімінг, RAM обмежена):
//
//   ФАЗА 1 (scripts/tecdoc/referenceData.ts) — ОДИН прохід по дампу.
//     Тримає в пам'яті ЛИШЕ: brands (3068 рядків), manufacturers
//     (657), models (12 500) — усі крихітні — і "matchedArticles":
//     tecdoc article_id -> {brand, article} ЛИШЕ для рядків articles,
//     чий очищений артикул є у вашому products.article. Це і є те
//     звуження, що не дає пам'яті рости з розміром TecDoc (5 млн
//     articles), а лише з розміром ВАШОГО каталогу
//
//   ФАЗА 2 (нижче) — ДРУГИЙ прохід по дампу. Стрімить дві найбільші
//     таблиці (art_lookup 64,8 млн рядків, link_art 21,2 млн рядків),
//     для кожного рядка перевіряє належність article_id до
//     matchedArticles (просте O(1) звернення до Map) і ОДРАЗУ пише
//     збіги пакетами в Supabase — рядки, що не стосуються вашого
//     каталогу, просто пропускаються, у пам'яті не накопичуються
//
// Через те, що дамп доводиться читати ДВІЧІ (фаза 1 + фаза 2),
// повний прогін на 11+ ГБ файлі займає порядку 20-35 хвилин — це
// нормально для одноразового скрипта наповнення бази
//
// ПЕРЕД ЗАПУСКОМ: застосуйте scripts/tecdoc/schema.sql у Supabase
// (якщо ще не застосовували)
//
// Запуск: npx tsx scripts/tecdoc/import-dump.ts шлях/до/дампа.sql
// (або npm run tecdoc:import -- шлях/до/дампа.sql)
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './loadEnv';
import { readDump } from './dumpReader';
import { BatchInserter } from './batchInserter';
import { cleanArticle } from './cleanArticle';
import { loadOurArticles } from './loadOurArticles';
import { loadReferenceData } from './referenceData';

loadEnvLocal();

const BATCH_SIZE = 3000;

// Коли жодного бренду/виробника не вдалося зматчити по id (див.
// коментар у referenceData.ts — колонка "інший бренд" в art_lookup
// не завжди влучає в діапазон відомих brands/manufacturers) —
// ЧЕСНИЙ нейтральний плейсхолдер замість вигаданої назви
const UNKNOWN_BRAND = 'TECDOC';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Використання: npx tsx scripts/tecdoc/import-dump.ts шлях/до/дампа.sql');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Не задано DATABASE_URL (перевірте .env.local в корені проєкту).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  console.log('Крок 1/3: читаємо власний каталог (SELECT DISTINCT article FROM products)...');
  const ourArticles = await loadOurArticles(pool);
  console.log(`  Знайдено ${ourArticles.size.toLocaleString('uk-UA')} унікальних артикулів у вашому каталозі.\n`);

  console.log('Крок 2/3: ФАЗА 1 — довідники (brands/manufacturers/models) + пошук збігів у articles...');
  const startPhase1 = Date.now();
  const reference = await loadReferenceData(filePath, ourArticles, (linesRead, elapsedMs) => {
    console.log(`  ... ${(linesRead / 1e6).toFixed(0)}М рядків файлу, ${(elapsedMs / 1000).toFixed(0)}с`);
  });
  console.log(
    `  Готово за ${((Date.now() - startPhase1) / 1000 / 60).toFixed(1)} хв: ` +
      `${reference.matchedArticles.size.toLocaleString('uk-UA')} tecdoc-артикулів збігається з вашим каталогом ` +
      `(з ${ourArticles.size.toLocaleString('uk-UA')} власних), ` +
      `brands: ${reference.brandsById.size}, manufacturers: ${reference.manufacturersById.size}, ` +
      `models: ${reference.modelsById.size}.\n`
  );

  if (reference.matchedArticles.size === 0) {
    console.log('Жодного збігу з вашим каталогом не знайдено — імпортувати нічого. Перевірте DATABASE_URL і products.article.');
    await pool.end();
    return;
  }

  console.log('Крок 3/3: ФАЗА 2 — art_lookup (кроси) + link_art (застосовність), пишемо в Supabase...');

  const crossesInserter = new BatchInserter(
    pool,
    'tecdoc_crosses',
    ['brand_a', 'article_a', 'brand_b', 'article_b', 'relation_type'],
    BATCH_SIZE
  );
  const compatibilityInserter = new BatchInserter(
    pool,
    'tecdoc_compatibility',
    ['brand', 'article', 'make', 'model', 'generation', 'engine', 'year_from', 'year_to'],
    BATCH_SIZE
  );

  const startPhase2 = Date.now();

  const stats = await readDump(filePath, {
    progressEveryLines: 5_000_000,
    onProgress(p) {
      console.log(
        `  ... ${(p.linesRead / 1e6).toFixed(0)}М рядків, ${(p.elapsedMs / 1000).toFixed(0)}с, ` +
          `пам'ять ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} МБ — ` +
          `кросів: ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}, ` +
          `застосовності: ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}`
      );
    },

    async onInsertRows(table, rows) {
      if (table === 'art_lookup') {
        for (const row of rows) {
          const ourMatch = reference.matchedArticles.get(Number(row[0]));
          if (!ourMatch) continue;

          const crossArticle = cleanArticle(row[4] ?? row[1]);
          if (!crossArticle || crossArticle === ourMatch.article) continue;

          const otherBrandId = Number(row[3]);
          const crossBrand =
            reference.brandsById.get(otherBrandId) || reference.manufacturersById.get(otherBrandId) || UNKNOWN_BRAND;

          await crossesInserter.add([ourMatch.brand, ourMatch.article, crossBrand, crossArticle, 'cross']);
          await crossesInserter.add([crossBrand, crossArticle, ourMatch.brand, ourMatch.article, 'cross']);
        }
      } else if (table === 'link_art') {
        for (const row of rows) {
          const ourMatch = reference.matchedArticles.get(Number(row[1]));
          if (!ourMatch) continue;

          const model = reference.modelsById.get(Number(row[3]));
          if (!model) continue;

          const make = reference.manufacturersById.get(model.manufacturerId);
          if (!make) continue; // без марки авто запис не несе SEO-цінності

          await compatibilityInserter.add([
            ourMatch.brand,
            ourMatch.article,
            make,
            // model/generation/engine — порожні: TecDoc зберігає лише
            // внутрішній числовий код моделі (models.tecdoc_code), а
            // не людську назву ("Camry", "Golf") — показувати вигаданий
            // чи сирий код замість реальної назви моделі гірше, ніж
            // чесно лишити поле порожнім (див. пояснення в чаті)
            '',
            '',
            '',
            model.yearFrom,
            model.yearTo,
          ]);
        }
      }
    },
  });

  await crossesInserter.flush();
  await compatibilityInserter.flush();
  await pool.end();

  console.log('\n============================================================');
  console.log('ІМПОРТ ЗАВЕРШЕНО');
  console.log('============================================================');
  console.log(`Фаза 1 (довідники):          ${((Date.now() - startPhase1) / 1000 / 60).toFixed(1)} хв`);
  console.log(`Фаза 2 (кроси/застосовність): ${((Date.now() - startPhase2) / 1000 / 60).toFixed(1)} хв`);
  console.log(`Рядків файлу прочитано (фаза 2): ${stats.linesRead.toLocaleString('uk-UA')}`);
  console.log(`Кросів вставлено:             ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Записів застосовності:        ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log('============================================================\n');
  console.log(
    'Порада: значення make (марка авто) походить з таблиці manufacturers TecDoc —\n' +
      'звірте кілька рядків tecdoc_compatibility вручну перед тим, як показувати їх\n' +
      'покупцям (семантику цієї таблиці розпізнано по зразках даних, а не по\n' +
      'офіційній документації — модель авто (model) свідомо не заповнена, див.\n' +
      'коментар у коді вище).'
  );
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
