// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/products/cross-references/import
//
// Массовая загрузка кросс-номеров из Excel-файла — вкладка "Кроссы"
// в админке (components/CrossReferencesScreen.tsx), раздел "Загрузка
// из Excel". В отличие от загрузки прайс-листа поставщика
// (app/api/suppliers/parse-excel/route.ts), которая СОЗДАЁТ товары,
// этот роут кросс-номера ни к чему не создаёт — он только ПРИВЯЗЫВАЕТ
// их к уже существующим товарам, находя каждый по артикулу.
//
// Каждая строка файла даёт один кросс-номер для одного нашего товара:
//   "Наш артикул" | "Кросс-номер" | "Бренд кросса" (необязательно)
//
// "Наш артикул" ищется СРЕДИ ТОВАРОВ ВЫБРАННОГО ПОСТАВЩИКА — это и
// есть "сверка с базой поставщиков", о которой просил заказчик:
// поставщик выбирается на экране ДО загрузки файла (тот же приём, что
// и на загрузке прайс-листа), поэтому здесь исключена ситуация, когда
// один и тот же артикул случайно принадлежит разным поставщикам и
// кросс-номер приклеился не к тому товару.
//
// Строки, чей артикул не нашёлся у выбранного поставщика, НЕ падают
// всю загрузку — они просто попадают в список notFoundArticles в
// ответе, чтобы админ увидел и поправил (опечатка в артикуле или
// файл собран не для того поставщика).
//
// Повторная загрузка того же файла безопасна: INSERT ... ON CONFLICT
// (product_id, cross_article) DO UPDATE обновляет только бренд, а не
// плодит дубликаты (см. UNIQUE-ограничение в schema.sql)
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
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Та же нормализация артикула, что и везде в проекте (products.article,
// поиск на витрине, ручное добавление кросс-номера) — обязательно
// использовать её и здесь, иначе "AB-123" из Excel не совпадёт с
// "AB123", как он хранится в products.article
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// Переводит букву колонки Excel ("A", "B", ... "AA") ИЛИ номер
// колонки ("1", "2", ...) в индекс массива с отсчётом от нуля — та же
// функция, что и в app/api/suppliers/parse-excel/route.ts
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

interface MappingSettings {
  article: string; // колонка с НАШИМ артикулом
  crossArticle: string; // колонка с кросс-номером
  crossBrand?: string; // колонка с брендом кросса (необязательно)
  startRow: number;
}

interface ParsedRow {
  article: string;
  crossArticle: string;
  crossBrand: string | null;
}

function parseExcelBuffer(buffer: Buffer, mapping: MappingSettings): ParsedRow[] {
  if (!mapping.article || !mapping.crossArticle) {
    throw new Error('Не указаны колонки "Наш артикул" и/или "Кросс-номер"');
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
  const crossArticleIdx = columnToIndex(mapping.crossArticle);
  const crossBrandIdx = mapping.crossBrand ? columnToIndex(mapping.crossBrand) : -1;

  const startIndex = Math.max(0, (mapping.startRow || 1) - 1);

  const parsed: ParsedRow[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const article = cleanArticle(row[articleIdx]);
    const crossArticle = cleanArticle(row[crossArticleIdx]);
    const rawCrossBrand = crossBrandIdx >= 0 ? row[crossBrandIdx] : '';
    const crossBrand = String(rawCrossBrand ?? '').trim() || null;

    if (!article || !crossArticle) continue;

    parsed.push({ article, crossArticle, crossBrand });
  }

  return parsed;
}

interface ImportResult {
  addedCount: number;
  updatedCount: number;
  notFoundArticles: string[];
}

// Сколько артикулов "не найдено" показывать в ответе целиком — при
// сотнях несовпадений незачем гнать в JSON-ответе весь список,
// админу достаточно увидеть первые несколько, чтобы понять причину
// (не тот поставщик выбран, опечатки и т.п.)
const MAX_NOT_FOUND_IN_RESPONSE = 50;

async function importCrossReferences(
  client: PoolClient,
  supplierId: string,
  rows: ParsedRow[]
): Promise<ImportResult> {
  let addedCount = 0;
  let updatedCount = 0;
  const notFoundArticles: string[] = [];

  // По одной строке за раз — файлы с кросс-номерами обычно на порядки
  // короче полного прайс-листа (сотни, не десятки тысяч строк), поэтому
  // пакетная вставка ради скорости здесь не нужна, а по одной строке
  // проще искать product_id по артикулу именно у этого поставщика
  for (const row of rows) {
    const productResult = await client.query(
      `SELECT id FROM products WHERE supplier_id = $1 AND article = $2`,
      [supplierId, row.article]
    );

    if (productResult.rows.length === 0) {
      notFoundArticles.push(row.article);
      continue;
    }

    const productId = productResult.rows[0].id;

    const upsertResult = await client.query(
      `
      INSERT INTO product_cross_references (product_id, cross_article, cross_brand)
      VALUES ($1, $2, $3)
      ON CONFLICT (product_id, cross_article)
      DO UPDATE SET cross_brand = EXCLUDED.cross_brand
      RETURNING (xmax = 0) AS inserted
      `,
      [productId, row.crossArticle, row.crossBrand]
    );

    if (upsertResult.rows[0].inserted) {
      addedCount++;
    } else {
      updatedCount++;
    }
  }

  return {
    addedCount,
    updatedCount,
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

    let mapping: MappingSettings;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json(
        { error: 'Настройки маппинга должны быть корректным JSON.' },
        { status: 400 }
      );
    }

    const supplierResult = await pool.query('SELECT id, name FROM suppliers WHERE id = $1', [supplierId]);
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
      result = await importCrossReferences(client, supplierId, rows);
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
      updatedCount: result.updatedCount,
      notFoundCount: rows.length - result.addedCount - result.updatedCount,
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
