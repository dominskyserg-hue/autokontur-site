// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/customers/[id]/payment
//
// Быстрый приём оплаты от клиента прямо из списка клиентов
// (components/CustomersScreen.tsx) — без открытия каждого заказа.
//
//   Тело запроса: { cashRegisterId, amount, comment? }
//
// КУДА ИДУТ ДЕНЬГИ. Клиент обычно платит "за всё сразу", а не за
// конкретный заказ. Но бейдж оплаты у каждого заказа (PaymentBadge)
// считает деньги, привязанные именно к этому заказу. Поэтому сумма
// автоматически раскладывается по НЕоплаченным заказам клиента — от
// самого старого к новому (не отменённым; каждому — ровно столько,
// сколько ему не хватает до полной оплаты). Если после этого деньги
// ещё остались — остаток записывается как предоплата клиента без
// привязки к заказу (его видно в балансе клиента).
//
// Каждая часть проводится ТОЧНО так же, как оплата в карточке заказа
// (app/api/admin/orders/[id]/payment/route.ts):
//   1. customer_transactions (amount = −часть, type = 'prepayment') —
//      уменьшает долг клиента (триггер сам пересчитает баланс);
//   2. cash_movements (amount = +часть) — пополняет выбранную кассу.
// Всё — одной транзакцией: либо проходит целиком, либо не проходит.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';

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

interface PaymentRequestBody {
  cashRegisterId?: string;
  amount?: number;
  comment?: string;
}

// Округление до копеек — чтобы при раскладывании суммы по заказам не
// накапливались "хвосты" вроде 0.30000000000000004
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: customerId } = await context.params;
  if (!UUID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: 'Некорректный id клиента.' }, { status: 400 });
  }

  let body: PaymentRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.cashRegisterId || !UUID_PATTERN.test(body.cashRegisterId)) {
    return NextResponse.json({ error: 'Укажите кассу, через которую прошла оплата.' }, { status: 400 });
  }
  if (!Number.isFinite(body.amount) || (body.amount as number) <= 0) {
    return NextResponse.json({ error: 'Сумма должна быть положительным числом.' }, { status: 400 });
  }

  const amount = roundMoney(body.amount as number);
  const comment = (body.comment || '').trim() || null;
  const cashRegisterId = body.cashRegisterId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE — если два оператора одновременно примут оплату от
    // одного клиента, второй подождёт первого и разложит деньги уже с
    // учётом его платежа (а не "оплатит" тот же заказ второй раз)
    const customerResult = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Клиент не найден.' }, { status: 404 });
    }

    const registerResult = await client.query('SELECT id, is_active FROM cash_registers WHERE id = $1', [cashRegisterId]);
    if (registerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса не найдена.' }, { status: 404 });
    }
    if (!registerResult.rows[0].is_active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса деактивирована.' }, { status: 400 });
    }

    // Неоплаченные заказы клиента, от старых к новым. Сумма и оплата —
    // тем же расчётом, что и в списке заказов (app/api/orders/route.ts)
    const unpaidResult = await client.query(
      `
      SELECT id, order_number, status, total_amount - paid_amount AS due
      FROM (
        SELECT
          o.id,
          o.order_number,
          o.status,
          o.created_at,
          COALESCE((SELECT SUM(oi.price * oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0) AS total_amount,
          COALESCE(
            (SELECT SUM(cm.amount) FROM cash_movements cm
             WHERE cm.order_id = o.id AND cm.type IN ('customer_payment', 'customer_prepayment', 'customer_refund')),
            0
          ) AS paid_amount
        FROM orders o
        WHERE o.customer_id = $1 AND o.status <> 'cancelled'
      ) AS t
      WHERE total_amount - paid_amount > 0
      ORDER BY created_at ASC
      `,
      [customerId]
    );

    // Одна "часть" платежа: сколько и к какому заказу (null — остаток
    // без заказа, чистая предоплата)
    const parts: { orderId: string | null; orderNumber: number | null; status: string | null; amount: number }[] = [];
    let left = amount;
    for (const row of unpaidResult.rows) {
      if (left <= 0) break;
      const due = roundMoney(parseFloat(row.due));
      const part = Math.min(due, left);
      parts.push({ orderId: row.id, orderNumber: row.order_number, status: row.status, amount: part });
      left = roundMoney(left - part);
    }
    if (left > 0) {
      parts.push({ orderId: null, orderNumber: null, status: null, amount: left });
    }

    for (const part of parts) {
      const transactionResult = await client.query(
        `
        INSERT INTO customer_transactions (customer_id, amount, type, order_id, cash_register_id, affects_customer_balance, comment, created_by)
        VALUES ($1, $2, 'prepayment', $3, $4, true, $5, 'admin')
        RETURNING id
        `,
        [customerId, -part.amount, part.orderId, cashRegisterId, comment]
      );

      // Как в карточке заказа: оплата уже отгруженного заказа — это
      // погашение долга, всё остальное — предоплата
      const movementType = part.status === 'shipped' ? 'customer_payment' : 'customer_prepayment';
      await client.query(
        `
        INSERT INTO cash_movements (cash_register_id, amount, type, customer_transaction_id, order_id, comment, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, 'admin')
        `,
        [cashRegisterId, part.amount, movementType, transactionResult.rows[0].id, part.orderId, comment]
      );
    }

    await client.query('COMMIT');

    const customerBalanceResult = await pool.query('SELECT balance FROM customers WHERE id = $1', [customerId]);

    return NextResponse.json(
      {
        success: true,
        // Что куда легло — показываем оператору, чтобы было понятно
        allocations: parts.map((part) => ({ orderNumber: part.orderNumber, amount: part.amount })),
        newCustomerBalance: parseFloat(customerBalanceResult.rows[0].balance),
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при приёме оплаты от клиента:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось провести платёж: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
