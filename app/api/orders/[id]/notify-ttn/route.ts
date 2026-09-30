// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/notify-ttn
//
// Кнопка "Надіслати ТТН у Telegram" в окне заказа
// (components/OrderDetailsModal.tsx). Автоматически клиент получает
// сообщение о ТТН сразу, когда номер появляется (PATCH заказа или
// создание ТТН через Новую Почту) — эта кнопка нужна, чтобы отправить
// его ещё раз вручную (клиент потерял сообщение, номер поменяли и т.п.)
// и увидеть, ушло ли оно на самом деле.
//
//   Ответ: { success, result: 'sent' | 'not_linked' | 'failed', message }
//     sent       — сообщение доставлено в Telegram клиента
//     not_linked — клиент не подключал Telegram-бота магазина
//     failed     — Telegram не принял сообщение (например, клиент
//                  заблокировал бота)
//     message    — текст сообщения (для ручной отправки в Viber и т.п.)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { buildTtnMessage, notifyCustomerTtnAssigned } from '@/lib/orderNotifications';
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

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const orderResult = await pool.query('SELECT order_number, customer_phone, ttn_number FROM orders WHERE id = $1', [
      id,
    ]);
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const order = orderResult.rows[0];
    if (!order.ttn_number) {
      return NextResponse.json({ error: 'У заказа ещё нет номера ТТН.' }, { status: 400 });
    }

    const result = await notifyCustomerTtnAssigned(id, order.customer_phone, order.ttn_number);

    return NextResponse.json({
      success: true,
      result,
      message: buildTtnMessage(order.order_number, order.ttn_number),
    });
  } catch (error) {
    console.error('Ошибка при ручной отправке ТТН клиенту:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось отправить ТТН: ' + message }, { status: 500 });
  }
}
