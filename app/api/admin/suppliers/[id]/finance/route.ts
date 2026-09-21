// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/suppliers/[id]/finance
//
// Финансовая карточка поставщика — текущий долг (suppliers.balance,
// кэш поверх леджера supplier_transactions, секция 28 schema.sql),
// лента всех операций и список приходных накладных.
//
//   GET /api/admin/suppliers/[id]/finance
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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Некорректный id поставщика.' }, { status: 400 });
  }

  try {
    const supplierResult = await pool.query('SELECT id, name, balance FROM suppliers WHERE id = $1', [id]);
    if (supplierResult.rows.length === 0) {
      return NextResponse.json({ error: 'Поставщик не найден.' }, { status: 404 });
    }
    const s = supplierResult.rows[0];

    const transactionsResult = await pool.query(
      `
      SELECT id, amount, type, invoice_id, return_id, comment, created_by, created_at
      FROM supplier_transactions
      WHERE supplier_id = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [id]
    );

    const invoicesResult = await pool.query(
      `SELECT id, invoice_number, total_amount, order_id, comment, created_at
       FROM supplier_invoices
       WHERE supplier_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id]
    );

    return NextResponse.json({
      success: true,
      supplier: { id: s.id, name: s.name, balance: parseFloat(s.balance) },
      transactions: transactionsResult.rows.map((t) => ({
        id: t.id,
        amount: parseFloat(t.amount),
        type: t.type,
        invoiceId: t.invoice_id,
        returnId: t.return_id,
        comment: t.comment,
        createdBy: t.created_by,
        createdAt: t.created_at,
      })),
      invoices: invoicesResult.rows.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        totalAmount: parseFloat(inv.total_amount),
        orderId: inv.order_id,
        comment: inv.comment,
        createdAt: inv.created_at,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении финансовой карточки поставщика:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить данные: ' + message }, { status: 500 });
  }
}
