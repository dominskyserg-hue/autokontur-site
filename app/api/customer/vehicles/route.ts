// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/customer/vehicles
//
// "Мій Гараж" — автомобілі, які покупець зберіг у своєму особистому
// кабінеті (components/CustomerDashboard.tsx). Дані вводяться вручну
// (марка/модель/рік/двигун/VIN) — підключеного VIN-декодера, який умів
// би підтягувати специфікацію автоматично, на сайті немає.
//
//   GET  /api/customer/vehicles?phone=+380501234567   — список авто
//   POST /api/customer/vehicles                       — додати авто
//        { phone, make, model, year?, engine?, vin? }
//
// Та ж модель "телефон замінює пароль", що і в решті кабінету покупця
// (детальний коментар про цю навмисну спрощену схему — в
// app/api/customer/orders/route.ts): будь-хто, хто знає номер
// телефону, може побачити/додати авто в цей гараж. Для магазину без
// збереження платіжних даних це прийнятний компроміс простоти.
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

interface CustomerVehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  engine: string | null;
  vin: string | null;
  isActive: boolean;
  createdAt: string;
}

// ------------------------------------------------------------
// GET /api/customer/vehicles?phone=...
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
      SELECT id, make, model, year, engine, vin, is_active, created_at
      FROM customer_vehicles
      WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1
      ORDER BY is_active DESC, created_at DESC
      `,
      [phoneTail]
    );

    const vehicles: CustomerVehicle[] = result.rows.map((row) => ({
      id: row.id,
      make: row.make,
      model: row.model,
      year: row.year,
      engine: row.engine,
      vin: row.vin,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ success: true, vehicles });
  } catch (error) {
    console.error('Ошибка при получении гаража клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося отримати список авто: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/customer/vehicles — додати авто
// ------------------------------------------------------------
interface CreateVehicleBody {
  phone?: string;
  make?: string;
  model?: string;
  year?: number | string;
  engine?: string;
  vin?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateVehicleBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON.' }, { status: 400 });
  }

  const phone = (body.phone || '').trim();
  const make = (body.make || '').trim();
  const model = (body.model || '').trim();
  const engine = (body.engine || '').trim() || null;
  const vin = (body.vin || '').trim().toUpperCase() || null;

  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }
  if (!make) {
    return NextResponse.json({ error: "Вкажіть марку автомобіля." }, { status: 400 });
  }
  if (!model) {
    return NextResponse.json({ error: 'Вкажіть модель автомобіля.' }, { status: 400 });
  }

  let year: number | null = null;
  if (body.year !== undefined && body.year !== null && body.year !== '') {
    const parsedYear = typeof body.year === 'number' ? body.year : parseInt(body.year, 10);
    if (!Number.isInteger(parsedYear) || parsedYear < 1950 || parsedYear > new Date().getFullYear() + 1) {
      return NextResponse.json({ error: 'Некоректний рік випуску.' }, { status: 400 });
    }
    year = parsedYear;
  }

  try {
    // Перше авто покупця одразу стає активним (щоб кнопка "Знайти
    // запчастини для цього авто" одразу мала що показати) — решта
    // додаються неактивними, покупець сам обирає активне перемикачем
    const existingCountResult = await pool.query(
      `SELECT COUNT(*) AS count FROM customer_vehicles WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [normalizePhone(phone)]
    );
    const isFirstVehicle = parseInt(existingCountResult.rows[0].count, 10) === 0;

    const result = await pool.query(
      `
      INSERT INTO customer_vehicles (phone, make, model, year, engine, vin, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, make, model, year, engine, vin, is_active, created_at
      `,
      [phone, make, model, year, engine, vin, isFirstVehicle]
    );

    const row = result.rows[0];
    const vehicle: CustomerVehicle = {
      id: row.id,
      make: row.make,
      model: row.model,
      year: row.year,
      engine: row.engine,
      vin: row.vin,
      isActive: row.is_active,
      createdAt: row.created_at,
    };

    return NextResponse.json({ success: true, vehicle }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при добавлении автомобиля клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося додати авто: ' + message }, { status: 500 });
  }
}
