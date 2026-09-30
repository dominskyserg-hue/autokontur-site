// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/orders/[id]/ttn-status
//
// Где сейчас посылка по заказу — статус ТТН от Новой Почты
// (lib/novaPoshta/tracking.ts). Окно заказа показывает его в блоке ТТН:
// "В дорозі", "Прибула у відділення", "Отримано", "Повернення", и
// предупреждает, если посылка лежит в отделении 5 дней и больше.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { getTtnStatus } from '@/lib/novaPoshta/tracking';
import { NovaPoshtaApiError } from '@/lib/novaPoshta/api';

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

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const orderResult = await pool.query('SELECT ttn_number, customer_phone FROM orders WHERE id = $1', [id]);
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const order = orderResult.rows[0];
    if (!order.ttn_number) {
      return NextResponse.json({ error: 'У заказа ещё нет номера ТТН.' }, { status: 400 });
    }

    const status = await getTtnStatus(order.ttn_number, order.customer_phone);
    return NextResponse.json({ success: true, status });
  } catch (error) {
    // Ошибка Новой Почты (нет ключа, неверный номер) — понятный текст
    // для менеджера, а не "500 Internal Server Error"
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    if (!(error instanceof NovaPoshtaApiError)) {
      console.error('Ошибка при получении статуса ТТН:', error);
    }
    return NextResponse.json({ error: 'Не вдалося отримати статус посилки: ' + message }, { status: 502 });
  }
}
