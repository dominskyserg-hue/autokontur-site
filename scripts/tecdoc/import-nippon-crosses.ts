// ============================================================
// Імпорт кросс-номерів з прайс-листа постачальника NMCO (Excel-файл
// "Price-Nippon.xls", лист "Прайслист") у tecdoc_crosses.
//
// Файл НЕ монобрендовий — незважаючи на назву ("Price-Nippon"), у
// колонці "Производитель" 354 різних бренди деталей (Nippon, Nissan,
// Mazda, NTY, RBI, Febi...), Nippon/Nippon Motors — лише ~2165 з 8900
// рядків. Тому зіставлення з нашим каталогом іде по КОНКРЕТНОМУ
// постачальнику (весь файл вже завантажений як прайс-лист поставщика
// NMCO, products.supplier_id), а не по одному захардкодженому бренду —
// так підхоплюються кроси для всіх 354 брендів одразу, а не тільки
// для Nippon.
//
// НА ВІДМІНУ від scripts/tecdoc/import-trw-oe.ts (там колонка OE-Number
// сама вказує виробника для кожного номера: "FORD 123, VOLKSWAGEN 456"),
// колонка "Замены" (індекс 12, тобто 13-та колонка) у цьому файлі —
// ПРОСТИЙ список номерів через "; ", БЕЗ вказівки бренду для кожного
// окремого номера:
//
//   "J3 704 091; J3 704 041; ADH25358; 852636; 46430-SM4-003; ..."
//
// Частина цих номерів — оригінальні OEM-номери автовиробника (напр.
// "46430-SM4-003" схоже на номер Honda), частина — коди інших брендів-
// аналогів ("ADH25358" точно не формат Honda). Без явного бренду в
// самому файлі гадати конкретний бренд для кожного номера означало б
// вигадувати дані, яких немає, — тому за рішенням власника проєкту
// всі номери з "Замены" записуються з ЗАГАЛЬНОЮ позначкою бренду
// CROSS_BRAND_LABEL нижче ("OEM/аналог"), а не з вигаданим конкретним
// брендом. Це не заважає головній практичній цінності — пошуку на
// сайті за чужим номером (app/api/products/route.ts шукає лише за
// article_a/article_b, бренд там не бере участі), просто на картці
// товару блок "також відомий як" покаже загальну позначку замість
// конкретного виробника.
//
// Запуск: npx tsx scripts/tecdoc/import-nippon-crosses.ts [шлях/до/файлу.xls] [назва_постачальника]
// (назва постачальника за замовчуванням — NMCO)
// ============================================================

import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './loadEnv';
import { cleanArticle } from './cleanArticle';
import { BatchInserter } from './batchInserter';

loadEnvLocal();

const CROSS_BRAND_LABEL = 'OEM/аналог';
// Було 500 — з великими батчами частина рядків мовчки не доходила до
// бази (кілька повторних запусків підряд щоразу додавали ще нові
// рядки замість того, щоб ON CONFLICT DO NOTHING зробив повторний
// запуск порожнім, як очікувалось). Менший розмір батчу стабільно
// записує все за один прохід
const BATCH_SIZE = 50;
const DEFAULT_FILE_PATH = 'C:\\Users\\User\\Downloads\\price\\Price-Nippon.xls';
const DEFAULT_SUPPLIER_NAME = 'NMCO';

// Колонки файлу (0-індексовані, підтверджено інспекцією реального файлу):
//   1  — № по каталогу (наш артикул)
//   2  — Производитель (бренд деталі — тільки для довідки в логах;
//        реальний брендзаписуємо з products.brand, а не з файлу)
//   3  — Код производителя (дублює №1 в усіх перевірених рядках)
//   12 — Замены (кросс-номери через "; ")
const ARTICLE_COL = 1;
const FALLBACK_ARTICLE_COL = 3;
const CROSSES_COL = 12;

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE_PATH;
  const supplierName = process.argv[3] || DEFAULT_SUPPLIER_NAME;

  if (!process.env.DATABASE_URL) {
    console.error('Не задано DATABASE_URL (перевірте .env.local в корені проєкту).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  console.log(`Крок 1/3: шукаємо постачальника "${supplierName}" і його товари...`);
  const supplierRes = await pool.query('SELECT id FROM suppliers WHERE name = $1', [supplierName]);
  if (supplierRes.rows.length === 0) {
    console.error(`Постачальника "${supplierName}" не знайдено в suppliers.`);
    await pool.end();
    process.exit(1);
  }
  const supplierId = supplierRes.rows[0].id;

  const ourRes = await pool.query('SELECT article, brand FROM products WHERE supplier_id = $1', [supplierId]);
  const ourProducts = new Map<string, string>(); // article -> brand (з нашої бази, а не з файлу)
  for (const row of ourRes.rows) {
    ourProducts.set(row.article as string, row.brand as string);
  }
  console.log(`  У постачальника "${supplierName}" ${ourProducts.size} товарів у каталозі.\n`);

  if (ourProducts.size === 0) {
    console.log('Немає жодного товару цього постачальника в products — імпортувати нічого.');
    await pool.end();
    return;
  }

  console.log(`Крок 2/3: читаємо Excel-файл (${filePath})...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`  Усього рядків даних у файлі: ${(rows.length - 1).toLocaleString('uk-UA')}\n`);

  console.log('Крок 3/3: зіставляємо з каталогом і записуємо нові кроси...');
  const inserter = new BatchInserter(
    pool,
    'tecdoc_crosses',
    ['brand_a', 'article_a', 'brand_b', 'article_b', 'relation_type'],
    BATCH_SIZE
  );

  let matchedRows = 0;
  let notFoundRows = 0;
  let pairsFound = 0;
  const brandsUsed = new Set<string>();
  const examples: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawArticle = row[ARTICLE_COL] || row[FALLBACK_ARTICLE_COL];
    const ourArticle = cleanArticle(rawArticle);
    const ourBrand = ourArticle ? ourProducts.get(ourArticle) : undefined;

    if (!ourArticle || !ourBrand) {
      if (ourArticle) notFoundRows++;
      continue;
    }

    const crossesRaw = String(row[CROSSES_COL] ?? '').trim();
    if (!crossesRaw) continue;

    const crossNumbers = crossesRaw
      .split(/[;,]/)
      .map((s) => cleanArticle(s))
      .filter((s) => s.length >= 3 && s !== ourArticle);

    if (crossNumbers.length === 0) continue;

    matchedRows++;
    brandsUsed.add(ourBrand);

    for (const crossNumber of crossNumbers) {
      await inserter.add([ourBrand, ourArticle, CROSS_BRAND_LABEL, crossNumber, 'cross']);
      await inserter.add([CROSS_BRAND_LABEL, crossNumber, ourBrand, ourArticle, 'cross']);
      pairsFound++;

      if (examples.length < 15) examples.push(`  ${ourBrand} ${ourArticle} <-> ${crossNumber}`);
    }
  }

  await inserter.flush();
  await pool.end();

  console.log('\n============================================================');
  console.log(`ІМПОРТ КРОСІВ "${supplierName}" ЗАВЕРШЕНО`);
  console.log('============================================================');
  console.log(`Рядків файлу з артикулом, знайденим у нашому каталозі:  ${matchedRows}`);
  console.log(`Рядків з артикулом, якого НЕМА в каталозі постачальника: ${notFoundRows}`);
  console.log(`Різних брендів серед зіставлених рядків:                ${brandsUsed.size}`);
  console.log(`Знайдено пар "наш артикул <-> кросс-номер":             ${pairsFound}`);
  console.log(`Рядків вставлено в tecdoc_crosses (з двонапрямними):    ${inserter.getTotalInserted()}`);
  console.log('\nПриклади:');
  console.log(examples.join('\n'));
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
