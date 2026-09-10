// ============================================================
// Імпорт кросс-номерів з прайс-листа постачальника Autohelp (Excel-файл
// "Прайс лист Autohelp DD.MM.YY.xls", лист "TDSheet") у tecdoc_crosses.
//
// НА ВІДМІНУ від файлу Nippon (import-nippon-crosses.ts), тут колонка
// "Номера аналогов" (індекс 4) ВЖЕ вказує бренд для кожного номера:
//
//   "9245021:GSP,4143108001:SSANG YONG,44-20025:ASHIKA,KLP-DW-084:NTY,..."
//
// Формат одного елемента — "НОМЕР:БРЕНД". Список часто включає і сам
// власний артикул товару (напр. рядок з артикулом KLP-DW-084 сам
// містить "KLP-DW-084:NTY" у своєму ж списку аналогів) — такі
// самопосилання пропускаються. Бренд іноді порожній навіть для
// СПРАВДІ іншого номера (напр. "1987302814:," замість
// "1987302814:BOSCH") — у цьому рідкісному випадку, як і для файлу
// Nippon, використовується позначка CROSS_BRAND_LABEL ("OEM/аналог")
// замість вигаданого бренду.
//
// Товари постачальника визначаються за supplier_id (products.article/
// brand для нього) — назва постачальника передається аргументом, бо
// адмін міг завантажити файл під будь-якою назвою постачальника.
//
// Запуск: npx tsx scripts/tecdoc/import-autohelp-crosses.ts [шлях/до/файлу.xls] [назва_постачальника]
// ============================================================

import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './loadEnv';
import { cleanArticle } from './cleanArticle';
import { BatchInserter } from './batchInserter';

loadEnvLocal();

const CROSS_BRAND_LABEL = 'OEM/аналог';
// Великі батчі (500) на цьому Neon-з'єднанні мовчки губили частину
// рядків (той самий ефект, що і при імпорті Nippon) — 50 стабільно
// записує все за один прохід
const BATCH_SIZE = 50;
const DEFAULT_SUPPLIER_NAME = 'HLOD';

// Колонки файлу (0-індексовані, підтверджено інспекцією реального файлу):
//   1 — Артикул
//   4 — Номера аналогов ("НОМЕР:БРЕНД,НОМЕР:БРЕНД,...")
const ARTICLE_COL = 1;
const CROSSES_COL = 4;

async function main() {
  const filePath = process.argv[2];
  const supplierName = process.argv[3] || DEFAULT_SUPPLIER_NAME;

  if (!filePath) {
    console.error('Використання: npx tsx scripts/tecdoc/import-autohelp-crosses.ts <шлях/до/файлу.xls> [назва_постачальника]');
    process.exit(1);
  }

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
  const ourProducts = new Map<string, string>();
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
  console.log(`  Усього рядків у файлі: ${rows.length.toLocaleString('uk-UA')}\n`);

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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const ourArticle = cleanArticle(row[ARTICLE_COL]);
    const ourBrand = ourArticle ? ourProducts.get(ourArticle) : undefined;

    if (!ourArticle || !ourBrand) {
      if (ourArticle) notFoundRows++;
      continue;
    }

    const crossesRaw = String(row[CROSSES_COL] ?? '').trim();
    if (!crossesRaw) continue;

    const crossPairs = crossesRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((segment) => {
        const colonIdx = segment.indexOf(':');
        if (colonIdx === -1) return null;
        const number = cleanArticle(segment.slice(0, colonIdx));
        const brand = segment.slice(colonIdx + 1).trim() || CROSS_BRAND_LABEL;
        return { number, brand };
      })
      .filter((p): p is { number: string; brand: string } => !!p && p.number.length >= 3 && p.number !== ourArticle);

    if (crossPairs.length === 0) continue;

    matchedRows++;
    brandsUsed.add(ourBrand);

    for (const { number, brand } of crossPairs) {
      await inserter.add([ourBrand, ourArticle, brand, number, 'cross']);
      await inserter.add([brand, number, ourBrand, ourArticle, 'cross']);
      pairsFound++;

      if (examples.length < 15) examples.push(`  ${ourBrand} ${ourArticle} <-> ${brand} ${number}`);
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
