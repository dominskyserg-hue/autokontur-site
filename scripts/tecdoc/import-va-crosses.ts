// ============================================================
// Імпорт кросс-номерів із зовнішнього довідника "VA-10567_*.xlsx"
// (лист "Sheet", 175 646 рядків, 397 різних брендів: 3M, ABE, ADRIAUTO,
// AB Filter...) у tecdoc_crosses.
//
// Файл НЕ належить жодному з наших поточних постачальників (перевірено —
// перетин артикулів із products по конкретному supplier_id мізерний і
// розмазаний по десятку різних постачальників), тому, як і у файлі
// CarDon (import-cardon-crosses.ts), зіставлення йде по ВСЬОМУ каталогу
// одразу за парою (бренд, артикул) — рядок файлу йде в діло лише якщо
// підтверджує РЕАЛЬНИЙ товар, який ми продаємо.
//
// Колонки файлу (0-індексовані, заголовок у рядку 0):
//   Code, Articul, Brand, Name, Cross, BarCode, <7 колонок міст-складів>, Price
// "Cross" — ОДИН кросс-номер на рядок (не список через кому/крапку з
// комою). Зрідка трапляється " / " усередині клітинки — і як розділювач
// ДВОХ різних номерів ("824766422R / 8286100Q0G"), і як суфікс-варіант
// того самого номера без пробілів ("6420907737/2"). Тому спершу
// розбиваємо по "/", а вже потім чистимо кожну частину cleanArticle —
// це коректно розкладає обидва випадки: другий "номер" виявляється
// коротким суфіксом ("2") і відсіюється фільтром довжини, а не
// склеюється з основним номером в одну беззмістовну строку (як сталося
// б, якщо чистити комірку цілком, без попереднього розбиття).
//
// Запуск: npx tsx scripts/tecdoc/import-va-crosses.ts [шлях/до/файлу.xlsx]
// ============================================================

import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './loadEnv';
import { cleanArticle } from './cleanArticle';
import { BatchInserter } from './batchInserter';

loadEnvLocal();

const CROSS_BRAND_LABEL = 'OEM/аналог';
// 50 — той самий розмір батчу, що і в nippon/autohelp/cardon: великі
// батчі (500+) на цьому Neon-з'єднанні мовчки губили частину рядків
const BATCH_SIZE = 50;
const DEFAULT_FILE_PATH = 'C:\\Users\\User\\Downloads\\price\\VA-10567_11092026_0542.xlsx';

const ARTICLE_COL = 1;
const BRAND_COL = 2;
const CROSSES_COL = 4;

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
  const examples: string[] = [];

  for (let i = 1; i < rows.length; i++) {
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

    const crossNumbers = Array.from(
      new Set(
        crossesRaw
          .split('/')
          .map((s) => cleanArticle(s))
          .filter((s) => s.length >= 3 && s !== ourArticle)
      )
    );

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
  console.log('ІМПОРТ КРОСІВ "VA-10567" ЗАВЕРШЕНО');
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
