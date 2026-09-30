// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/items/[itemId]/take-from-stock
//
// Кнопка "Взяти зі складу" в окне заказа: деталь для этой позиции уже
// лежит на НАШЕМ складе — заказывать её у поставщика не нужно.
//
//   Тело запроса: { productId }  — какой товар с нашей полки берём
//                                   (из GET /api/orders/[id]/stock-availability)
//
// Одной транзакцией:
//   1. Проверяем, что свободного остатка этого товара хватает на
//      количество в позиции (lib/warehouseStock.ts: остаток минус то,
//      что уже отложено под другие неотгруженные заказы).
//   2. Позицию "перепривязываем" к товару с полки: product_id, поставщик
//      и закупочная цена — от этого товара. Это важно: при отгрузке
//      заказа склад списывается по product_id позиции (см. shipOrder в
//      app/api/orders/[id]/route.ts) — значит, спишется именно та
//      деталь, которую реально взяли с полки.
//   3. Статус позиции 'pending' -> 'in_stock' и пересчёт статуса заказа
//      (lib/orderStatusPipeline.ts) — если все позиции готовы, заказ
//      сам перейдёт в "На складе".
// Движение склада здесь НЕ создаём: списание — один раз, при отгрузке.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { getWarehouseAvailability } from '@/lib/warehouseStock';
import { autoAdvanceOrderStatus } from '@/lib/orderStatusPipeline';
import { logOrderEvent } from '@/lib/orderHistory';

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> }
) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: orderId, itemId } = await context.params;
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(itemId)) {
    return NextResponse.json({ error: 'id заказа и позиции должны быть корректными UUID.' }, { status: 400 });
  }

  let body: { productId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }
  if (!body.productId || !UUID_PATTERN.test(body.productId)) {
    return NextResponse.json({ error: 'Не указан товар со склада.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemResult = await client.query(
      `SELECT id, article, quantity, status FROM order_items WHERE id = $1 AND order_id = $2 FOR UPDATE`,
      [itemId, orderId]
    );
    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Позиция не найдена в этом заказе.' }, { status: 404 });
    }
    const item = itemResult.rows[0];
    if (item.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Взяти зі складу можна лише позицію, яку ще не замовляли у постачальника.' },
        { status: 400 }
      );
    }

    // FOR UPDATE по товару — если два менеджера одновременно берут одну
    // и ту же деталь с полки в разные заказы, второй подождёт первого и
    // увидит уже уменьшенный свободный остаток
    const productLock = await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [body.productId]);
    if (productLock.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    const [stock] = (await getWarehouseAvailability(client, [item.article], itemId)).filter(
      (s) => s.productId === body.productId
    );
    if (!stock || stock.available < item.quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: `На складі вільно ${stock ? stock.available : 0} шт, а в позиції ${item.quantity} шт — не вистачає.`,
        },
        { status: 400 }
      );
    }

    const updated = await client.query(
      `
      UPDATE order_items
      SET product_id = $3, supplier_id = $4, supplier_name = $5, cost_price = $6, status = 'in_stock'
      WHERE id = $1 AND order_id = $2
      RETURNING id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name, status
      `,
      [itemId, orderId, stock.productId, stock.supplierId, stock.supplierName, stock.costPrice]
    );

    await autoAdvanceOrderStatus(client, orderId);
    await client.query('COMMIT');

    await logOrderEvent(
      orderId,
      `Позиція ${item.article}: взято з нашого складу ${item.quantity} шт (${stock.supplierName}, закупка ${stock.costPrice} грн)`
    );

    const row = updated.rows[0];
    return NextResponse.json({
      success: true,
      item: {
        id: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        price: parseFloat(row.price),
        costPrice: parseFloat(row.cost_price),
        quantity: row.quantity,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        supplierContactName: null,
        status: row.status,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при взятии позиции со склада:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не вдалося взяти зі складу: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
