// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: DELETE /api/customer/favorites/[productId]?phone=...
//
// Прибрати товар з обраного. phone у query-параметрі — та ж модель
// належності, що і в решті кабінету покупця (порівняння за останніми
// 9 цифрами номера, див. app/api/customer/orders/route.ts)
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  if (!isValidUuid(productId)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор товару.' }, { status: 400 });
  }

  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();
  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(rawPhone);

  try {
    const result = await pool.query(
      `
      DELETE FROM customer_favorites
      WHERE product_id = $1 AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $2
      RETURNING id
      `,
      [productId, phoneTail]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Товар не знайдено в обраному.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении товара из избранного:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося прибрати товар з обраного: ' + message }, { status: 500 });
  }
}
