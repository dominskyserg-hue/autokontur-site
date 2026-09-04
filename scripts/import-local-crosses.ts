// ============================================================
// Одноразовий скрипт: імпортує два готових Excel-файли кросів, знайдені
// локально в Завантаженнях (Telegram Desktop), у таблиці
// cross_reference_groups/cross_reference_members (модель "груп
// взаємозамінності", schema.sql, розділ 11) — та сама модель, що й
// адмінський екран "Кроссы" (components/CrossReferencesScreen.tsx,
// app/api/products/cross-references/import/route.ts), просто вхідні
// файли мають ІНШИЙ формат, ніж очікує той екран (там — "наш артикул +
// крос-бренд + крос-номер" для ОДНОГО конкретного постачальника; тут —
// два різні формати, описані нижче), тому для одноразового разового
// завантаження простіше окремий скрипт, ніж підлаштовувати ці файли
// під формат адмінки.
//
// ФАЙЛ 1: "FEBI cross.xlsx" — офіційний каталог FEBI: власний артикул
//   FEBI (колонка 0) -> номер автовиробника (колонка 9, "Артикул без
//   знаків") + бренд автовиробника (колонка 10, "Бренд в УК"). Пов'язуємо
//   ЛИШЕ ті рядки, де цей FEBI-артикул реально є серед НАШИХ товарів під
//   брендом FEBI/FEBI BILSTEIN — інакше зв'язок нікуди не веде.
//
// ФАЙЛ 2: "кроссы подвеска.xlsx" — готові групи взаємозамінності деталей
//   підвіски: кожен рядок "Артикул + Бренд" належить до групи за
//   значенням "ВнутреннийАналог" (той самий код на кшталт "LD0075020"
//   групує десятки брендів одного й того ж вузла). Пов'язуємо ЛИШЕ ті
//   групи, де хоча б ОДИН учасник реально є серед наших товарів.
//
// ФАЙЛ 3: "Master - TRW NEW 2025.xlsx" — той самий принцип, що й FEBI
//   cross.xlsx (importOemCrossFile), лише інші індекси колонок: власний
//   артикул TRW (колонка 0) -> Manufacturer (колонка 25) + OE-Number
//   (колонка 28).
//
// ФАЙЛ 4: "FERDINAND BILTREIN_Baltics A 01.04.2026.xlsb" — прайс-каталог
//   материнської компанії febi/Bilstein з тими самими OE-номерами, лише
//   у ФОРМАТІ ПРАЙС-ЛИСТА (а не окремого "cross"-файлу): власний артикул
//   Febi (колонка 0) -> Type/марка авто (колонка 6) + OE Reference
//   (колонка 7). Частково перетинається з FEBI cross.xlsx — це не
//   проблема: linkParts() безпечно пропускає вже наявні зв'язки
//   (already_linked), нових дублікатів не з'явиться.
//
// ФАЙЛИ 5-6: "Nissens WP.xlsx" і "Китайские артикулы Mann.xlsx" —
//   формат "Артикул | Бренд | Артикул | Бренд | Назва", пряма пара
//   деталь-деталь без групування (importPairCrossFile). Пов'язуємо
//   рядок, якщо ХОЧА Б ОДНА зі сторін пари — наш товар (на відміну від
//   файлу FEBI/TRW/FERDINAND, де саме ліва сторона завжди наша).
//
// В усіх файлах номери "автовиробника"/OEM визначаються звіркою з
// курованим списком реальних марок авто (lib/carMakes.ts) — так вони
// потрапляють у базу з part_type='oem', а решта — 'aftermarket', так
// само, як розрізняє їх app/api/products/cross-lookup/route.ts.
//
// Джерело (source) для ОБОХ файлів — 'official': це не голе
// припущення адміністратора, а вивантаження з реального каталогу
// виробника/структурованого джерела, а не ручний ввід "на око".
//
// Запуск: npx tsx scripts/import-local-crosses.ts
// ============================================================

import { Pool, PoolClient } from 'pg';
import * as XLSX from 'xlsx';
import { loadEnvLocal } from './tecdoc/loadEnv';
import { getCarMakeByDbValue } from '../lib/carMakes';

loadEnvLocal();

const FEBI_FILE = 'C:/Users/User/Downloads/Telegram Desktop/FEBI cross.xlsx';
const SUSPENSION_FILE = 'C:/Users/User/Downloads/Telegram Desktop/кроссы подвеска.xlsx';
const TRW_FILE = 'C:/Users/User/Downloads/Telegram Desktop/Master - TRW NEW 2025.xlsx';
const FERDINAND_FILE = 'C:/Users/User/Downloads/Telegram Desktop/FERDINAND BILTREIN_Baltics A 01.04.2026.xlsb';
const NISSENS_FILE = 'C:/Users/User/Downloads/Telegram Desktop/Nissens WP.xlsx';
const MANN_CHINA_FILE = 'C:/Users/User/Downloads/Telegram Desktop/Китайские артикулы Mann.xlsx';

function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';
  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

type PartType = 'oem' | 'aftermarket';

function partTypeForBrand(brand: string): PartType {
  return getCarMakeByDbValue(brand) ? 'oem' : 'aftermarket';
}

interface PartRef {
  brand: string;
  partNumber: string; // вже очищений cleanArticle()
  partNumberRaw: string | null;
  productId: string | null;
  partType: PartType;
}

// Та сама модель "зв'язати A з B", що й у app/api/products/[id]/
// cross-references/route.ts і app/api/products/cross-references/
// import/route.ts (проєкт свідомо дублює цю логіку в кожному
// самодостатньому роуті — тут так само, а не імпортом з app/, щоб
// скрипт можна було видалити після одноразового запуску, не займаючи
// нічого спільного)
async function linkParts(
  client: PoolClient,
  partA: PartRef,
  partB: PartRef,
  sourceFile: string
): Promise<'created' | 'linked' | 'already_linked' | 'conflict'> {
  const memberAResult = await client.query(
    `SELECT id, group_id FROM cross_reference_members WHERE brand = $1 AND part_number = $2`,
    [partA.brand, partA.partNumber]
  );
  const memberBResult = await client.query(
    `SELECT id, group_id FROM cross_reference_members WHERE brand = $1 AND part_number = $2`,
    [partB.brand, partB.partNumber]
  );
  const memberA = memberAResult.rows[0] as { id: string; group_id: string } | undefined;
  const memberB = memberBResult.rows[0] as { id: string; group_id: string } | undefined;

  if (!memberA && !memberB) {
    const groupResult = await client.query(`INSERT INTO cross_reference_groups DEFAULT VALUES RETURNING id`);
    const groupId = groupResult.rows[0].id;
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'official')`,
      [groupId, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType]
    );
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'official')`,
      [groupId, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType]
    );
    return 'created';
  }

  if (memberA && !memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'official')`,
      [memberA.group_id, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType]
    );
    return 'linked';
  }

  if (!memberA && memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, 'official')`,
      [memberB.group_id, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType]
    );
    return 'linked';
  }

  if (memberA!.group_id === memberB!.group_id) return 'already_linked';

  await client.query(
    `
    INSERT INTO cross_reference_conflicts
      (part_a_brand, part_a_number, part_b_brand, part_b_number, existing_group_a, existing_group_b, source, source_file)
    VALUES ($1, $2, $3, $4, $5, $6, 'official', $7)
    `,
    [partA.brand, partA.partNumber, partB.brand, partB.partNumber, memberA!.group_id, memberB!.group_id, sourceFile]
  );
  return 'conflict';
}

interface Stats {
  created: number;
  linked: number;
  alreadyLinked: number;
  conflict: number;
}

function emptyStats(): Stats {
  return { created: 0, linked: 0, alreadyLinked: 0, conflict: 0 };
}

function record(stats: Stats, outcome: Awaited<ReturnType<typeof linkParts>>) {
  if (outcome === 'created') stats.created++;
  else if (outcome === 'linked') stats.linked++;
  else if (outcome === 'already_linked') stats.alreadyLinked++;
  else stats.conflict++;
}

// ------------------------------------------------------------
// ФАЙЛ 1: FEBI cross.xlsx
// ------------------------------------------------------------
async function importFebiCross(pool: Pool): Promise<Stats> {
  const stats = emptyStats();

  const febiProducts = await pool.query(`SELECT id, brand, article FROM products WHERE brand ILIKE '%febi%'`);
  const byArticle = new Map<string, { id: string; brand: string; article: string }>();
  for (const row of febiProducts.rows) {
    byArticle.set(cleanArticle(row.article), row);
  }

  const workbook = XLSX.readFile(FEBI_FILE, { sheetRows: 200_000 });
  const sheet = workbook.Sheets['Sheet1'];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const febiArticle = cleanArticle(row[0]);
      if (!febiArticle) continue;

      const ourProduct = byArticle.get(febiArticle);
      if (!ourProduct) continue;

      const oemArticle = cleanArticle(row[9]);
      const oemBrandRaw = String(row[10] ?? '').trim();
      if (!oemArticle || !oemBrandRaw) continue;

      const outcome = await linkParts(
        client,
        {
          brand: ourProduct.brand,
          partNumber: cleanArticle(ourProduct.article),
          partNumberRaw: ourProduct.article,
          productId: ourProduct.id,
          partType: 'aftermarket',
        },
        {
          brand: oemBrandRaw,
          partNumber: oemArticle,
          partNumberRaw: String(row[12] ?? row[9] ?? '').trim() || oemArticle,
          productId: null,
          partType: partTypeForBrand(oemBrandRaw),
        },
        'FEBI cross.xlsx'
      );
      record(stats, outcome);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return stats;
}

// ------------------------------------------------------------
// ФАЙЛ 2: кроссы подвеска.xlsx
// ------------------------------------------------------------
async function importSuspensionCrosses(pool: Pool): Promise<Stats> {
  const stats = emptyStats();

  const ourProducts = await pool.query(`SELECT id, brand, article FROM products`);
  const byBrandArticle = new Map<string, { id: string; brand: string; article: string }>();
  for (const row of ourProducts.rows) {
    byBrandArticle.set(`${cleanArticle(row.brand)}||${cleanArticle(row.article)}`, row);
  }

  const workbook = XLSX.readFile(SUSPENSION_FILE);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Групуємо рядки файлу за "ВнутреннийАналог" — так само, як вони вже
  // згруповані в самому файлі, лише зручнішою для коду структурою
  const groups = new Map<string, { brand: string; article: string }[]>();
  for (let i = 1; i < rows.length; i++) {
    const [article, brand, analog] = rows[i] as [string, string, string];
    if (!article || !brand || !analog) continue;
    if (!groups.has(analog)) groups.set(analog, []);
    groups.get(analog)!.push({ brand: String(brand).trim(), article: String(article).trim() });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const members of groups.values()) {
      // Пропускаємо групи, де ЖОДЕН учасник не є нашим товаром — для
      // них зв'язок поки нікуди не веде і лише засмічував би базу
      const hasOwnMember = members.some((m) =>
        byBrandArticle.has(`${cleanArticle(m.brand)}||${cleanArticle(m.article)}`)
      );
      if (!hasOwnMember) continue;

      // З'єднуємо учасників групи ЛАНЦЮЖКОМ (0-1, 1-2, 2-3...) —
      // linkParts сам підхоплює вже існуючу групу першого учасника й
      // приєднує до неї решту, тому одного ланцюжка досить, щоб усі
      // члени опинились в ОДНІЙ спільній групі
      for (let i = 0; i < members.length - 1; i++) {
        const a = members[i];
        const b = members[i + 1];

        const ownA = byBrandArticle.get(`${cleanArticle(a.brand)}||${cleanArticle(a.article)}`);
        const ownB = byBrandArticle.get(`${cleanArticle(b.brand)}||${cleanArticle(b.article)}`);

        const outcome = await linkParts(
          client,
          {
            brand: a.brand,
            partNumber: cleanArticle(a.article),
            partNumberRaw: a.article,
            productId: ownA?.id ?? null,
            partType: partTypeForBrand(a.brand),
          },
          {
            brand: b.brand,
            partNumber: cleanArticle(b.article),
            partNumberRaw: b.article,
            productId: ownB?.id ?? null,
            partType: partTypeForBrand(b.brand),
          },
          'кроссы подвеска.xlsx'
        );
        record(stats, outcome);
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return stats;
}

// ------------------------------------------------------------
// ЗАГАЛЬНИЙ ІМПОРТЕР ДЛЯ ФАЙЛІВ ФОРМАТУ "наш артикул -> OE-номер"
// (Master - TRW NEW 2025.xlsx, FERDINAND BILTREIN_Baltics — та сама
// модель, що й FEBI cross.xlsx вище, лише інші індекси колонок і
// фільтр бренду, тому винесено в одну функцію замість копіювання)
// ------------------------------------------------------------
interface OemCrossFileConfig {
  filePath: string;
  sheetName: string;
  ourBrandIlike: string; // напр. '%trw%' — яким брендом шукати НАШІ товари
  articleCol: number; // колонка з власним артикулом виробника
  oemBrandCol: number; // колонка з маркою автовиробника (Manufacturer/Type)
  oemArticleCol: number; // колонка з номером автовиробника (OE-Number/OE Reference)
  sourceLabel: string;
}

async function importOemCrossFile(pool: Pool, config: OemCrossFileConfig): Promise<Stats> {
  const stats = emptyStats();

  const ourProducts = await pool.query(`SELECT id, brand, article FROM products WHERE brand ILIKE $1`, [
    config.ourBrandIlike,
  ]);
  const byArticle = new Map<string, { id: string; brand: string; article: string }>();
  for (const row of ourProducts.rows) {
    byArticle.set(cleanArticle(row.article), row);
  }

  const workbook = XLSX.readFile(config.filePath);
  const sheet = workbook.Sheets[config.sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const ownArticle = cleanArticle(row[config.articleCol]);
      if (!ownArticle) continue;

      const ourProduct = byArticle.get(ownArticle);
      if (!ourProduct) continue;

      const oemArticleRaw = String(row[config.oemArticleCol] ?? '').trim();
      const oemBrandRaw = String(row[config.oemBrandCol] ?? '').trim();
      const oemArticle = cleanArticle(oemArticleRaw);
      if (!oemArticle || !oemBrandRaw) continue;

      const outcome = await linkParts(
        client,
        {
          brand: ourProduct.brand,
          partNumber: cleanArticle(ourProduct.article),
          partNumberRaw: ourProduct.article,
          productId: ourProduct.id,
          partType: 'aftermarket',
        },
        {
          brand: oemBrandRaw,
          partNumber: oemArticle,
          partNumberRaw: oemArticleRaw,
          productId: null,
          partType: partTypeForBrand(oemBrandRaw),
        },
        config.sourceLabel
      );
      record(stats, outcome);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return stats;
}

// ------------------------------------------------------------
// ЗАГАЛЬНИЙ ІМПОРТЕР ДЛЯ ФАЙЛІВ ФОРМАТУ "Артикул | Бренд | Артикул |
// Бренд | Назва" (Nissens WP.xlsx, Китайские артикулы Mann.xlsx) —
// пряма пара "деталь A <-> деталь B", без групування
// ------------------------------------------------------------
interface PairCrossFileConfig {
  filePath: string;
  sheetName: string;
  hasHeader: boolean;
  sourceLabel: string;
}

async function importPairCrossFile(pool: Pool, config: PairCrossFileConfig): Promise<Stats> {
  const stats = emptyStats();

  const ourProducts = await pool.query(`SELECT id, brand, article FROM products`);
  const byBrandArticle = new Map<string, { id: string; brand: string; article: string }>();
  for (const row of ourProducts.rows) {
    byBrandArticle.set(`${cleanArticle(row.brand)}||${cleanArticle(row.article)}`, row);
  }

  const workbook = XLSX.readFile(config.filePath);
  const sheet = workbook.Sheets[config.sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const startIndex = config.hasHeader ? 1 : 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i] as [string, string, string, string, string?];
      const [article, brand, crossArticle, crossBrand] = row;
      if (!article || !brand || !crossArticle || !crossBrand) continue;

      // Пропускаємо рядки, де НІ одна з двох сторін не є нашим товаром —
      // такий зв'язок поки нікуди не веде
      const keyA = `${cleanArticle(brand)}||${cleanArticle(article)}`;
      const keyB = `${cleanArticle(crossBrand)}||${cleanArticle(crossArticle)}`;
      const ownA = byBrandArticle.get(keyA);
      const ownB = byBrandArticle.get(keyB);
      if (!ownA && !ownB) continue;

      const outcome = await linkParts(
        client,
        {
          brand: String(brand).trim(),
          partNumber: cleanArticle(article),
          partNumberRaw: String(article).trim(),
          productId: ownA?.id ?? null,
          partType: partTypeForBrand(String(brand).trim()),
        },
        {
          brand: String(crossBrand).trim(),
          partNumber: cleanArticle(crossArticle),
          partNumberRaw: String(crossArticle).trim(),
          productId: ownB?.id ?? null,
          partType: partTypeForBrand(String(crossBrand).trim()),
        },
        config.sourceLabel
      );
      record(stats, outcome);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return stats;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Не задано DATABASE_URL (перевірте .env.local в корені проєкту).');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  console.log('Імпортуємо FEBI cross.xlsx...');
  const febiStats = await importFebiCross(pool);
  console.log('  Готово:', febiStats);

  console.log('Імпортуємо кроссы подвеска.xlsx...');
  const suspensionStats = await importSuspensionCrosses(pool);
  console.log('  Готово:', suspensionStats);

  console.log('Імпортуємо Master - TRW NEW 2025.xlsx...');
  const trwStats = await importOemCrossFile(pool, {
    filePath: TRW_FILE,
    sheetName: 'Tabelle1',
    ourBrandIlike: '%trw%',
    articleCol: 0, // TRW
    oemBrandCol: 25, // Manufacturer
    oemArticleCol: 28, // OE-Number
    sourceLabel: 'Master - TRW NEW 2025.xlsx',
  });
  console.log('  Готово:', trwStats);

  console.log('Імпортуємо FERDINAND BILTREIN_Baltics (febi/Bilstein OE)...');
  const ferdinandStats = await importOemCrossFile(pool, {
    filePath: FERDINAND_FILE,
    sheetName: 'Master',
    ourBrandIlike: '%febi%',
    articleCol: 0, // Febi
    oemBrandCol: 6, // Type (марка авто)
    oemArticleCol: 7, // OE Reference
    sourceLabel: 'FERDINAND BILTREIN_Baltics A 01.04.2026.xlsb',
  });
  console.log('  Готово:', ferdinandStats);

  console.log('Імпортуємо Nissens WP.xlsx...');
  const nissensStats = await importPairCrossFile(pool, {
    filePath: NISSENS_FILE,
    sheetName: 'Лист2',
    hasHeader: false,
    sourceLabel: 'Nissens WP.xlsx',
  });
  console.log('  Готово:', nissensStats);

  console.log('Імпортуємо Китайские артикулы Mann.xlsx...');
  const mannStats = await importPairCrossFile(pool, {
    filePath: MANN_CHINA_FILE,
    sheetName: 'Лист1',
    hasHeader: true,
    sourceLabel: 'Китайские артикулы Mann.xlsx',
  });
  console.log('  Готово:', mannStats);

  await pool.end();

  console.log('\n============================================================');
  console.log('ІМПОРТ ЗАВЕРШЕНО');
  console.log('FEBI:               ', febiStats);
  console.log('Підвіска:           ', suspensionStats);
  console.log('TRW:                ', trwStats);
  console.log('FERDINAND BILTREIN: ', ferdinandStats);
  console.log('Nissens WP:         ', nissensStats);
  console.log('Китайские Mann:     ', mannStats);
  console.log('============================================================');
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
