// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customers
//
// Список клиентов с текущим балансом (customers.balance — кэш поверх
// customer_transactions, см. секцию 28 schema.sql) и количеством
// заказов. Сама запись в customers создаётся не здесь, а автоматически
// при оформлении заказа на витрине (app/api/orders/create/route.ts) —
// этот роут только читает и позволяет искать среди уже существующих.
//
//   GET /api/admin/customers?search=...  — список, по убыванию даты
//                                           последнего изменения баланса.
//                                           search ищет по телефону
//                                           (ILIKE) и имени/фамилии
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';

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

interface CustomerListRow {
  id: string;
  phone: string;
  name: string;
  surname: string | null;
  email: string | null;
  balance: string;
  created_at: string;
  updated_at: string;
  order_count: string;
}

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const search = (request.nextUrl.searchParams.get('search') || '').trim();

  try {
    let result;
    if (search) {
      result = await pool.query<CustomerListRow>(
        `
        SELECT c.id, c.phone, c.name, c.surname, c.email, c.balance, c.created_at, c.updated_at,
               COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        WHERE c.phone ILIKE $1 OR c.name ILIKE $1 OR c.surname ILIKE $1
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT 200
        `,
        [`%${search}%`]
      );
    } else {
      result = await pool.query<CustomerListRow>(
        `
        SELECT c.id, c.phone, c.name, c.surname, c.email, c.balance, c.created_at, c.updated_at,
               COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT 200
        `
      );
    }

    const customers = result.rows.map((row) => ({
      id: row.id,
      phone: row.phone,
      name: row.name,
      surname: row.surname,
      email: row.email,
      // balance — колонка NUMERIC, драйвер pg возвращает её строкой
      // (чтобы не терять точность), приводим явно
      balance: parseFloat(row.balance),
      orderCount: parseInt(row.order_count, 10),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, customers });
  } catch (error) {
    console.error('Ошибка при получении списка клиентов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список клиентов: ' + message }, { status: 500 });
  }
}
