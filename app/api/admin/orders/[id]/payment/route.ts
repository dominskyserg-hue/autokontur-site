// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/orders/[id]/payment
//
// Приём оплаты/предоплаты от клиента по конкретному заказу — модалка
// "Принять оплату" в карточке заказа (components/OrdersScreen.tsx).
//
//   Тело запроса: { cashRegisterId, amount, comment? }
//
// Способ оплаты отдельным полем не передаётся: выбранная касса САМА
// по себе уже говорит, наличными заплатил клиент, картой через
// терминал или переводом на расчётный счёт (cash_registers.type).
//
// Одной транзакцией:
//   1. customer_transactions (amount = -amount, type = 'prepayment') —
//      уменьшает долг клиента. Только если у заказа есть customer_id
//      (у заказов до миграции секции 28 его может не быть — тогда эта
//      часть пропускается, но деньги в кассу всё равно заносятся, см.
//      ниже).
//   2. cash_movements (amount = +amount, type = 'customer_payment' если
//      заказ уже отгружен и это оплата уже начисленного долга, иначе
//      'customer_prepayment') — касса пополняется, связывается с
//      заказом и (если есть) с только что созданной customer_transaction.
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

interface PaymentRequestBody {
  cashRegisterId?: string;
  amount?: number;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: 'Некорректный id заказа.' }, { status: 400 });
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

  const amount = body.amount as number;
  const comment = (body.comment || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query('SELECT id, customer_id, status FROM orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const order = orderResult.rows[0];

    const registerResult = await client.query('SELECT id, name, is_active FROM cash_registers WHERE id = $1', [body.cashRegisterId]);
    if (registerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса не найдена.' }, { status: 404 });
    }
    if (!registerResult.rows[0].is_active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса деактивирована.' }, { status: 400 });
    }

    // customer_transactions.customer_id — NOT NULL: у заказов без
    // привязанного клиента (оформленных до появления таблицы customers,
    // см. секцию 28 schema.sql) эту часть пропускаем, но деньги в кассу
    // всё равно заносим — это не должно "зависать в воздухе" только
    // из-за старого заказа
    let customerTransactionId: string | null = null;
    if (order.customer_id) {
      const transactionResult = await client.query(
        `
        INSERT INTO customer_transactions (customer_id, amount, type, order_id, cash_register_id, affects_customer_balance, comment, created_by)
        VALUES ($1, $2, 'prepayment', $3, $4, true, $5, 'admin')
        RETURNING id
        `,
        [order.customer_id, -amount, orderId, body.cashRegisterId, comment]
      );
      customerTransactionId = transactionResult.rows[0].id;
    }

    const movementType = order.status === 'shipped' ? 'customer_payment' : 'customer_prepayment';
    await client.query(
      `
      INSERT INTO cash_movements (cash_register_id, amount, type, customer_transaction_id, order_id, comment, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, 'admin')
      `,
      [body.cashRegisterId, amount, movementType, customerTransactionId, orderId, comment]
    );

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM cash_registers WHERE id = $1', [body.cashRegisterId]);
    const customerBalanceResult = order.customer_id
      ? await pool.query('SELECT balance FROM customers WHERE id = $1', [order.customer_id])
      : null;

    return NextResponse.json(
      {
        success: true,
        newCashRegisterBalance: parseFloat(balanceResult.rows[0].balance),
        newCustomerBalance: customerBalanceResult ? parseFloat(customerBalanceResult.rows[0].balance) : null,
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при приёме оплаты по заказу:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось провести платёж: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
