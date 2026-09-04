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
//   country_designations(tecdoc_code, country_id, des_text_id) —
//          tecdoc_code = 110 000 000 + models.id (див. referenceData.ts)
//   des_texts(id, text)                              — сам текст назви
//   art_lookup(article_id, clean_number, type_byte, other_brand_id,
//              raw_number, ...)                     — кроси/OEM
//   link_art(id, article_id, ?, model_id)            — застосовність
//            до моделі авто (без деталізації двигун/рік — модель ще
//            є 147-мільйонна таблиця link_la_typ з точнішою
//            прив'язкою до модифікації, її семантику по 4 рядках
//            надійно не розібрати — свідомо не використовується)
//
// Тритифазний алгоритм (кожна фаза — стрімінг, RAM обмежена):
//
//   ФАЗА 1 (scripts/tecdoc/referenceData.ts) — ОДИН прохід по дампу.
//     Тримає в пам'яті ЛИШЕ: brands (3068 рядків), manufacturers
//     (657), models (12 500) — усі крихітні — "matchedArticles":
//     tecdoc article_id -> {brand, article} ЛИШЕ для рядків articles,
//     чий очищений артикул є у вашому products.article — і
//     modelDesTextId: models.id -> des_texts.id з назвою (ще не сам
//     текст). Пам'ять росте з розміром ВАШОГО каталогу, а не TecDoc
//
//   ФАЗА 2 (scripts/tecdoc/modelNames.ts) — ДРУГИЙ прохід, лише по
//     des_texts (1,25 млн рядків), резолвить des_texts.id -> текст
//     ЛИШЕ для id, знайдених у фазі 1 (максимум 12 500) — звідси й
//     готові людські назви моделей ("Avensis", "Camry"...)
//
//   ФАЗА 3 (нижче) — ТРЕТІЙ прохід. Стрімить дві найбільші таблиці
//     (art_lookup 64,8 млн рядків, link_art 21,2 млн рядків), для
//     кожного рядка перевіряє належність article_id до
//     matchedArticles (просте O(1) звернення до Map) і ОДРАЗУ пише
//     збіги пакетами в Supabase
//
// Через те, що дамп доводиться читати ТРИЧІ, повний прогін на
// 11+ ГБ файлі займає порядку 55-70 хвилин — це нормально для
// одноразового скрипта наповнення бази
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
import { resolveDesTexts } from './modelNames';

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

  console.log('Крок 1/5: читаємо власний каталог (SELECT DISTINCT article FROM products)...');
  const ourArticles = await loadOurArticles(pool);
  console.log(`  Знайдено ${ourArticles.size.toLocaleString('uk-UA')} унікальних артикулів у вашому каталозі.\n`);

  console.log('Крок 2/5: ФАЗА 1 — довідники (brands/manufacturers/models) + пошук збігів у articles...');
  const startPhase1 = Date.now();
  const reference = await loadReferenceData(filePath, ourArticles, (linesRead, elapsedMs) => {
    console.log(`  ... ${(linesRead / 1e6).toFixed(0)}М рядків файлу, ${(elapsedMs / 1000).toFixed(0)}с`);
  });
  const phase1DurationMs = Date.now() - startPhase1;
  console.log(
    `  Готово за ${(phase1DurationMs / 1000 / 60).toFixed(1)} хв: ` +
      `${reference.matchedArticles.size.toLocaleString('uk-UA')} tecdoc-артикулів збігається з вашим каталогом ` +
      `(з ${ourArticles.size.toLocaleString('uk-UA')} власних), ` +
      `brands: ${reference.brandsById.size}, manufacturers: ${reference.manufacturersById.size}, ` +
      `models: ${reference.modelsById.size}, назв моделей знайдено (des_text id): ${reference.modelDesTextId.size}.\n`
  );

  if (reference.matchedArticles.size === 0) {
    console.log('Жодного збігу з вашим каталогом не знайдено — імпортувати нічого. Перевірте DATABASE_URL і products.article.');
    await pool.end();
    return;
  }

  console.log('Крок 3/5: ФАЗА 2 — резолвимо людські назви моделей (des_texts)...');
  const startPhase2 = Date.now();
  const neededDesTextIds = new Set(reference.modelDesTextId.values());
  const desTextsById = await resolveDesTexts(filePath, neededDesTextIds, (linesRead, elapsedMs, found) => {
    console.log(
      `  ... ${(linesRead / 1e6).toFixed(0)}М рядків файлу, ${(elapsedMs / 1000).toFixed(0)}с, ` +
        `знайдено назв: ${found.toLocaleString('uk-UA')}/${neededDesTextIds.size.toLocaleString('uk-UA')}`
    );
  });
  const phase2DurationMs = Date.now() - startPhase2;

  // modelsById.id -> текст назви (об'єднуємо modelDesTextId +
  // щойно зрезолвлений текст в одну зручну мапу для фази 3)
  const modelNamesById = new Map<number, string>();
  for (const [modelId, desTextId] of reference.modelDesTextId) {
    const text = desTextsById.get(desTextId);
    if (text) modelNamesById.set(modelId, text);
  }
  console.log(
    `  Готово за ${(phase2DurationMs / 1000 / 60).toFixed(1)} хв: ` +
      `розпізнано назв для ${modelNamesById.size.toLocaleString('uk-UA')} з ${reference.modelsById.size.toLocaleString('uk-UA')} моделей.\n`
  );

  console.log('Крок 4/5: очищаємо стару tecdoc_compatibility (щоб не змішати старі порожні model= з новими)...');
  await pool.query('TRUNCATE tecdoc_compatibility');
  console.log('  Готово.\n');

  console.log('Крок 5/5: ФАЗА 3 — art_lookup (кроси) + link_art (застосовність), пишемо в Supabase...');

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

  const startPhase3 = Date.now();

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

          const modelId = Number(row[3]);
          const model = reference.modelsById.get(modelId);
          if (!model) continue;

          const make = reference.manufacturersById.get(model.manufacturerId);
          if (!make) continue; // без марки авто запис не несе SEO-цінності

          await compatibilityInserter.add([
            ourMatch.brand,
            ourMatch.article,
            make,
            // Тепер РЕАЛЬНА назва моделі (напр. "Avensis"), якщо
            // вдалось розпізнати через ланцюжок models -> tecdoc_code
            // -> country_designations -> des_texts (див. коментар на
            // початку файлу) — інакше чесно порожньо, а не вигадана
            // чи сира назва
            modelNamesById.get(modelId) || '',
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
  console.log(`Фаза 1 (довідники):           ${(phase1DurationMs / 1000 / 60).toFixed(1)} хв`);
  console.log(`Фаза 2 (назви моделей):       ${(phase2DurationMs / 1000 / 60).toFixed(1)} хв`);
  console.log(`Фаза 3 (кроси/застосовність): ${((Date.now() - startPhase3) / 1000 / 60).toFixed(1)} хв`);
  console.log(`Рядків файлу прочитано (фаза 3): ${stats.linesRead.toLocaleString('uk-UA')}`);
  console.log(`Кросів вставлено:             ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Записів застосовності:        ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`З них із розпізнаною моделлю: ${modelNamesById.size.toLocaleString('uk-UA')} моделей мають назву`);
  console.log('============================================================\n');
  console.log(
    'Порада: значення make і model походять із таблиць manufacturers/des_texts\n' +
      'TecDoc — звірте кілька рядків tecdoc_compatibility вручну перед тим, як\n' +
      'показувати їх покупцям (семантику розпізнано по зразках даних, а не по\n' +
      'офіційній документації TecDoc).'
  );
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
