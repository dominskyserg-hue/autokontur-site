// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customers/[id]
//
// Карточка одного клиента — данные, лента всех транзакций
// (customer_transactions — журнал, источник истины для balance,
// см. секцию 28 schema.sql) и список его заказов.
//
//   GET /api/admin/customers/[id]
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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Некорректный id клиента.' }, { status: 400 });
  }

  try {
    const customerResult = await pool.query(
      'SELECT id, phone, name, surname, email, balance, created_at, updated_at FROM customers WHERE id = $1',
      [id]
    );
    if (customerResult.rows.length === 0) {
      return NextResponse.json({ error: 'Клиент не найден.' }, { status: 404 });
    }
    const c = customerResult.rows[0];

    // Лента транзакций — самые свежие первыми, как в банковской выписке.
    // order_id/return_id присоединяем как есть (UUID), человекочитаемую
    // подпись строит фронтенд (первые 8 символов id заказа)
    const transactionsResult = await pool.query(
      `
      SELECT id, amount, type, order_id, return_id, affects_customer_balance, comment, created_by, created_at
      FROM customer_transactions
      WHERE customer_id = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [id]
    );

    const ordersResult = await pool.query(
      `
      SELECT o.id, o.status, o.created_at, o.shipped_at,
             COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100
      `,
      [id]
    );

    return NextResponse.json({
      success: true,
      customer: {
        id: c.id,
        phone: c.phone,
        name: c.name,
        surname: c.surname,
        email: c.email,
        balance: parseFloat(c.balance),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      },
      transactions: transactionsResult.rows.map((t) => ({
        id: t.id,
        amount: parseFloat(t.amount),
        type: t.type,
        orderId: t.order_id,
        returnId: t.return_id,
        affectsCustomerBalance: t.affects_customer_balance,
        comment: t.comment,
        createdBy: t.created_by,
        createdAt: t.created_at,
      })),
      orders: ordersResult.rows.map((o) => ({
        id: o.id,
        status: o.status,
        createdAt: o.created_at,
        shippedAt: o.shipped_at,
        totalAmount: parseFloat(o.total_amount),
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении карточки клиента:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить данные клиента: ' + message }, { status: 500 });
  }
}
