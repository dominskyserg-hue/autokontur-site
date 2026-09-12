// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customer-discounts
//
// Персональные скидки покупателям по номеру телефона — см.
// customer_discounts в schema.sql и lib/phoneNormalize.ts. Скидка
// применяется автоматически при оформлении заказа
// (app/api/orders/create/route.ts), без промокода.
//
//   GET  /api/admin/customer-discounts  — список всех назначенных скидок
//   POST /api/admin/customer-discounts  — назначить скидку (создать
//                                          или обновить, если для
//                                          этого телефона уже была)
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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

interface CustomerDiscountResponse {
  phone: string;
  discountPercent: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function toResponse(row: Record<string, unknown>): CustomerDiscountResponse {
  return {
    phone: row.phone as string,
    // discount_percent — колонка NUMERIC, драйвер pg возвращает такие
    // значения строкой (чтобы не терять точность), приводим явно
    discountPercent: parseFloat(row.discount_percent as string),
    note: row.note as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface UpsertDiscountRequestBody {
  phone?: string;
  discountPercent?: number;
  note?: string | null;
}

function validateInput(body: UpsertDiscountRequestBody): string | null {
  if (!body.phone || normalizePhone(body.phone).length < 9) {
    return 'Укажите корректный номер телефона (минимум 9 значащих цифр).';
  }
  if (
    !Number.isFinite(body.discountPercent) ||
    (body.discountPercent as number) <= 0 ||
    (body.discountPercent as number) > 100
  ) {
    return 'Скидка должна быть числом от 0 до 100 (больше нуля).';
  }
  return null;
}

// ------------------------------------------------------------
// GET — список всех персональных скидок
// ------------------------------------------------------------
export async function GET() {
  try {
    const result = await pool.query('SELECT * FROM customer_discounts ORDER BY updated_at DESC');
    return NextResponse.json({ success: true, discounts: result.rows.map(toResponse) });
  } catch (error) {
    console.error('Ошибка при получении списка персональных скидок:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список скидок: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST — назначить скидку (upsert по нормализованному телефону)
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: UpsertDiscountRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const validationError = validateInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const phone = normalizePhone(body.phone as string);

  try {
    const result = await pool.query(
      `
      INSERT INTO customer_discounts (phone, discount_percent, note)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone)
      DO UPDATE SET discount_percent = EXCLUDED.discount_percent, note = EXCLUDED.note, updated_at = now()
      RETURNING *
      `,
      [phone, body.discountPercent, body.note?.trim() || null]
    );

    return NextResponse.json({ success: true, discount: toResponse(result.rows[0]) }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при назначении персональной скидки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось назначить скидку: ' + message }, { status: 500 });
  }
}
