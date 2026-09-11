// ============================================================
// Імпорт кросс-номерів з прайс-листа CarDon (Excel-файл "Price_CarDon.xlsx",
// лист "Cardon") у tecdoc_crosses.
//
// НА ВІДМІНУ від import-nippon-crosses.ts/import-autohelp-crosses.ts,
// CarDon НЕ є нашим постачальником (такого імені нема в suppliers, його
// товарів нема в products) — це просто зовнішній довідник кросів. Тому
// зіставлення йде НЕ по supplier_id, а по всьому каталогу відразу: для
// кожного рядка файлу перевіряємо, чи є в products товар з ТАКИМ САМИМ
// (бренд, артикул) — тобто підтверджуємо, що цей рядок файлу описує
// РЕАЛЬНИЙ товар, який ми продаємо (а не вигадуємо збіг лише по
// артикулу без бренду — короткі коди штибу "31007" трапляються у різних
// виробників з різними деталями, див. приклад у самому файлі).
//
// Формат колонки "Кроси" (індекс 3) — простий список номерів через "/",
// БЕЗ бренду для кожного окремого номера:
//
//   "6C112B372BD/1785284/5213020240P/7148000019/292555/06S173"
//
// Без явного бренду для кожного номера, як і у файлі Nippon, всі вони
// записуються із загальною позначкою CROSS_BRAND_LABEL ("OEM/аналог"),
// а не з вигаданим конкретним брендом.
//
// Запуск: npx tsx scripts/tecdoc/import-cardon-crosses.ts [шлях/до/файлу.xlsx]
// ============================================================

import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './loadEnv';
import { cleanArticle } from './cleanArticle';
import { BatchInserter } from './batchInserter';

loadEnvLocal();

const CROSS_BRAND_LABEL = 'OEM/аналог';
// 50 — той самий розмір батчу, що і в nippon/autohelp: великі батчі
// (500+) на цьому Neon-з'єднанні мовчки губили частину рядків
const BATCH_SIZE = 50;
const DEFAULT_FILE_PATH = 'C:\\Users\\User\\Downloads\\Price_CarDon.xlsx';

// Колонки файлу (0-індексовані, підтверджено інспекцією реального файлу,
// заголовки в рядку 1): Артикул(0), Бренд(1), Назва(2), Кроси(3), К-сть(4), ОПТ2(5)
const ARTICLE_COL = 0;
const BRAND_COL = 1;
const CROSSES_COL = 3;

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE_PATH;

  if (!process.env.DATABASE_URL) {
    console.error('Не задано DATABASE_URL (перевірте .env.local в корені проєкту).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  console.log('Крок 1/3: завантажуємо (бренд, артикул) усіх товарів нашого каталогу...');
  const ourRes = await pool.query('SELECT DISTINCT article, brand FROM products');
  const ourKeys = new Set<string>(); // `${UPPER(brand)}|${article}`
  const brandCasing = new Map<string, string>(); // UPPER(brand) -> оригінальне написання з нашої бази
  for (const row of ourRes.rows) {
    const brandUpper = String(row.brand ?? '').toUpperCase().trim();
    if (!brandUpper) continue;
    ourKeys.add(`${brandUpper}|${row.article}`);
    if (!brandCasing.has(brandUpper)) brandCasing.set(brandUpper, row.brand as string);
  }
  console.log(`  У каталозі ${ourKeys.size} унікальних пар (бренд, артикул).\n`);

  console.log(`Крок 2/3: читаємо Excel-файл (${filePath})...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`  Усього рядків даних у файлі: ${(rows.length - 2).toLocaleString('uk-UA')}\n`);

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
  const examples: string[] = [];

  // Рядок 0 — дата вивантаження, рядок 1 — заголовки, дані з рядка 2
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const ourArticle = cleanArticle(row[ARTICLE_COL]);
    const fileBrandUpper = String(row[BRAND_COL] ?? '').toUpperCase().trim();
    if (!ourArticle || !fileBrandUpper) continue;

    const key = `${fileBrandUpper}|${ourArticle}`;
    if (!ourKeys.has(key)) {
      notFoundRows++;
      continue;
    }
    const ourBrand = brandCasing.get(fileBrandUpper) as string;

    const crossesRaw = String(row[CROSSES_COL] ?? '').trim();
    if (!crossesRaw) continue;

    const crossNumbers = crossesRaw
      .split('/')
      .map((s) => cleanArticle(s))
      .filter((s) => s.length >= 3 && s !== ourArticle);

    if (crossNumbers.length === 0) continue;

    matchedRows++;

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
  console.log('ІМПОРТ КРОСІВ "CarDon" ЗАВЕРШЕНО');
  console.log('============================================================');
  console.log(`Рядків файлу, де (бренд, артикул) знайдено в нашому каталозі: ${matchedRows}`);
  console.log(`Рядків, товару з якими нема в нашому каталозі:                ${notFoundRows}`);
  console.log(`Знайдено пар "наш товар <-> кросс-номер":                     ${pairsFound}`);
  console.log(`Рядків вставлено в tecdoc_crosses (з двонапрямними):          ${inserter.getTotalInserted()}`);
  console.log('\nПриклади:');
  console.log(examples.join('\n'));
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
