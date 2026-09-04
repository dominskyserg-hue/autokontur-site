// ============================================================
// Імпорт TecDoc → tecdoc_crosses / tecdoc_compatibility, ЛИШЕ для
// артикулів, які реально є у вашому каталозі (products.article) —
// не весь каталог TecDoc (десятки мільйонів деталей), а тільки те,
// що стосується того, що ви продаєте.
//
// Схема РЕАЛЬНОГО дампу (tecdoc2016q1.sql) — на відміну від того, що
// припускалось у попередній версії цього коментаря, дамп НЕ
// "HeidiSQL-експорт без жодних назв колонок": кожен INSERT INTO в
// ньому містить повний список назв колонок, просто без окремих
// CREATE TABLE. Нижче — назви, прочитані буквально з файлу (а не
// здогадки по кільком зразкам рядків):
//
//   articles(ART_ID, ART_ARTICLE_NR, ART_SUP_ID, ART_DES_ID, ...)
//   brands(BRA_ID, BRA_MFC_CODE, BRA_BRAND, BRA_MF_NR)
//   manufacturers(MFA_ID, ..., MFA_BRAND, ...)          — марки авто
//   models(MOD_ID, MOD_MFA_ID, MOD_CDS_ID, MOD_PCON_START, MOD_PCON_END, ...)
//   country_designations(CDS_ID, CDS_LNG_ID, CDS_TEX_ID) —
//          CDS_ID для моделей = 110 000 000 + models.id (див. referenceData.ts)
//   des_texts(TEX_ID, TEX_TEXT)                          — сам текст назви
//   art_lookup(ARL_ART_ID, ARL_SEARCH_NUMBER, ARL_KIND, ARL_BRA_ID,
//              ARL_DISPLAY_NR, ...)                      — кроси/OEM
//   link_art(LA_ID, LA_ART_ID, LA_GA_ID, LA_SORT)         — !! НЕ містить
//            моделі авто взагалі (LA_SORT — порядок сортування, не
//            model_id: попередня версія цього скрипта помилково
//            читала його як модель, через що вже завантажені раніше
//            дані tecdoc_compatibility мали випадкову марку/модель)
//   link_la_typ(LAT_TYP_ID, LAT_LA_ID, ...)               — ось тут
//            з'являється модифікація авто (TYP_ID), до якої підходить
//            деталь (147 млн рядків)
//   types(TYP_ID, ..., TYP_MOD_ID, ..., TYP_PCON_START, TYP_PCON_END,
//         ..., TYP_CCM, ..., TYP_LITRES, ...)             — сама модифікація:
//            модель (TYP_MOD_ID), об'єм двигуна (TYP_CCM/TYP_LITRES) і
//            точний рік ЦІЄЇ модифікації
//
// РЕАЛЬНИЙ ланцюжок застосовності (перевірено на реальних рядках):
//   наш артикул -> link_art (LA_ART_ID) -> LA_ID
//     -> link_la_typ (LAT_LA_ID=LA_ID) -> TYP_ID
//       -> types (TYP_ID) -> TYP_MOD_ID + об'єм двигуна + рік модифікації
//         -> models (TYP_MOD_ID) -> manufacturer_id
//           -> manufacturers -> марка
//
// Двофазний алгоритм (кожна фаза — стрімінг, RAM обмежена):
//
//   ФАЗА 1 (scripts/tecdoc/referenceData.ts) — ОДИН прохід по дампу.
//     Тримає в пам'яті ЛИШЕ: brands (3068 рядків), manufacturers
//     (657), models (12 500) — усі крихітні — "matchedArticles":
//     tecdoc article_id -> {brand, article} ЛИШЕ для рядків articles,
//     чий очищений артикул є у вашому products.article — modelDesTextId
//     (models.id -> des_texts.id з назвою, ще не сам текст) — і, за
//     тим самим принципом "лише перетин з нашим каталогом",
//     articleTypeIds (наш articleId -> Set<TYP_ID>) та typesById
//     (TYP_ID -> {модель, об'єм двигуна, рік}), зібрані по дорозі
//     через link_art і link_la_typ, БЕЗ окремого проходу для них.
//     Пам'ять росте з розміром ВАШОГО каталогу, а не TecDoc
//
//   ФАЗА 2 (scripts/tecdoc/modelNames.ts) — ДРУГИЙ прохід, лише по
//     des_texts (1,25 млн рядків), резолвить des_texts.id -> текст
//     ЛИШЕ для id, знайдених у фазі 1 (максимум 12 500) — звідси й
//     готові людські назви моделей ("Avensis", "Camry"...)
//
//   ФАЗА 3 (нижче) — ТРЕТІЙ прохід, АЛЕ лише по art_lookup (64,8 млн
//     рядків, кроси/OEM) — самі рядки tecdoc_compatibility до цього
//     моменту вже повністю зібрані й записані ЧИСТО З ПАМ'ЯТІ (фаза 1),
//     жодного додаткового проходу по файлу заради застосовності більше
//     не потрібно
//
// Через те, що дамп доводиться читати ТРИЧІ (з них третій — лише по
// art_lookup), повний прогін на 11+ ГБ файлі займає порядку 55-70
// хвилин — це нормально для одноразового скрипта наповнення бази
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

  console.log('Крок 2/5: ФАЗА 1 — довідники + застосовність (link_art -> link_la_typ -> types) + пошук збігів у articles...');
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
      `models: ${reference.modelsById.size}, назв моделей знайдено (des_text id): ${reference.modelDesTextId.size}, ` +
      `модифікацій авто (types) знайдено: ${reference.typesById.size.toLocaleString('uk-UA')}.\n`
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

  console.log('Крок 4/5: очищаємо стару tecdoc_compatibility (щоб не змішати старі неправильні рядки з новими)...');
  await pool.query('TRUNCATE tecdoc_compatibility');
  console.log('  Готово.\n');

  console.log(
    'Крок 5/5: записуємо застосовність (з вже готових у пам\'яті даних) ' +
      'і стрімимо art_lookup (кроси) в Supabase...'
  );

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

  // Застосовність будуємо ЛИШЕ з того, що вже зібрано в пам'яті на
  // фазі 1 (reference.articleTypeIds/typesById) — жодного додаткового
  // проходу по файлу для цього не треба, на відміну від art_lookup
  // (кросів) нижче, якого в пам'яті ніхто не тримає (64,8 млн рядків)
  let compatibilitySkippedNoType = 0;
  let compatibilitySkippedNoMake = 0;

  for (const [articleId, typeIds] of reference.articleTypeIds) {
    const ourMatch = reference.matchedArticles.get(articleId);
    if (!ourMatch) continue;

    for (const typeId of typeIds) {
      const type = reference.typesById.get(typeId);
      if (!type) {
        compatibilitySkippedNoType++;
        continue;
      }

      const model = reference.modelsById.get(type.modelId);
      if (!model) continue;

      const make = reference.manufacturersById.get(model.manufacturerId);
      if (!make) {
        compatibilitySkippedNoMake++;
        continue; // без марки авто запис не несе SEO-цінності
      }

      // Об'єм двигуна — з types.TYP_LITRES (напр. 1.6), якщо його
      // немає — рахуємо з TYP_CCM (напр. 1997 см³ -> 2.0). Один
      // десятковий знак — щоб "2" і "2.0" з різних модифікацій не
      // виглядали як різні значення в списку на сайті
      const litres = type.litres ?? (type.ccm !== null ? type.ccm / 1000 : null);
      const engine = litres !== null ? litres.toFixed(1) : '';

      // Рік — САМЕ цієї модифікації (types.TYP_PCON_START/END)
      // точніший за рік усієї моделі, тому в пріоритеті; рік моделі —
      // лише запасний варіант, якщо в модифікації рік не вказано
      const yearFrom = type.yearFrom ?? model.yearFrom;
      const yearTo = type.yearTo ?? model.yearTo;

      await compatibilityInserter.add([
        ourMatch.brand,
        ourMatch.article,
        make,
        // РЕАЛЬНА назва моделі (напр. "Avensis"), якщо вдалось
        // розпізнати через ланцюжок models -> tecdoc_code ->
        // country_designations -> des_texts (див. коментар на
        // початку referenceData.ts) — інакше чесно порожньо, а не
        // вигадана чи сира назва
        modelNamesById.get(type.modelId) || '',
        '',
        engine,
        yearFrom,
        yearTo,
      ]);
    }
  }
  await compatibilityInserter.flush();

  console.log(
    `  Застосовність готова: ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')} рядків` +
      (compatibilitySkippedNoType > 0
        ? `, пропущено (TYP_ID не знайдено в types): ${compatibilitySkippedNoType.toLocaleString('uk-UA')}`
        : '') +
      (compatibilitySkippedNoMake > 0
        ? `, пропущено (марку не впізнано): ${compatibilitySkippedNoMake.toLocaleString('uk-UA')}`
        : '') +
      '\n'
  );

  const stats = await readDump(filePath, {
    progressEveryLines: 5_000_000,
    onProgress(p) {
      console.log(
        `  ... ${(p.linesRead / 1e6).toFixed(0)}М рядків, ${(p.elapsedMs / 1000).toFixed(0)}с, ` +
          `пам'ять ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} МБ — ` +
          `кросів: ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}`
      );
    },

    async onInsertRows(table, rows) {
      if (table !== 'art_lookup') return;

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
    },
  });

  await crossesInserter.flush();
  await pool.end();

  console.log('\n============================================================');
  console.log('ІМПОРТ ЗАВЕРШЕНО');
  console.log('============================================================');
  console.log(`Фаза 1 (довідники + застосовність у пам'яті): ${(phase1DurationMs / 1000 / 60).toFixed(1)} хв`);
  console.log(`Фаза 2 (назви моделей):                        ${(phase2DurationMs / 1000 / 60).toFixed(1)} хв`);
  console.log(`Фаза 3 (запис застосовності + кроси):          ${((Date.now() - startPhase3) / 1000 / 60).toFixed(1)} хв`);
  console.log(`Рядків файлу прочитано (фаза 3, art_lookup): ${stats.linesRead.toLocaleString('uk-UA')}`);
  console.log(`Кросів вставлено:             ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Записів застосовності:        ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`З них із розпізнаною моделлю: ${modelNamesById.size.toLocaleString('uk-UA')} моделей мають назву`);
  console.log('============================================================\n');
  console.log(
    'Порада: значення make/model/engine походять із таблиць manufacturers/\n' +
      'des_texts/types TecDoc (ланцюжок link_art -> link_la_typ -> types ->\n' +
      'models -> manufacturers, перевірений на реальних зразках рядків дампу) —\n' +
      'звірте кілька рядків tecdoc_compatibility вручну перед тим, як показувати\n' +
      'їх покупцям.'
  );
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
