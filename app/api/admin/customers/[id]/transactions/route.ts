// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customers/[id]/transactions
//
// Ручная запись операции в леджер клиента (customer_transactions,
// секция 28 schema.sql). customers.balance пересчитывается САМ, через
// триггер trg_customer_transactions_update_balance — этот роут просто
// вставляет строку в журнал и ничего не считает и не обновляет вручную.
//
//   POST /api/admin/customers/[id]/transactions
//   Тело запроса:
//   {
//     "type": "prepayment" | "shipment" | "return_refund" | "adjustment" | "cash_payment",
//     "amount": number,   // знак задаёт направление: + увеличивает долг
//                          // клиента, - уменьшает (подробнее — см.
//                          // комментарий к customer_transactions.amount
//                          // в schema.sql)
//     "affectsCustomerBalance": boolean,  // необязательно, по умолчанию
//                          // true — false только для операций, которые
//                          // не должны трогать личный баланс (напр.
//                          // наличная выплата мимо счёта), но всё равно
//                          // должны остаться в журнале ради Cash Flow
//     "comment": string   // обязателен для type = "adjustment"
//   }
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

const TRANSACTION_TYPES = ['prepayment', 'shipment', 'return_refund', 'adjustment', 'cash_payment'] as const;
type TransactionType = (typeof TRANSACTION_TYPES)[number];

interface CreateTransactionRequestBody {
  type?: string;
  amount?: number;
  affectsCustomerBalance?: boolean;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: customerId } = await context.params;

  if (!UUID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: 'Некорректный id клиента.' }, { status: 400 });
  }

  let body: CreateTransactionRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.type || !TRANSACTION_TYPES.includes(body.type as TransactionType)) {
    return NextResponse.json(
      { error: `Тип операции должен быть одним из: ${TRANSACTION_TYPES.join(', ')}.` },
      { status: 400 }
    );
  }

  if (!Number.isFinite(body.amount) || body.amount === 0) {
    return NextResponse.json({ error: 'Сумма должна быть ненулевым числом.' }, { status: 400 });
  }

  // Ручная корректировка обязана сопровождаться комментарием — это
  // единственный тип операции, у которого нет "самоочевидного" смысла
  // (в отличие, например, от prepayment) — без пояснения через месяц
  // никто не вспомнит, почему баланс поправили именно на эту сумму
  const comment = (body.comment || '').trim() || null;
  if (body.type === 'adjustment' && !comment) {
    return NextResponse.json({ error: 'Для ручной корректировки обязательно укажите комментарий.' }, { status: 400 });
  }

  const affectsCustomerBalance = body.affectsCustomerBalance ?? true;

  try {
    const customerCheck = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (customerCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Клиент не найден.' }, { status: 404 });
    }

    const result = await pool.query(
      `
      INSERT INTO customer_transactions (customer_id, amount, type, affects_customer_balance, comment, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, amount, type, affects_customer_balance, comment, created_at
      `,
      [customerId, body.amount, body.type, affectsCustomerBalance, comment, 'admin']
    );

    const balanceResult = await pool.query('SELECT balance FROM customers WHERE id = $1', [customerId]);

    return NextResponse.json(
      {
        success: true,
        transaction: {
          id: result.rows[0].id,
          amount: parseFloat(result.rows[0].amount),
          type: result.rows[0].type,
          affectsCustomerBalance: result.rows[0].affects_customer_balance,
          comment: result.rows[0].comment,
          createdAt: result.rows[0].created_at,
        },
        newBalance: parseFloat(balanceResult.rows[0].balance),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при записи транзакции клиента:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось записать операцию: ' + message }, { status: 500 });
  }
}
