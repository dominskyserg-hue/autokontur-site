// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/customer/pricing-rule?phone=+380501234567
//
// Тільки для показу бейджа "Gold Client — 5%" у профілі особистого
// кабінету (components/CustomerDashboard.tsx) — чи призначена цьому
// покупцю персональна знижка/наценка (адмінка:
// app/api/admin/customer-pricing-rules/route.ts), і на скільки
// відсотків.
//
// ИЗМЕНЕНО по аудиту безопасности: тип правила и процент ЧУВСТВИТЕЛЬНЫ —
// персональная цена = закупочная ± %, и по проценту вычисляется
// закупочная цена любого товара. Теперь роут отдаёт данные ТОЛЬКО
// админу (isAdminRequest), остальным — 403; бейдж в кабинете просто не
// показывается (fetchPricingRule в CustomerDashboard это переживает)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCustomerPricingRule } from '@/lib/customerPricing';
import { isAdminRequest } from '@/lib/adminSession';

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
  // Тип правила (скидка/наценка) и процент — только для админа: цена
  // покупателя с правилом = закупка ± %, поэтому по проценту и цене
  // вычисляется закупочная цена любого товара. Наценку клиенту вообще
  // не показываем. Покупателю этот роут ничего не отдаёт
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Недостатньо прав.' }, { status: 403 });
  }

  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();

  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  try {
    const rule = await getCustomerPricingRule(pool, rawPhone);
    return NextResponse.json({ success: true, rule });
  } catch (error) {
    console.error('Ошибка при получении персонального правила цены:', error);
    // Подробности ошибки (в т.ч. текст из базы) — только в логи Vercel (console.error выше), покупателю — общий текст
    return NextResponse.json({ error: 'Сталася помилка, спробуйте пізніше' }, { status: 500 });
  }
}
