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
//   GET /api/admin/customers?search=...&debtorsOnly=1&sort=debt
//     search      — ищет по телефону (ILIKE) и имени/фамилии
//     debtorsOnly — "1": только те, кто нам должен (balance > 0)
//     sort        — "debt": сначала самые большие долги;
//                   по умолчанию — по дате последнего изменения
//
//   Кроме списка отдаёт totals — сколько всего клиенты должны нам и
//   сколько у них лежит предоплат (по ВСЕМ клиентам, без учёта
//   фильтров — это итог для шапки экрана)
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

  const searchParams = request.nextUrl.searchParams;
  const search = (searchParams.get('search') || '').trim();
  const debtorsOnly = searchParams.get('debtorsOnly') === '1';
  const sortByDebt = searchParams.get('sort') === 'debt';

  try {
    // ---- собираем WHERE динамически ----
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(c.phone ILIKE $${values.length} OR c.name ILIKE $${values.length} OR c.surname ILIKE $${values.length})`);
    }
    if (debtorsOnly) {
      conditions.push('c.balance > 0');
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderSql = sortByDebt ? 'c.balance DESC, c.updated_at DESC' : 'c.updated_at DESC';

    const [result, totalsResult] = await Promise.all([
      pool.query<CustomerListRow>(
        `
        SELECT c.id, c.phone, c.name, c.surname, c.email, c.balance, c.created_at, c.updated_at,
               COUNT(o.id) AS order_count
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        ${whereSql}
        GROUP BY c.id
        ORDER BY ${orderSql}
        LIMIT 200
        `,
        values
      ),
      pool.query(
        `
        SELECT
          COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0) AS total_debt,
          COUNT(*) FILTER (WHERE balance > 0)::int AS debtors_count,
          COALESCE(-SUM(balance) FILTER (WHERE balance < 0), 0) AS total_prepaid
        FROM customers
        `
      ),
    ]);

    const totalsRow = totalsResult.rows[0];

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

    return NextResponse.json({
      success: true,
      customers,
      totals: {
        // NUMERIC драйвер pg отдаёт строкой — переводим в число
        totalDebt: parseFloat(totalsRow.total_debt),
        debtorsCount: totalsRow.debtors_count,
        totalPrepaid: parseFloat(totalsRow.total_prepaid),
      },
    });
  } catch (error) {
    console.error('Ошибка при получении списка клиентов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список клиентов: ' + message }, { status: 500 });
  }
}
