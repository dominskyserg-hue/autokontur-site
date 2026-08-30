// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/cross-references
//
// "Кросс-номер" в автозапчастях — это артикул той же самой (или
// взаимозаменяемой) детали у ДРУГОГО производителя или по оригинальной
// (OEM) нумерации автопроизводителя: одна и та же деталь физически
// продаётся разными брендами под разными артикулами. Экран "Кроссы"
// в админке (components/CrossReferencesScreen.tsx) позволяет привязать
// к нашему товару такие "чужие" номера — тогда покупатель найдёт
// деталь через обычный поиск на витрине, даже если ищет по номеру,
// под которым мы её не продаём (см. WHERE-условие поиска в
// app/api/products/route.ts — оно тоже заглядывает в эту таблицу).
//
//   GET  /api/products/[id]/cross-references  — список кросс-номеров
//        этого товара + сам товар (артикул/бренд/название для шапки
//        экрана в админке)
//
//   POST /api/products/[id]/cross-references  — добавить новый
//        кросс-номер. Тело: { "crossArticle": "0986424815",
//        "crossBrand": "Bosch" } — crossBrand необязателен
//
// [id] — id ТОВАРА В НАШЕМ КАТАЛОГЕ, а не самого кросс-номера
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
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

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Та же самая нормализация, что и для обычного артикула товара (см.
// app/api/products/route.ts и app/api/suppliers/parse-excel/route.ts) —
// кросс-номер должен искаться и сохраняться в точности так же, иначе
// "0986424815" и "0 986 424 815" будут считаться разными номерами
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

interface CrossReferenceResponse {
  id: string;
  crossArticle: string;
  crossBrand: string | null;
  createdAt: string;
}

// ------------------------------------------------------------
// GET — список кросс-номеров товара
// ------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const productResult = await pool.query(
      `SELECT id, article, brand, name FROM products WHERE id = $1`,
      [id]
    );

    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }

    const crossResult = await pool.query(
      `
      SELECT id, cross_article, cross_brand, created_at
      FROM product_cross_references
      WHERE product_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    const crossReferences: CrossReferenceResponse[] = crossResult.rows.map((row) => ({
      id: row.id,
      crossArticle: row.cross_article,
      crossBrand: row.cross_brand,
      createdAt: row.created_at,
    }));

    const productRow = productResult.rows[0];

    return NextResponse.json({
      success: true,
      product: {
        id: productRow.id,
        article: productRow.article,
        brand: productRow.brand,
        name: productRow.name,
      },
      crossReferences,
    });
  } catch (error) {
    console.error('Ошибка при получении кросс-номеров товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить кросс-номера: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// POST — добавить кросс-номер
// ------------------------------------------------------------
interface CreateCrossReferenceBody {
  crossArticle?: string;
  crossBrand?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  let body: CreateCrossReferenceBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const crossArticle = cleanArticle(body.crossArticle);
  const crossBrand = body.crossBrand?.trim() || null;

  if (!crossArticle) {
    return NextResponse.json({ error: 'Укажите кросс-номер.' }, { status: 400 });
  }

  try {
    const productResult = await pool.query('SELECT id FROM products WHERE id = $1', [id]);
    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }

    const result = await pool.query(
      `
      INSERT INTO product_cross_references (product_id, cross_article, cross_brand)
      VALUES ($1, $2, $3)
      RETURNING id, cross_article, cross_brand, created_at
      `,
      [id, crossArticle, crossBrand]
    );

    const row = result.rows[0];
    const crossReference: CrossReferenceResponse = {
      id: row.id,
      crossArticle: row.cross_article,
      crossBrand: row.cross_brand,
      createdAt: row.created_at,
    };

    return NextResponse.json({ success: true, crossReference }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при добавлении кросс-номера:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось добавить кросс-номер: ' + message },
      { status: 500 }
    );
  }
}
