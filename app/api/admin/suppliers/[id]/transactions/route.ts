// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/suppliers/[id]/transactions
//
// Ручная запись операции в леджер поставщика (supplier_transactions,
// секция 28 schema.sql) — оплата поставщику или корректировка.
// suppliers.balance пересчитывается САМ, через триггер
// trg_supplier_transactions_update_balance.
//
//   POST /api/admin/suppliers/[id]/transactions
//   Тело запроса:
//   {
//     "type": "payment_out" | "adjustment",
//     "amount": number,  // знак: + увеличивает наш долг, - уменьшает
//                         // (оплата поставщику — всегда отрицательная)
//     "comment": string  // обязателен для type = "adjustment"
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

// Ручную форму на экране финансов поставщика намеренно ограничиваем
// двумя типами: полноценная приёмка товара ('goods_received') идёт
// через отдельный эндпоинт .../invoices (там же создаётся сама
// накладная), а 'supplier_return' — через будущий экран возвратов
// поставщику, когда он появится
const TRANSACTION_TYPES = ['payment_out', 'adjustment'] as const;
type TransactionType = (typeof TRANSACTION_TYPES)[number];

interface CreateTransactionRequestBody {
  type?: string;
  amount?: number;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = await context.params;

  if (!UUID_PATTERN.test(supplierId)) {
    return NextResponse.json({ error: 'Некорректный id поставщика.' }, { status: 400 });
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

  const comment = (body.comment || '').trim() || null;
  if (body.type === 'adjustment' && !comment) {
    return NextResponse.json({ error: 'Для ручной корректировки обязательно укажите комментарий.' }, { status: 400 });
  }

  try {
    const supplierCheck = await pool.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierCheck.rows.length === 0) {
      return NextResponse.json({ error: 'Поставщик не найден.' }, { status: 404 });
    }

    const result = await pool.query(
      `INSERT INTO supplier_transactions (supplier_id, amount, type, comment, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, amount, type, comment, created_at`,
      [supplierId, body.amount, body.type, comment, 'admin']
    );

    const balanceResult = await pool.query('SELECT balance FROM suppliers WHERE id = $1', [supplierId]);

    return NextResponse.json(
      {
        success: true,
        transaction: {
          id: result.rows[0].id,
          amount: parseFloat(result.rows[0].amount),
          type: result.rows[0].type,
          comment: result.rows[0].comment,
          createdAt: result.rows[0].created_at,
        },
        newBalance: parseFloat(balanceResult.rows[0].balance),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при записи транзакции поставщика:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось записать операцию: ' + message }, { status: 500 });
  }
}
