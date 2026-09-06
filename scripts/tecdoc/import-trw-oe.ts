// ============================================================
// Імпорт офіційного OEM-довідника TRW (Excel-файл "Master - TRW NEW
// 2025.xlsx", один аркуш, колонка "OE-Number") у tecdoc_crosses.
//
// НА ВІДМІНУ від scripts/tecdoc/import-dump.ts (той читає величезний
// SQL-дамп TecDoc у форматі mysqldump/pg_dump), тут джерело — звичайний
// Excel-файл з фіксованими іменованими колонками. Формат колонки
// OE-Number у файлі (перевірено на реальних рядках):
//
//   "VOLKSWAGEN 113 415 061"
//   "FORD BD2C3575A"
//   "FIAT 46456652, 5979883, 824910360"                     — кілька
//     номерів одного виробника через кому
//   "FORD 86AU-3503-CA | VOLKSWAGEN 86AU3503CA"              — кілька
//     виробників в одній комірці через " | "
//   "FORD ASIA & OCEANIA B45541920 | KIA 0K201-41920, ..."   — назва
//     виробника сама може складатись з кількох слів
//
// Межу "назва виробника" / "список номерів" визначаємо так: у межах
// одного "|"-сегмента шукаємо ПЕРШУ цифру в рядку, відступаємо назад
// до найближчого пробілу перед нею — усе до цього пробілу вважаємо
// назвою виробника, усе після — списком номерів через кому. Це
// працює навіть для номерів, що починаються з літери ("BD2C3575A",
// "0K201-41920", "A 415 460 01 05") і для багатослівних назв
// виробника ("FORD ASIA & OCEANIA", "MERCEDES-BENZ") — головне, що
// самі назви виробників авто в цьому файлі ніколи не містять цифр.
//
// СВІДОМО імпортуються ЛИШЕ ті артикули TRW, які вже є у власному
// каталозі (products, WHERE brand = 'TRW') — той самий принцип
// звуження, що й у import-dump.ts ("тільки те, що стосується того,
// що ви продаєте", а не всі 80 тисяч артикулів файлу).
//
// Записується з relation_type='oem' (а не 'cross') — генеричні
// крос-номери TRW з попереднього дампа TecDoc (relation_type='cross')
// цей запуск не чіпає і не дублює: у tecdoc_crosses UNIQUE
// (brand_a, article_a, brand_b, article_b, relation_type), тож
// однакова пара з різним relation_type — це два різні рядки, а
// повторний запуск цього скрипта безпечний (ON CONFLICT DO NOTHING).
//
// Запуск: npx tsx scripts/tecdoc/import-trw-oe.ts [шлях/до/файлу.xlsx]
// (за замовчуванням бере шлях до файлу, який прислав користувач)
// ============================================================

import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './loadEnv';
import { cleanArticle } from './cleanArticle';
import { BatchInserter } from './batchInserter';

loadEnvLocal();

const TRW_BRAND = 'TRW';
const BATCH_SIZE = 500;
const DEFAULT_FILE_PATH = 'C:\\Users\\User\\Downloads\\Telegram Desktop\\Master - TRW NEW 2025.xlsx';

interface OePair {
  manufacturer: string;
  number: string;
}

// Розбирає одну комірку колонки OE-Number на пари {виробник, номер} —
// див. пояснення евристики у коментарі на початку файлу
function splitOeCell(raw: string): OePair[] {
  const result: OePair[] = [];
  const segments = raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const digitMatch = /\d/.exec(segment);

    let manufacturer: string;
    let numbersPart: string;

    if (!digitMatch) {
      // Жодної цифри в сегменті — код без цифр трапляється рідко;
      // запасний варіант: перше слово вважаємо виробником
      const spaceIdx = segment.indexOf(' ');
      if (spaceIdx === -1) continue;
      manufacturer = segment.slice(0, spaceIdx);
      numbersPart = segment.slice(spaceIdx + 1);
    } else {
      const spaceBefore = segment.lastIndexOf(' ', digitMatch.index);
      if (spaceBefore === -1) continue; // цифра одразу на початку — назви виробника нема, пропускаємо
      manufacturer = segment.slice(0, spaceBefore);
      numbersPart = segment.slice(spaceBefore + 1);
    }

    manufacturer = manufacturer.replace(/\s+/g, ' ').trim();
    if (!manufacturer) continue;

    for (const rawNumber of numbersPart.split(',')) {
      const number = cleanArticle(rawNumber);
      if (number) result.push({ manufacturer, number });
    }
  }

  return result;
}

async function main() {
  const filePath = process.argv[2] || DEFAULT_FILE_PATH;

  if (!process.env.DATABASE_URL) {
    console.error('Не задано DATABASE_URL (перевірте .env.local в корені проєкту).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  console.log('Крок 1/3: читаємо власні артикули TRW з products...');
  const ourRes = await pool.query("SELECT article FROM products WHERE UPPER(brand) = 'TRW'");
  const ourArticles = new Set(ourRes.rows.map((r) => r.article as string));
  console.log(`  У каталозі ${ourArticles.size} артикулів TRW.\n`);

  if (ourArticles.size === 0) {
    console.log('Немає жодного товару з брендом TRW у products — імпортувати нічого.');
    await pool.end();
    return;
  }

  console.log(`Крок 2/3: читаємо Excel-файл (${filePath})...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const header = rows[0] as string[];
  const oeIdx = header.indexOf('OE-Number');
  if (oeIdx === -1) {
    console.error('У файлі не знайдено колонку "OE-Number" — перевірте, що це той самий формат файлу.');
    process.exit(1);
  }
  console.log(`  Усього рядків даних у файлі: ${(rows.length - 1).toLocaleString('uk-UA')}\n`);

  console.log('Крок 3/3: зіставляємо з каталогом і записуємо нові OEM-кроси...');
  const inserter = new BatchInserter(
    pool,
    'tecdoc_crosses',
    ['brand_a', 'article_a', 'brand_b', 'article_b', 'relation_type'],
    BATCH_SIZE
  );

  let matchedArticles = 0;
  let pairsFound = 0;
  const examples: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cleanedTrwArticle = cleanArticle(rows[i][0]);
    if (!cleanedTrwArticle || !ourArticles.has(cleanedTrwArticle)) continue;

    const oeCellRaw = rows[i][oeIdx];
    if (!oeCellRaw) continue;

    const pairs = splitOeCell(String(oeCellRaw));
    if (pairs.length === 0) continue;

    matchedArticles++;

    for (const { manufacturer, number } of pairs) {
      if (number === cleanedTrwArticle) continue;

      await inserter.add([TRW_BRAND, cleanedTrwArticle, manufacturer, number, 'oem']);
      await inserter.add([manufacturer, number, TRW_BRAND, cleanedTrwArticle, 'oem']);
      pairsFound++;

      if (examples.length < 15) examples.push(`  ${cleanedTrwArticle} <-> ${manufacturer} ${number}`);
    }
  }

  await inserter.flush();
  await pool.end();

  console.log('\n============================================================');
  console.log('ІМПОРТ OEM-КРОСІВ TRW ЗАВЕРШЕНО');
  console.log('============================================================');
  console.log(`Артикулів TRW з нашого каталогу, знайдених у файлі з OE-даними: ${matchedArticles}`);
  console.log(`Знайдено пар "TRW-артикул <-> OEM-номер":                        ${pairsFound}`);
  console.log(`Рядків вставлено в tecdoc_crosses (з двонапрямними):            ${inserter.getTotalInserted()}`);
  console.log('\nПриклади:');
  console.log(examples.join('\n'));
  console.log('============================================================\n');
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
