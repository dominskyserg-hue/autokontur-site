// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/customer/addresses
//
// Збережені адреси Нової Пошти в особистому кабінеті покупця
// (вкладка "Налаштування профілю & Доставка") — довідник ДЛЯ ПОКУПЦЯ,
// щоб не вводити ті самі дані отримувача/відділення щоразу заново.
// Саме оформлення замовлення (app/api/orders/create/route.ts) як і
// раніше приймає ці поля прямим текстом із форми на вітрині.
//
//   GET  /api/customer/addresses?phone=+380501234567
//   POST /api/customer/addresses
//        { phone, recipientName, recipientPhone?, city, warehouse, isDefault? }
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

interface CustomerAddress {
  id: string;
  recipientName: string;
  recipientPhone: string | null;
  city: string;
  warehouse: string;
  isDefault: boolean;
  createdAt: string;
}

// ------------------------------------------------------------
// GET /api/customer/addresses?phone=...
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();

  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(rawPhone);

  try {
    const result = await pool.query(
      `
      SELECT id, recipient_name, recipient_phone, city, warehouse, is_default, created_at
      FROM customer_addresses
      WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1
      ORDER BY is_default DESC, created_at DESC
      `,
      [phoneTail]
    );

    const addresses: CustomerAddress[] = result.rows.map((row) => ({
      id: row.id,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      city: row.city,
      warehouse: row.warehouse,
      isDefault: row.is_default,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ success: true, addresses });
  } catch (error) {
    console.error('Ошибка при получении адресов клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося отримати адреси: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/customer/addresses — додати адресу
// ------------------------------------------------------------
interface CreateAddressBody {
  phone?: string;
  recipientName?: string;
  recipientPhone?: string;
  city?: string;
  warehouse?: string;
  isDefault?: boolean;
}

export async function POST(request: NextRequest) {
  let body: CreateAddressBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON.' }, { status: 400 });
  }

  const phone = (body.phone || '').trim();
  const recipientName = (body.recipientName || '').trim();
  const recipientPhone = (body.recipientPhone || '').trim() || null;
  const city = (body.city || '').trim();
  const warehouse = (body.warehouse || '').trim();

  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }
  if (!recipientName) {
    return NextResponse.json({ error: "Вкажіть ім'я та прізвище отримувача." }, { status: 400 });
  }
  if (!city) {
    return NextResponse.json({ error: 'Вкажіть місто.' }, { status: 400 });
  }
  if (!warehouse) {
    return NextResponse.json({ error: 'Вкажіть відділення або адресу Нової Пошти.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const phoneTail = normalizePhone(phone);

    // Перша адреса покупця одразу стає "за замовчуванням"; якщо
    // покупець явно попросив зробити НОВУ адресу дефолтною — знімаємо
    // цю позначку з усіх інших його адрес (лише одна дефолтна одразу)
    const existingCountResult = await client.query(
      `SELECT COUNT(*) AS count FROM customer_addresses WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [phoneTail]
    );
    const isFirstAddress = parseInt(existingCountResult.rows[0].count, 10) === 0;
    const isDefault = isFirstAddress || body.isDefault === true;

    if (isDefault) {
      await client.query(
        `UPDATE customer_addresses SET is_default = false WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
        [phoneTail]
      );
    }

    const result = await client.query(
      `
      INSERT INTO customer_addresses (phone, recipient_name, recipient_phone, city, warehouse, is_default)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, recipient_name, recipient_phone, city, warehouse, is_default, created_at
      `,
      [phone, recipientName, recipientPhone, city, warehouse, isDefault]
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    const address: CustomerAddress = {
      id: row.id,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      city: row.city,
      warehouse: row.warehouse,
      isDefault: row.is_default,
      createdAt: row.created_at,
    };

    return NextResponse.json({ success: true, address }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при добавлении адреса клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося зберегти адресу: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
