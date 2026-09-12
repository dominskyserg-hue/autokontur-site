// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/customer/addresses/[id]
//
//   PATCH  { phone, isDefault: true }  — зробити адресу дефолтною
//   DELETE ?phone=...                  — видалити адресу
//
// Та ж модель належності "за останніми 9 цифрами телефону", що і в
// app/api/customer/vehicles/[id]/route.ts
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const MIN_PHONE_DIGITS = 9;

function isValidPhone(rawPhone: string): boolean {
  return rawPhone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

interface PatchAddressBody {
  phone?: string;
  isDefault?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор адреси.' }, { status: 400 });
  }

  let body: PatchAddressBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON.' }, { status: 400 });
  }

  const phone = (body.phone || '').trim();
  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }
  if (body.isDefault !== true) {
    return NextResponse.json({ error: 'Підтримується лише isDefault: true.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(phone);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ownershipResult = await client.query(
      `SELECT id FROM customer_addresses WHERE id = $1 AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $2`,
      [id, phoneTail]
    );
    if (ownershipResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Адресу не знайдено.' }, { status: 404 });
    }

    await client.query(
      `UPDATE customer_addresses SET is_default = false WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [phoneTail]
    );
    const result = await client.query(
      `UPDATE customer_addresses SET is_default = true WHERE id = $1 RETURNING id, recipient_name, recipient_phone, city, warehouse, is_default, created_at`,
      [id]
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      address: {
        id: row.id,
        recipientName: row.recipient_name,
        recipientPhone: row.recipient_phone,
        city: row.city,
        warehouse: row.warehouse,
        isDefault: row.is_default,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при обновлении адреса клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося оновити адресу: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор адреси.' }, { status: 400 });
  }

  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();
  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(rawPhone);

  try {
    const result = await pool.query(
      `DELETE FROM customer_addresses WHERE id = $1 AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $2 RETURNING id`,
      [id, phoneTail]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Адресу не знайдено.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении адреса клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося видалити адресу: ' + message }, { status: 500 });
  }
}
