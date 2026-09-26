// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/cash-registers/movements
//
// Лента ВСЕХ движений по всем кассам (или по одной — см. ?registerId)
// с фильтрами, для раздела "Кассы и Финансы" (components/TreasuryScreen.tsx).
//
//   ?registerId=uuid       — только по одной кассе
//   ?type=customer_payment — только один тип операции (см. CHECK
//                            cash_movements.type в schema.sql)
//   ?dateFrom=YYYY-MM-DD
//   ?dateTo=YYYY-MM-DD
//   ?page=1&pageSize=30
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
const MOVEMENT_TYPES = [
  'customer_prepayment',
  'customer_payment',
  'customer_refund',
  'supplier_payment',
  'transfer_out',
  'transfer_in',
  'expense',
  'income',
] as const;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 30;

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const params = request.nextUrl.searchParams;

  const registerId = params.get('registerId');
  if (registerId && !UUID_PATTERN.test(registerId)) {
    return NextResponse.json({ error: 'Некорректный id кассы.' }, { status: 400 });
  }

  const type = params.get('type');
  if (type && !(MOVEMENT_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: `type должен быть одним из: ${MOVEMENT_TYPES.join(', ')}.` }, { status: 400 });
  }

  const dateFrom = params.get('dateFrom');
  const dateTo = params.get('dateTo');

  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(params.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));

  // Собираем WHERE динамически — фильтров много и все необязательные,
  // строить это через тернарники прямо в SQL-строке было бы куда менее
  // читаемо, чем набор условий + позиционные параметры
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (registerId) {
    values.push(registerId);
    conditions.push(`cm.cash_register_id = $${values.length}`);
  }
  if (type) {
    values.push(type);
    conditions.push(`cm.type = $${values.length}`);
  }
  if (dateFrom) {
    values.push(dateFrom);
    conditions.push(`cm.created_at >= $${values.length}::date`);
  }
  if (dateTo) {
    values.push(dateTo);
    conditions.push(`cm.created_at < ($${values.length}::date + interval '1 day')`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(`SELECT COUNT(*) AS total FROM cash_movements cm ${whereClause}`, values);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    const offset = (page - 1) * pageSize;
    const rowsResult = await pool.query(
      `
      SELECT
        cm.id, cm.cash_register_id, cr.name AS cash_register_name, cm.amount, cm.type,
        cm.customer_transaction_id, cm.supplier_transaction_id, cm.order_id,
        cm.comment, cm.created_by, cm.created_at
      FROM cash_movements cm
      JOIN cash_registers cr ON cr.id = cm.cash_register_id
      ${whereClause}
      ORDER BY cm.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset]
    );

    const movements = rowsResult.rows.map((row) => ({
      id: row.id,
      cashRegisterId: row.cash_register_id,
      cashRegisterName: row.cash_register_name,
      amount: parseFloat(row.amount),
      type: row.type,
      customerTransactionId: row.customer_transaction_id,
      supplierTransactionId: row.supplier_transaction_id,
      orderId: row.order_id,
      comment: row.comment,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));

    return NextResponse.json({
      success: true,
      movements,
      pagination: { page, pageSize, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / pageSize)) },
    });
  } catch (error) {
    console.error('Ошибка при получении ленты движений касс:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить ленту движений: ' + message }, { status: 500 });
  }
}
