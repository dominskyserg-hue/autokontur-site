// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders
//
// Отдаёт список заказов для экрана "Заказы" (управление заказами
// клиентов). Как и товаров, заказов со временем может накопиться
// много — поэтому здесь тоже пагинация, а не выдача всех разом.
//
//   GET /api/orders?page=1&pageSize=20&status=processing&search=0501234567
//
//   page      — номер страницы, начиная с 1 (по умолчанию 1)
//   pageSize  — сколько заказов на странице (по умолчанию 20,
//               максимум 100)
//   status    — один из статусов заказа (см. STATUS_VALUES ниже);
//               если не передан — показываются заказы всех статусов
//   search    — ищет совпадение по имени клиента, фамилии ИЛИ по
//               телефону (регистронезависимо, по подстроке)
//
// Сумма заказа и количество позиций в нём — НЕ отдельные колонки в
// таблице orders, а считаются "на лету" агрегатными функциями
// SUM/COUNT по таблице order_items (LEFT JOIN — чтобы заказ без
// единой позиции тоже попал в список, просто с суммой 0)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Тот же приём, что и в остальных роутах — общий Pool в globalThis,
// чтобы все файлы использовали одно и то же подключение
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

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// СТАТУСЫ ЗАКАЗА
// ------------------------------------------------------------
// Ровно тот же набор значений, что и в CHECK-ограничении колонки
// orders.status в schema.sql — если когда-нибудь понадобится новый
// статус, менять нужно СРАЗУ в двух местах: там и здесь
const STATUS_VALUES = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'] as const;
type OrderStatus = (typeof STATUS_VALUES)[number];

function isValidStatus(value: string): value is OrderStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

// ------------------------------------------------------------
// ПАГИНАЦИЯ — значения по умолчанию и ограничения
// ------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Один заказ в списке — БЕЗ состава товаров (полный состав отдаётся
// только для одного конкретного заказа через GET /api/orders/[id])
interface OrderListItem {
  id: string;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // ---- пагинация ----
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawPageSize = parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;

    const offset = (page - 1) * pageSize;

    // ---- фильтры ----
    const statusFilter = (searchParams.get('status') || '').trim();
    const search = (searchParams.get('search') || '').trim();

    if (statusFilter && !isValidStatus(statusFilter)) {
      return NextResponse.json(
        { error: `Статус должен быть одним из: ${STATUS_VALUES.join(', ')}.` },
        { status: 400 }
      );
    }

    // ---- собираем WHERE-условие и параметры динамически ----
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (statusFilter) {
      values.push(statusFilter);
      conditions.push(`o.status = $${values.length}`);
    }

    if (search) {
      // Один и тот же текст ищем в имени, фамилии и телефоне — так поле
      // поиска может быть одно, а не три разных на фронтенде
      values.push(`%${search}%`);
      conditions.push(
        `(o.customer_name ILIKE $${values.length} OR o.customer_surname ILIKE $${values.length} OR o.customer_phone ILIKE $${values.length})`
      );
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    values.push(pageSize, offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    // ---- сам запрос ----
    // GROUP BY o.id достаточно (не нужно перечислять все колонки
    // orders в GROUP BY) — Postgres знает, что id первичный ключ,
    // и остальные колонки таблицы от него функционально зависят.
    // COUNT(*) OVER() здесь считает количество ГРУПП (то есть заказов)
    // после WHERE, но ДО LIMIT/OFFSET — то, что и нужно для пагинации
    const result = await pool.query(
      `
      SELECT
        o.id,
        o.customer_name,
        o.customer_surname,
        o.customer_phone,
        o.status,
        o.created_at,
        o.updated_at,
        COUNT(oi.id) AS items_count,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount,
        COUNT(*) OVER() AS total_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${whereSql}
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      values
    );

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;

    const orders: OrderListItem[] = result.rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name,
      customerSurname: row.customer_surname,
      customerPhone: row.customer_phone,
      status: row.status,
      itemsCount: parseInt(row.items_count, 10),
      // total_amount — результат SUM() по колонке NUMERIC, драйвер pg
      // возвращает такие значения строкой, явно переводим в число
      totalAmount: parseFloat(row.total_amount),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({
      success: true,
      orders,
      pagination: { page, pageSize, totalCount, totalPages },
    });
  } catch (error) {
    console.error('Ошибка при получении списка заказов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список заказов: ' + message },
      { status: 500 }
    );
  }
}
