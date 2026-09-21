// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/procurement/order-from-supplier
//
// Шаг 1 закупочного цикла: менеджер отметил на экране "Закупки"
// конкретные позиции (обычно все — одного поставщика) и нажал
// "Сформировать заказ поставщику".
//
//   Тело запроса: { orderItemIds: string[] }
//
// Что делает:
//   1. Переводит order_items.status 'pending' -> 'ordered_from_supplier'
//      для переданных id (и только для тех, что реально ещё 'pending' —
//      если кто-то другой уже обработал часть из них, они просто
//      игнорируются, а не ломают весь запрос).
//   2. Для каждого затронутого заказа проверяет, не пора ли двинуть
//      вперёд и сам orders.status (см. lib/orderStatusPipeline.ts).
//   3. Возвращает обновлённые позиции — этого достаточно, чтобы на
//      фронтенде сразу собрать печатную форму заказа поставщику
//      (артикул/бренд/количество/закупочная цена), без отдельного
//      запроса.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { autoAdvanceOrderStatus } from '@/lib/orderStatusPipeline';

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

interface RequestBody {
  orderItemIds?: string[];
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const orderItemIds = body.orderItemIds;
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return NextResponse.json({ error: 'Выберите хотя бы одну позицию для заказа поставщику.' }, { status: 400 });
  }
  if (orderItemIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'Некорректный id позиции заказа.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateResult = await client.query(
      `
      UPDATE order_items
      SET status = 'ordered_from_supplier'
      WHERE id = ANY($1::uuid[]) AND status = 'pending'
      RETURNING id, order_id, article, brand, name, quantity, cost_price, supplier_id, supplier_name
      `,
      [orderItemIds]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Ни одна из выбранных позиций больше не в статусе "Ожидает закупки" — возможно, их уже обработали.' },
        { status: 400 }
      );
    }

    const orderIds = Array.from(new Set(updateResult.rows.map((row) => row.order_id as string)));
    for (const orderId of orderIds) {
      await autoAdvanceOrderStatus(client, orderId);
    }

    await client.query('COMMIT');

    const items = updateResult.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      quantity: row.quantity,
      costPrice: parseFloat(row.cost_price),
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
    }));

    const skippedCount = orderItemIds.length - updateResult.rows.length;

    return NextResponse.json({
      success: true,
      items,
      updatedOrderIds: orderIds,
      skippedCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при оформлении заказа поставщику:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось оформить заказ поставщику: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
