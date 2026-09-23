// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/items
// (например /api/orders/3fa85f64-.../items)
//
// Добавляет НОВУЮ позицию в уже существующий заказ — например,
// клиент во время звонка попросил докупить ещё одну деталь к уже
// оформленному заказу. В отличие от [itemId]/route.ts (PATCH,
// правит уже существующую позицию), этот роут СОЗДАЁТ новую строку
// order_items.
//
//   POST /api/orders/[id]/items
//   Тело запроса (JSON):
//   { "productId": "7c9e6679-...", "quantity": 1 }
//
// quantity необязателен (по умолчанию 1) — после добавления менеджер
// всё равно может поправить количество/цену через обычный "✎"
// (PATCH /api/orders/[id]/items/[itemId]), отдельной формы для этого
// здесь нет.
//
// Цена/себестоимость НЕ принимаются из тела запроса — берутся из
// актуального каталога (products.retail_price/cost_price) на момент
// добавления, той же логикой "снимка на момент покупки", что и при
// самом оформлении заказа (app/api/admin/orders/create/route.ts).
// Статус новой позиции — 'pending' ("Очікує закупки"): она только что
// добавлена и её ещё физически нет под рукой, даже если остальные
// позиции заказа уже давно на складе.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface AddOrderItemRequestBody {
  productId?: string;
  quantity?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;

  if (!isValidUuid(orderId)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: AddOrderItemRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.productId || !isValidUuid(body.productId)) {
    return NextResponse.json({ error: 'Укажите productId — корректный UUID товара.' }, { status: 400 });
  }

  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return NextResponse.json({ error: 'Кількість має бути цілим числом більше нуля.' }, { status: 400 });
  }

  try {
    // Заказ не должен быть уже отгружен — склад по нему уже списан, и
    // "докупить" в уже отгруженный заказ означало бы отгрузить товар
    // без реального списания остатка (см. shipOrder() в
    // app/api/orders/[id]/route.ts). Отменённый заказ, наоборот,
    // добавлять можно: сама отмена ничего не списывает и не начисляет,
    // так что дополнить его позже (например, если отменили по ошибке,
    // а клиент всё же хочет забрать заказ) совершенно безопасно
    const orderResult = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }
    const orderStatus = orderResult.rows[0].status as string;
    if (orderStatus === 'shipped') {
      return NextResponse.json(
        { error: 'Заказ уже отгружен — добавить в него новую позицию нельзя. Оформите отдельный заказ.' },
        { status: 400 }
      );
    }

    const productResult = await pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.supplier_id,
             s.name AS supplier_name, s.contact_name AS supplier_contact_name
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1
      `,
      [body.productId]
    );

    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар з таким id не знайдено в каталозі.' }, { status: 404 });
    }

    const product = productResult.rows[0];

    const result = await pool.query(
      `
      INSERT INTO order_items (order_id, product_id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING id, article, brand, name, price, quantity, supplier_id, supplier_name, status
      `,
      [
        orderId,
        product.id,
        product.article,
        product.brand,
        product.name,
        product.retail_price,
        product.cost_price,
        quantity,
        product.supplier_id,
        product.supplier_name,
      ]
    );

    const row = result.rows[0];

    return NextResponse.json(
      {
        success: true,
        item: {
          id: row.id,
          article: row.article,
          brand: row.brand,
          name: row.name,
          // price — колонка NUMERIC, драйвер pg возвращает такие
          // значения строкой, явно переводим в число
          price: parseFloat(row.price),
          quantity: row.quantity,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          supplierContactName: product.supplier_contact_name,
          status: row.status,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при добавлении позиции в заказ:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось добавить товар в заказ: ' + message }, { status: 500 });
  }
}
