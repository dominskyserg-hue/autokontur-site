// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/orders/[id]/history
//
// История изменений заказа (таблица order_history, см.
// lib/orderHistory.ts) — новые события сверху. Показывается в окне
// заказа в блоке "Історія змін".
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureOrderHistoryTable } from '@/lib/orderHistory';

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

// У обычного заказа событий десятки, больше показывать незачем
const HISTORY_LIMIT = 200;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    await ensureOrderHistoryTable();
    const result = await pool.query(
      `SELECT id, message, created_by, created_at FROM order_history
       WHERE order_id = $1 ORDER BY created_at DESC LIMIT ${HISTORY_LIMIT}`,
      [id]
    );
    return NextResponse.json({
      success: true,
      events: result.rows.map((row) => ({
        id: row.id,
        message: row.message,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении истории заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить историю: ' + message }, { status: 500 });
  }
}
