// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customer-discounts/[phone]
//
// DELETE — снять персональную скидку с покупателя насовсем.
// [phone] в адресе — уже НОРМАЛИЗОВАННЫЙ номер (последние 9 цифр),
// тот же, что вернул GET /api/admin/customer-discounts, а не
// произвольный формат ввода (см. lib/phoneNormalize.ts)
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ phone: string }> }
) {
  const { phone } = await params;

  try {
    const result = await pool.query('DELETE FROM customer_discounts WHERE phone = $1 RETURNING phone', [phone]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Скидка для такого телефона не найдена.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении персональной скидки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось удалить скидку: ' + message }, { status: 500 });
  }
}
