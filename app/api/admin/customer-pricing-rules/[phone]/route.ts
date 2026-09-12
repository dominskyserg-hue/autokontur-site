// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customer-pricing-rules/[phone]
//
// DELETE — снять персональное правило (скидку или наценку) с
// покупателя насовсем. [phone] в адресе — уже НОРМАЛИЗОВАННЫЙ номер
// (последние 9 цифр), тот же, что вернул GET
// /api/admin/customer-pricing-rules, а не произвольный формат ввода
// (см. lib/phoneNormalize.ts)
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
    const result = await pool.query('DELETE FROM customer_pricing_rules WHERE phone = $1 RETURNING phone', [phone]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Правило для такого телефона не найдено.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении персонального правила цены:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось удалить правило: ' + message }, { status: 500 });
  }
}
