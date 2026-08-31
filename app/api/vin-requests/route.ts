// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/vin-requests
//
// Заявки "Підбір за VIN" — блок на витрині (components/StorefrontHome.tsx)
// для покупців, які не знайшли деталь за артикулом: замість пошуку по
// каталогу вони лишають VIN-код авто, телефон і опис того, що шукають,
// а адміністратор підбирає деталь вручну (екран "VIN-запити" в
// адмінці, components/VinRequestsScreen.tsx).
//
//   POST /api/vin-requests — покупець надсилає заявку з вітрини.
//        Тіло: { "vinCode": "...", "phone": "...", "description": "..." }
//        Текст помилок тут — УКРАЇНСЬКОЮ (як і в app/api/orders/create/
//        route.ts): цей роут викликає сама вітрина, а не адмінка
//
//   GET  /api/vin-requests — список заявок для адмінки, з пагінацією
//        і фільтром за статусом (той самий прийом, що і в
//        app/api/orders/route.ts)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

const STATUS_VALUES = ['new', 'done'] as const;
type VinRequestStatus = (typeof STATUS_VALUES)[number];
function isValidStatus(value: string): value is VinRequestStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

// Та же самая проверка телефона, что и на витрине при оформлении
// заказа (см. isValidPhone в components/StorefrontHome.tsx) — считаем
// только цифры и требуем от 9 до 13
function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

interface VinRequestResponse {
  id: string;
  vinCode: string;
  customerPhone: string;
  description: string;
  status: VinRequestStatus;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------
// POST — покупець залишає заявку з вітрини
// ------------------------------------------------------------
interface CreateVinRequestBody {
  vinCode?: string;
  phone?: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateVinRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний формат запиту.' }, { status: 400 });
  }

  const vinCode = (body.vinCode || '').trim().toUpperCase();
  const phone = (body.phone || '').trim();
  const description = (body.description || '').trim();

  if (!vinCode || vinCode.length < 5) {
    return NextResponse.json({ error: 'Вкажіть VIN-код автомобіля.' }, { status: 400 });
  }
  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: 'Опишіть, яку деталь ви шукаєте.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vin_requests (vin_code, customer_phone, description) VALUES ($1, $2, $3) RETURNING id`,
      [vinCode, phone, description]
    );

    return NextResponse.json({ success: true, id: result.rows[0].id }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при создании заявки на подбор по VIN:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json(
      { error: 'Не вдалося надіслати заявку: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// GET — список заявок для адмінки
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawPageSize = parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;

    const offset = (page - 1) * pageSize;

    const statusFilter = (searchParams.get('status') || '').trim();
    if (statusFilter && !isValidStatus(statusFilter)) {
      return NextResponse.json(
        { error: `Статус должен быть одним из: ${STATUS_VALUES.join(', ')}.` },
        { status: 400 }
      );
    }

    const values: unknown[] = [];
    let whereSql = '';
    if (statusFilter) {
      values.push(statusFilter);
      whereSql = `WHERE status = $${values.length}`;
    }

    values.push(pageSize, offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    const result = await pool.query(
      `
      SELECT id, vin_code, customer_phone, description, status, created_at, updated_at,
             COUNT(*) OVER() AS total_count
      FROM vin_requests
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      values
    );

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;

    const vinRequests: VinRequestResponse[] = result.rows.map((row) => ({
      id: row.id,
      vinCode: row.vin_code,
      customerPhone: row.customer_phone,
      description: row.description,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({
      success: true,
      vinRequests,
      pagination: { page, pageSize, totalCount, totalPages },
    });
  } catch (error) {
    console.error('Ошибка при получении списка заявок на подбор по VIN:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список заявок: ' + message },
      { status: 500 }
    );
  }
}
