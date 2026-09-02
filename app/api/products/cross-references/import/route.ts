// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/products/cross-references/import
//
// Массовая загрузка кросс-номеров из Excel-файла — вкладка "Кроссы"
// в админке (components/CrossReferencesScreen.tsx). В отличие от
// загрузки прайс-листа поставщика (app/api/suppliers/parse-excel/
// route.ts), которая СОЗДАЁТ товары, этот роут кросс-номера ни к чему
// не создаёт — он связывает НАШ товар (найденный по артикулу СРЕДИ
// ТОВАРОВ ВЫБРАННОГО ПОСТАВЩИКА — та самая "сверка с базой
// поставщиков") с "чужой" деталью (бренд + номер), используя модель
// "групп взаимозаменяемости" (см. schema.sql, раздел 11, и подробное
// объяснение алгоритма в linkParts() ниже).
//
// Каждая строка файла даёт одну связь:
//   "Наш артикул" | "Кросс-бренд" | "Кросс-номер" | "Тип" (необязательно)
//
// "Тип" — oem или aftermarket, по умолчанию aftermarket, если колонка
// не указана или в ячейке пусто. Источник (source) для ВСЕГО файла
// один — 'official' по умолчанию (загрузка структурированного файла —
// это не то же самое, что ручная правка "на глаз" через форму), но
// админ может явно выбрать другой на экране перед загрузкой.
//
// Строки, чей "наш артикул" не нашёлся у выбранного поставщика, НЕ
// ломают всю загрузку — попадают в notFoundArticles в ответе.
// Строки, которые попытались бы объединить два уже РАЗНЫХ существующих
// кластера деталей, тоже не проваливают загрузку — уходят в
// cross_reference_conflicts на ручную проверку (см. экран "Конфликты"),
// а счётчик conflictCount показывает, сколько таких строк было.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Pool, PoolClient } from 'pg';

// Библиотеки xlsx и pg используют Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Та же нормализация артикула, что и везде в проекте
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// Переводит букву колонки Excel ("A", "B", ... "AA") ИЛИ номер
// колонки ("1", "2", ...) в индекс массива с отсчётом от нуля
function columnToIndex(value: string): number {
  const clean = value.trim().toUpperCase();

  if (/^[0-9]+$/.test(clean)) {
    return parseInt(clean, 10) - 1;
  }

  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i) - 64;
    index = index * 26 + code;
  }
  return index - 1;
}

const PART_TYPE_VALUES = ['oem', 'aftermarket'] as const;
type PartType = (typeof PART_TYPE_VALUES)[number];
function isValidPartType(value: string): value is PartType {
  return (PART_TYPE_VALUES as readonly string[]).includes(value);
}

const SOURCE_VALUES = ['official', 'user-reported', 'algorithmic'] as const;
type Source = (typeof SOURCE_VALUES)[number];
function isValidSource(value: string): value is Source {
  return (SOURCE_VALUES as readonly string[]).includes(value);
}

const IMPORT_SOURCE_DEFAULT: Source = 'official';

interface MappingSettings {
  article: string; // колонка с НАШИМ артикулом
  crossBrand: string; // колонка с брендом кросса
  crossArticle: string; // колонка с кросс-номером
  partType?: string; // колонка с типом (oem/aftermarket), необязательно
  startRow: number;
}

interface ParsedRow {
  article: string;
  crossBrand: string;
  crossArticle: string;
  partType: PartType;
}

function parseExcelBuffer(buffer: Buffer, mapping: MappingSettings): ParsedRow[] {
  if (!mapping.article || !mapping.crossBrand || !mapping.crossArticle) {
    throw new Error('Не указаны колонки "Наш артикул", "Кросс-бренд" и/или "Кросс-номер"');
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('В файле не найдено ни одного листа');
  }
  const sheet = workbook.Sheets[firstSheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  const articleIdx = columnToIndex(mapping.article);
  const crossBrandIdx = columnToIndex(mapping.crossBrand);
  const crossArticleIdx = columnToIndex(mapping.crossArticle);
  const partTypeIdx = mapping.partType ? columnToIndex(mapping.partType) : -1;

  const startIndex = Math.max(0, (mapping.startRow || 1) - 1);

  const parsed: ParsedRow[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const article = cleanArticle(row[articleIdx]);
    const crossBrand = String(row[crossBrandIdx] ?? '').trim();
    const crossArticle = cleanArticle(row[crossArticleIdx]);
    const rawPartType = partTypeIdx >= 0 ? String(row[partTypeIdx] ?? '').trim().toLowerCase() : '';
    const partType: PartType = rawPartType === 'oem' ? 'oem' : 'aftermarket';

    if (!article || !crossBrand || !crossArticle) continue;

    parsed.push({ article, crossBrand, crossArticle, partType });
  }

  return parsed;
}

// ------------------------------------------------------------
// ЯДРО МОДЕЛИ: связать деталь A с деталью B в одну группу
// взаимозаменяемости. Та же логика, что и в app/api/products/[id]/
// cross-references/route.ts (POST) — продублирована здесь намеренно,
// как и остальной код в этом проекте: каждый роут самодостаточен
// (см. одинаковый globalThis.pgPool в каждом файле)
// ------------------------------------------------------------
interface PartRef {
  brand: string;
  partNumber: string; // уже очищенный cleanArticle()
  partNumberRaw: string | null;
  productId: string | null;
  partType: PartType;
}

type LinkOutcome =
  | { action: 'created' | 'linked' | 'already_linked' }
  | { action: 'conflict'; conflictId: string };

async function linkParts(
  client: PoolClient,
  partA: PartRef,
  partB: PartRef,
  source: Source,
  sourceFile: string | null
): Promise<LinkOutcome> {
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
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [groupId, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType, source]
    );
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [groupId, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType, source]
    );

    return { action: 'created' };
  }

  if (memberA && !memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberA.group_id, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType, source]
    );
    return { action: 'linked' };
  }

  if (!memberA && memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberB.group_id, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType, source]
    );
    return { action: 'linked' };
  }

  if (memberA!.group_id === memberB!.group_id) {
    return { action: 'already_linked' };
  }

  const conflictResult = await client.query(
    `
    INSERT INTO cross_reference_conflicts
      (part_a_brand, part_a_number, part_b_brand, part_b_number, existing_group_a, existing_group_b, source, source_file)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [partA.brand, partA.partNumber, partB.brand, partB.partNumber, memberA!.group_id, memberB!.group_id, source, sourceFile]
  );

  return { action: 'conflict', conflictId: conflictResult.rows[0].id };
}

interface ImportResult {
  addedCount: number; // action === 'created' | 'linked'
  alreadyLinkedCount: number;
  conflictCount: number;
  notFoundArticles: string[];
}

const MAX_NOT_FOUND_IN_RESPONSE = 50;

async function importCrossReferences(
  client: PoolClient,
  supplierId: string,
  rows: ParsedRow[],
  source: Source,
  sourceFile: string | null
): Promise<ImportResult> {
  let addedCount = 0;
  let alreadyLinkedCount = 0;
  let conflictCount = 0;
  const notFoundArticles: string[] = [];

  for (const row of rows) {
    const productResult = await client.query(
      `SELECT id, article, brand FROM products WHERE supplier_id = $1 AND article = $2`,
      [supplierId, row.article]
    );

    if (productResult.rows.length === 0) {
      notFoundArticles.push(row.article);
      continue;
    }

    const product = productResult.rows[0];
    if (!product.brand) {
      // Без бренда нашего товара невозможно однозначно определить его
      // как "деталь" в модели кроссов (brand+part_number — уникальная
      // пара) — пропускаем строку так же, как "не найдено"
      notFoundArticles.push(row.article);
      continue;
    }

    const outcome = await linkParts(
      client,
      {
        brand: product.brand,
        partNumber: product.article,
        partNumberRaw: product.article,
        productId: product.id,
        partType: 'aftermarket',
      },
      {
        brand: row.crossBrand,
        partNumber: row.crossArticle,
        partNumberRaw: row.crossArticle,
        productId: null,
        partType: row.partType,
      },
      source,
      sourceFile
    );

    if (outcome.action === 'created' || outcome.action === 'linked') {
      addedCount++;
    } else if (outcome.action === 'already_linked') {
      alreadyLinkedCount++;
    } else {
      conflictCount++;
    }
  }

  return {
    addedCount,
    alreadyLinkedCount,
    conflictCount,
    notFoundArticles: notFoundArticles.slice(0, MAX_NOT_FOUND_IN_RESPONSE),
  };
}

// ------------------------------------------------------------
// ОБРАБОТЧИК POST-ЗАПРОСА
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    const mappingRaw = formData.get('mapping');
    const supplierId = formData.get('supplierId');
    const sourceRaw = formData.get('source');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не найден в запросе. Ожидается поле "file".' },
        { status: 400 }
      );
    }

    if (!supplierId || typeof supplierId !== 'string' || !isValidUuid(supplierId)) {
      return NextResponse.json(
        { error: 'Не передан корректный id поставщика (поле "supplierId").' },
        { status: 400 }
      );
    }

    if (!mappingRaw || typeof mappingRaw !== 'string') {
      return NextResponse.json(
        { error: 'Не переданы настройки маппинга (поле "mapping").' },
        { status: 400 }
      );
    }

    const source: Source =
      typeof sourceRaw === 'string' && isValidSource(sourceRaw) ? sourceRaw : IMPORT_SOURCE_DEFAULT;

    let mapping: MappingSettings;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json(
        { error: 'Настройки маппинга должны быть корректным JSON.' },
        { status: 400 }
      );
    }

    const supplierResult = await pool.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierResult.rows.length === 0) {
      return NextResponse.json({ error: 'Поставщик с таким id не найден.' }, { status: 404 });
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимальный размер — 10 МБ.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const rows = parseExcelBuffer(buffer, mapping);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'В файле не найдено ни одной строки с данными. Проверьте настройки маппинга.' },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    let result: ImportResult;
    try {
      await client.query('BEGIN');
      result = await importCrossReferences(client, supplierId, rows, source, file.name || null);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      addedCount: result.addedCount,
      alreadyLinkedCount: result.alreadyLinkedCount,
      conflictCount: result.conflictCount,
      notFoundCount:
        rows.length - result.addedCount - result.alreadyLinkedCount - result.conflictCount,
      notFoundArticles: result.notFoundArticles,
    });
  } catch (error) {
    console.error('Ошибка при массовой загрузке кросс-номеров:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обработать файл: ' + message },
      { status: 500 }
    );
  }
}
