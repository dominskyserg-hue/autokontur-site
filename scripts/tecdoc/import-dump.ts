// ============================================================
// Основний скрипт імпорту: 11-гігабайтний дамп TecDoc → 3 компактні
// таблиці в нашій Supabase-базі (tecdoc_crosses, tecdoc_compatibility,
// tecdoc_related_categories, див. schema.sql) — для SEO-перелінковки
// на сторінці товару, БЕЗ важких текстових описів/медіа з оригіналу.
//
// ПЕРЕД ЗАПУСКОМ ЦЬОГО СКРИПТА:
//   1. Застосуйте нову секцію в schema.sql в Supabase (SQL Editor →
//      New query → вставити секцію "TECDOC — SEO-ІНДЕКС" → Run).
//   2. Запустіть scripts/tecdoc/inspect-dump.ts на вашому файлі й
//      подивіться РЕАЛЬНІ назви таблиць/колонок вашого конкретного
//      дампа (вони відрізняються залежно від постачальника дампа).
//   3. Заповніть CONFIG нижче реальними значеннями з кроку 2.
//
// Запуск (з кореня проєкту):
//   npx tsx scripts/tecdoc/import-dump.ts шлях/до/дампа.sql
//
// Скрипт ІДЕМПОТЕНТНИЙ: усі три таблиці мають UNIQUE-обмеження, вставка
// йде через ON CONFLICT DO NOTHING (див. batchInserter.ts) — можна
// зупинити (Ctrl+C) і запустити знову з початку файлу, дублікатів не
// буде. Часткового резюме "з місця зупинки" немає (для 11 ГБ це б
// ускладнило скрипт без насправді великої користі: повторний повний
// прохід по вже впорядкованому SQL-файлу — це операція вводу/виводу,
// вона й так набагато швидша за саму вставку в базу)
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './loadEnv';
import { readDump } from './dumpReader';
import { BatchInserter } from './batchInserter';
import { cleanArticle } from './cleanArticle';

loadEnvLocal();

// ============================================================
// CONFIG — ОБОВ'ЯЗКОВО ВІДРЕДАГУЙТЕ ПІД ВАШ КОНКРЕТНИЙ ДАМП
// ============================================================
// Значення sourceTable і columns нижче — ПРИКЛАДИ типових назв у
// "класичній" структурі TecDoc. Вони НЕ гарантовано збігаються з
// вашим файлом — обов'язково звірте їх зі списком від
// scripts/tecdoc/inspect-dump.ts перед запуском. columns — це
// 0-based індекс колонки В МЕЖАХ ОДНОГО РЯДКА ЦІЄЇ ТАБЛИЦІ (порядок,
// у якому колонки йдуть у CREATE TABLE / COPY-заголовку дампа)
const CONFIG = {
  batchSize: 3000,
  progressEveryLines: 500_000,

  // ---- 1. КРОСИ Й OEM-НОМЕРА ----
  // Очікується таблиця, де кожен рядок — це пара "деталь A" <-> "деталь B"
  // (або "деталь" <-> "OEM-номер автовиробника")
  crosses: {
    enabled: true,
    sourceTable: 'gm_ref_oe_nrs', // TODO: перевірити реальну назву
    columns: {
      brandA: 0, // TODO: індекс колонки бренду першої деталі
      articleA: 1, // TODO: індекс колонки артикула першої деталі
      brandB: 2, // TODO: індекс колонки бренду другої деталі / марки авто (для OEM)
      articleB: 3, // TODO: індекс колонки артикула другої деталі / OEM-номера
      // Якщо в таблиці є ОКРЕМА колонка з типом зв'язку (oem/cross) —
      // вкажіть її індекс тут, інакше лишіть null і всі рядки з цієї
      // таблиці підуть з типом defaultRelationType нижче
      relationTypeColumn: null as number | null,
    },
    defaultRelationType: 'oem' as 'oem' | 'cross',
  },

  // ---- 2. ЗАСТОСОВНІСТЬ ДО АВТО ----
  // Очікується таблиця "лінкувань" деталь <-> модифікація автомобіля
  compatibility: {
    enabled: true,
    sourceTable: 'gm_linkage', // TODO: перевірити реальну назву
    columns: {
      brand: 0, // TODO
      article: 1, // TODO
      make: 2, // TODO: марка авто (TOYOTA, BMW...)
      model: 3, // TODO: модель (може бути null у дампі — тоді підставиться '')
      generation: 4, // TODO: покоління/кузов, або null
      engine: 5, // TODO: двигун/модифікація, або null
      yearFrom: 6, // TODO: рік початку випуску, або null
      yearTo: 7, // TODO: рік кінця випуску, або null
    },
  },

  // ---- 3. СУПУТНІ КАТЕГОРІЇ ----
  // Таблиця значно менша за перші дві (довідник груп деталей, а не
  // мільйони лінкувань) — типово щось на кшталт зв'язків між "родовими
  // артикулами" (generic article) чи товарними групами каталогу
  relatedCategories: {
    enabled: true,
    sourceTable: 'gm_pgrp_relations', // TODO: перевірити реальну назву
    columns: {
      fromName: 1, // TODO: назва категорії-джерела
      toName: 3, // TODO: назва супутньої категорії
    },
  },
};

// ============================================================
// ДОПОМІЖНЕ: приведення "можливо, немає значення" до порожнього рядка
// (а не null) — потрібно, бо UNIQUE-обмеження в Postgres ігнорує рядки
// з NULL (NULL ніколи "не дорівнює" іншому NULL), і без цього
// ON CONFLICT DO NOTHING не захистить від дублікатів там, де в дампі
// частина колонок порожня
// ============================================================
function orEmpty(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toYear(value: unknown): number | null {
  const num = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(num) && num > 1900 && num < 2100 ? num : null;
}

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

  // max: 1 — навмисно ОДНЕ з'єднання на весь імпорт. Скрипт пише
  // послідовними батчами, паралельні з'єднання йому не потрібні, а
  // Supabase на дешевших тарифах має досить низький загальний ліміт
  // з'єднань — заради одного локального скрипта імпорту немає сенсу
  // забирати з нього більше одного
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  const crossesInserter = new BatchInserter(
    pool,
    'tecdoc_crosses',
    ['brand_a', 'article_a', 'brand_b', 'article_b', 'relation_type'],
    CONFIG.batchSize
  );
  const compatibilityInserter = new BatchInserter(
    pool,
    'tecdoc_compatibility',
    ['brand', 'article', 'make', 'model', 'generation', 'engine', 'year_from', 'year_to'],
    CONFIG.batchSize
  );
  const relatedCategoriesInserter = new BatchInserter(
    pool,
    'tecdoc_related_categories',
    ['from_category_name', 'to_category_name'],
    CONFIG.batchSize
  );

  console.log(`Імпорт з ${filePath} починається...\n`);

  const stats = await readDump(filePath, {
    progressEveryLines: CONFIG.progressEveryLines,

    onProgress(progress) {
      const mb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
      console.log(
        `... ${progress.linesRead.toLocaleString('uk-UA')} рядків файлу за ${(progress.elapsedMs / 1000).toFixed(0)}с, ` +
          `пам'ять процесу ${mb} МБ — ` +
          `кросів: ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}, ` +
          `застосовності: ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}, ` +
          `категорій: ${relatedCategoriesInserter.getTotalInserted().toLocaleString('uk-UA')}`
      );
    },

    // ВАЖЛИВО: хук — async, і readDump() його ЧЕКАЄ (await) перед
    // читанням наступного рядка файлу (див. коментар до onInsertRows
    // у dumpReader.ts). Без цього парсинг файлу (дешева локальна
    // операція) обганяв би вставку в Supabase (мережевий I/O) у
    // рази — і рядки, що чекають на чергову вставку, накопичувались
    // би в необмеженій черзі промісів у пам'яті. await тут — і є
    // той самий backpressure, що тримає пам'ять процесу в межах
    // кількох мегабайт незалежно від розміру вхідного файлу
    async onInsertRows(table, rows) {
      if (CONFIG.crosses.enabled && table === CONFIG.crosses.sourceTable) {
        for (const row of rows) {
          const c = CONFIG.crosses.columns;
          const brandA = orEmpty(row[c.brandA]);
          const articleA = cleanArticle(row[c.articleA]);
          const brandB = orEmpty(row[c.brandB]);
          const articleB = cleanArticle(row[c.articleB]);
          if (!brandA || !articleA || !brandB || !articleB) continue;

          const relationType =
            c.relationTypeColumn !== null
              ? String(row[c.relationTypeColumn]).toLowerCase() === 'oem'
                ? 'oem'
                : 'cross'
              : CONFIG.crosses.defaultRelationType;

          // Пишемо ОБИДВА напрямки зв'язку одразу (A->B і B->A) — щоб
          // на сторінці товару можна було одним індексованим запитом
          // "WHERE brand_a = ? AND article_a = ?" знайти всі кроси
          // незалежно від того, з якого боку пари деталь опинилась у
          // вихідному дампі (докладніше — коментар у schema.sql)
          await crossesInserter.add([brandA, articleA, brandB, articleB, relationType]);
          await crossesInserter.add([brandB, articleB, brandA, articleA, relationType]);
        }
      }

      if (CONFIG.compatibility.enabled && table === CONFIG.compatibility.sourceTable) {
        for (const row of rows) {
          const c = CONFIG.compatibility.columns;
          const brand = orEmpty(row[c.brand]);
          const article = cleanArticle(row[c.article]);
          const make = orEmpty(row[c.make]);
          if (!brand || !article || !make) continue;

          await compatibilityInserter.add([
            brand,
            article,
            make,
            orEmpty(row[c.model]),
            orEmpty(row[c.generation]),
            orEmpty(row[c.engine]),
            toYear(row[c.yearFrom]),
            toYear(row[c.yearTo]),
          ]);
        }
      }

      if (CONFIG.relatedCategories.enabled && table === CONFIG.relatedCategories.sourceTable) {
        for (const row of rows) {
          const c = CONFIG.relatedCategories.columns;
          const fromName = orEmpty(row[c.fromName]);
          const toName = orEmpty(row[c.toName]);
          if (!fromName || !toName || fromName === toName) continue;

          await relatedCategoriesInserter.add([fromName, toName]);
        }
      }
    },
  });

  // Дописуємо залишок кожного буфера, що не дотягнув до batchSize
  await crossesInserter.flush();
  await compatibilityInserter.flush();
  await relatedCategoriesInserter.flush();

  await pool.end();

  console.log('\n============================================================');
  console.log('ІМПОРТ ЗАВЕРШЕНО');
  console.log('============================================================');
  console.log(`Рядків файлу прочитано:      ${stats.linesRead.toLocaleString('uk-UA')}`);
  console.log(`SQL-операторів розібрано:    ${stats.statementsRead.toLocaleString('uk-UA')}`);
  console.log(`Кросів/OEM вставлено:        ${crossesInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Застосовності вставлено:     ${compatibilityInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Супутніх категорій вставлено: ${relatedCategoriesInserter.getTotalInserted().toLocaleString('uk-UA')}`);
  console.log(`Час роботи:                  ${(stats.elapsedMs / 1000 / 60).toFixed(1)} хв`);
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
