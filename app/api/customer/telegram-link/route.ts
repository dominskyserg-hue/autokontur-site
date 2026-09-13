// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/customer/telegram-link?phone=+380501234567
//
// Чи підключив цей покупець персональні Telegram-сповіщення (таблиця
// customer_telegram_links, заповнюється ботом через
// app/api/telegram/webhook/route.ts, коли покупець тисне посилання-
// запрошення в кабінеті). Потрібно лише для того, щоб показати в
// components/CustomerDashboard.tsx або вже підключений стан ("✓
// Підключено, @username"), або кнопку підключення
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { normalizePhone } from '@/lib/phoneNormalize';

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

const MIN_PHONE_DIGITS = 9;

function isValidPhone(rawPhone: string): boolean {
  return rawPhone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

export async function GET(request: NextRequest) {
  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();

  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      'SELECT telegram_username FROM customer_telegram_links WHERE phone = $1',
      [normalizePhone(rawPhone)]
    );

    return NextResponse.json({
      success: true,
      linked: result.rows.length > 0,
      username: result.rows[0]?.telegram_username || null,
    });
  } catch (error) {
    console.error('Ошибка при получении статуса привязки Telegram:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося отримати статус: ' + message }, { status: 500 });
  }
}
