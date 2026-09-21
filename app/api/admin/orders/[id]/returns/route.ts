// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/orders/[id]/returns
//
// Оформление возврата ОДНОЙ позиции заказа от клиента (частичный или
// полный по количеству). Один запрос — один customer_returns с одним
// customer_return_items: возврат нескольких разных позиций заказа
// оформляется несколькими отдельными запросами, а не одним "пакетом" —
// так проще и честнее выглядит история (каждая причина/способ возврата
// денег фиксируется отдельно, а не размазывается на несколько позиций
// сразу).
//
// Одной транзакцией (секция 28 schema.sql):
//   1. customer_returns — сама запись о возврате
//   2. customer_return_items — какая позиция и сколько шт.
//   3. Если restock (не брак) — stock_movements + возврат на склад
//      (products.stock увеличивается)
//   4. customer_transactions — списание суммы возврата с долга клиента
//      (amount отрицательный), affects_customer_balance = true только
//      если refund_method = 'balance' (наличные/карта — мимо баланса,
//      см. ту же логику, что и в /api/admin/customers/[id]/transactions)
//   5. Если вернули ВСЮ ранее не возвращённую часть количества позиции —
//      order_items.status = 'returned'
//
//   POST /api/admin/orders/[id]/returns
//   Тело запроса:
//   {
//     "orderItemId": "uuid",
//     "quantity": number,
//     "reason": "defect" | "customer_mistake" | "staff_mistake" | "refused",
//     "refundMethod": "balance" | "cash" | "card",
//     "comment": string  // необязательно
//   }
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

const REASONS = ['defect', 'customer_mistake', 'staff_mistake', 'refused'] as const;
type Reason = (typeof REASONS)[number];

const REFUND_METHODS = ['balance', 'cash', 'card'] as const;
type RefundMethod = (typeof REFUND_METHODS)[number];

interface CreateReturnRequestBody {
  orderItemId?: string;
  quantity?: number;
  reason?: string;
  refundMethod?: string;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;

  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: 'Некорректный id заказа.' }, { status: 400 });
  }

  let body: CreateReturnRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.orderItemId || !UUID_PATTERN.test(body.orderItemId)) {
    return NextResponse.json({ error: 'Укажите корректный id позиции заказа.' }, { status: 400 });
  }
  if (!Number.isInteger(body.quantity) || (body.quantity as number) <= 0) {
    return NextResponse.json({ error: 'Количество должно быть целым числом больше нуля.' }, { status: 400 });
  }
  if (!body.reason || !REASONS.includes(body.reason as Reason)) {
    return NextResponse.json({ error: `Причина должна быть одной из: ${REASONS.join(', ')}.` }, { status: 400 });
  }
  if (!body.refundMethod || !REFUND_METHODS.includes(body.refundMethod as RefundMethod)) {
    return NextResponse.json({ error: `Способ возврата денег должен быть одним из: ${REFUND_METHODS.join(', ')}.` }, { status: 400 });
  }

  const comment = (body.comment || '').trim() || null;
  const restock = body.reason !== 'defect';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query('SELECT id, customer_id FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const customerId: string | null = orderResult.rows[0].customer_id;

    const itemResult = await client.query(
      `SELECT id, product_id, price, quantity FROM order_items WHERE id = $1 AND order_id = $2`,
      [body.orderItemId, orderId]
    );
    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Позиция заказа не найдена в этом заказе.' }, { status: 404 });
    }
    const item = itemResult.rows[0];

    // Сколько уже возвращали по этой позиции раньше — чтобы не вернуть
    // больше, чем реально было куплено (сумма по всем прошлым возвратам
    // этой позиции + текущий запрос не может превышать item.quantity)
    const alreadyReturnedResult = await client.query(
      `SELECT COALESCE(SUM(quantity), 0) AS total FROM customer_return_items WHERE order_item_id = $1`,
      [body.orderItemId]
    );
    const alreadyReturned = parseInt(alreadyReturnedResult.rows[0].total, 10);
    const remaining = item.quantity - alreadyReturned;

    if ((body.quantity as number) > remaining) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Нельзя вернуть больше, чем куплено: доступно к возврату ${remaining} шт. из ${item.quantity}.` },
        { status: 400 }
      );
    }

    const returnResult = await client.query(
      `INSERT INTO customer_returns (order_id, customer_id, reason, refund_method, status, comment)
       VALUES ($1, $2, $3, $4, 'completed', $5)
       RETURNING id, created_at`,
      [orderId, customerId, body.reason, body.refundMethod, comment]
    );
    const returnId = returnResult.rows[0].id;

    await client.query(
      `INSERT INTO customer_return_items (return_id, order_item_id, quantity, restock)
       VALUES ($1, $2, $3, $4)`,
      [returnId, body.orderItemId, body.quantity, restock]
    );

    if (restock && item.product_id) {
      await client.query(
        `INSERT INTO stock_movements (product_id, quantity_change, reason, order_item_id)
         VALUES ($1, $2, 'customer_return', $3)`,
        [item.product_id, body.quantity, body.orderItemId]
      );
      await client.query(`UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1`, [
        item.product_id,
        body.quantity,
      ]);
    }

    const refundAmount = parseFloat(item.price) * (body.quantity as number);

    // Транзакцию в леджер клиента пишем, только если у заказа вообще
    // есть привязанный customer_id (у заказов, оформленных ДО миграции
    // секции 28 schema.sql, его может не быть) — сам возврат при этом
    // всё равно оформляется полностью корректно
    if (customerId) {
      await client.query(
        `INSERT INTO customer_transactions (customer_id, amount, type, order_id, return_id, affects_customer_balance, comment, created_by)
         VALUES ($1, $2, 'return_refund', $3, $4, $5, $6, 'admin')`,
        [customerId, -refundAmount, orderId, returnId, body.refundMethod === 'balance', comment]
      );
    }

    // Если вернули ВСЮ оставшуюся часть количества этой позиции — статус
    // позиции меняем на 'returned'. Частичный возврат статус не трогает:
    // позиция формально всё ещё "выполнена" в оставшейся части
    if ((body.quantity as number) === remaining) {
      await client.query(`UPDATE order_items SET status = 'returned' WHERE id = $1`, [body.orderItemId]);
    }

    await client.query('COMMIT');

    return NextResponse.json(
      {
        success: true,
        returnId,
        refundAmount,
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при оформлении возврата от клиента:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось оформить возврат: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
