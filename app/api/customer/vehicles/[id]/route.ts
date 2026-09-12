// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/customer/vehicles/[id]
//
//   PATCH  { phone, isActive: true }  — зробити це авто активним
//          (і одразу знімає активність з усіх ІНШИХ авто цього ж
//          покупця — активним може бути лише одне авто одночасно)
//   DELETE ?phone=...                — видалити авто з гаража
//
// Перевірка належності — та ж сама схема, що і в
// app/api/customer/orders/[id]/route.ts: авто змінюється/видаляється
// ТІЛЬКИ якщо його phone збігається (за останніми 9 цифрами) з
// телефоном у запиті. "Не знайдено" і "знайдено, але це не ваш
// телефон" відповідають однаково — 404 — щоб той, хто не знає
// телефону, не міг навіть перевірити, чи існує запис із таким id
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

interface PatchVehicleBody {
  phone?: string;
  isActive?: boolean;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор авто.' }, { status: 400 });
  }

  let body: PatchVehicleBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON.' }, { status: 400 });
  }

  const phone = (body.phone || '').trim();
  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  if (body.isActive !== true) {
    return NextResponse.json({ error: 'Підтримується лише isActive: true.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(phone);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Спочатку перевіряємо, що авто дійсно належить цьому покупцю
    const ownershipResult = await client.query(
      `SELECT id FROM customer_vehicles WHERE id = $1 AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $2`,
      [id, phoneTail]
    );
    if (ownershipResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Авто не знайдено.' }, { status: 404 });
    }

    // Знімаємо активність з усіх авто цього покупця, а потім робимо
    // активним саме обране — так гарантовано лишається рівно одне
    // активне авто, без окремого CHECK-обмеження в базі
    await client.query(
      `UPDATE customer_vehicles SET is_active = false WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [phoneTail]
    );
    const result = await client.query(
      `UPDATE customer_vehicles SET is_active = true WHERE id = $1 RETURNING id, make, model, year, engine, vin, is_active, created_at`,
      [id]
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      vehicle: {
        id: row.id,
        make: row.make,
        model: row.model,
        year: row.year,
        engine: row.engine,
        vin: row.vin,
        isActive: row.is_active,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при обновлении автомобиля клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося оновити авто: ' + message }, { status: 500 });
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
    return NextResponse.json({ error: 'Некоректний ідентифікатор авто.' }, { status: 400 });
  }

  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();
  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(rawPhone);

  try {
    const result = await pool.query(
      `DELETE FROM customer_vehicles WHERE id = $1 AND RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $2 RETURNING id`,
      [id, phoneTail]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Авто не знайдено.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении автомобиля клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося видалити авто: ' + message }, { status: 500 });
  }
}
