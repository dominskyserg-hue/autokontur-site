// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/customer/pricing-rule?phone=+380501234567
//
// Тільки для показу бейджа "Gold Client — 5%" у профілі особистого
// кабінету (components/CustomerDashboard.tsx) — чи призначена цьому
// покупцю персональна знижка/наценка (адмінка:
// app/api/admin/customer-pricing-rules/route.ts), і на скільки
// відсотків. НІЯКИХ цін чи cost_price тут немає — лише сам факт
// правила й відсоток, це не чутливі дані і показ їх самому покупцю,
// якого вони стосуються, нічого не розкриває стороннім
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCustomerPricingRule } from '@/lib/customerPricing';

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
    const rule = await getCustomerPricingRule(pool, rawPhone);
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    console.error('Ошибка при получении персонального правила цены:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося отримати дані: ' + message }, { status: 500 });
  }
}
