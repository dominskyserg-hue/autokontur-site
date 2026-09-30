// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/nav-counters
//
// Цифры-бейджи для бокового меню админки (components/AdminLayout.tsx)
// — сколько работы ждёт в каждом разделе. Один лёгкий запрос вместо
// нескольких: меню опрашивает его каждые 20 секунд.
//
//   newOrders   — новые заказы (статус 'new')
//   toOrder     — позиции, которые нужно заказать у поставщика
//                 (вкладка "Нужно заказать" в "Закупках")
//   toReceive   — позиции, заказанные у поставщика и ждущие приёмки
//   toShip      — заказы, готовые к отгрузке (экран "К отгрузке")
//   vinRequests — необработанные VIN-запросы
//
// Условия для закупок — те же, что и в
// app/api/admin/procurement/needed/route.ts (без отменённых и уже
// отгруженных заказов), чтобы цифра в меню совпадала со списком
// ============================================================

import { NextResponse } from 'next/server';
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

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM orders WHERE status = 'new')::int AS new_orders,
        (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.status = 'pending' AND o.status NOT IN ('cancelled', 'shipped'))::int AS to_order,
        (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE oi.status = 'ordered_from_supplier' AND o.status NOT IN ('cancelled', 'shipped'))::int AS to_receive,
        (SELECT COUNT(*) FROM orders WHERE status IN ('in_stock', 'ready_for_pickup'))::int AS to_ship,
        (SELECT COUNT(*) FROM vin_requests WHERE status = 'new')::int AS vin_requests
    `);

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      counters: {
        newOrders: row.new_orders,
        toOrder: row.to_order,
        toReceive: row.to_receive,
        toShip: row.to_ship,
        vinRequests: row.vin_requests,
      },
    });
  } catch (error) {
    console.error('Ошибка при подсчёте счётчиков меню:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить счётчики: ' + message }, { status: 500 });
  }
}
