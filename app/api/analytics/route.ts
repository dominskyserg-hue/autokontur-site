// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/analytics
//
// Отдаёт все данные для экрана "Аналитика" одним запросом на
// фронтенд (но несколькими SQL-запросами внутри — так проще
// поддерживать, чем один гигантский SQL с кучей подзапросов):
//
//   GET /api/analytics?days=30
//
//   days — за сколько последних дней считать статистику: 7, 30
//          или 90 (по умолчанию 30). Ограничено этим списком
//          намеренно — otherwise можно было бы запросить
//          агрегацию по всей истории базы через строку адреса
//
// ВАЖНО: везде, где считается ВЫРУЧКА (revenueByDay, topProducts,
// supplierRevenue, summary), заказы со статусом "cancelled"
// ИСКЛЮЧЕНЫ — отменённый заказ не принёс денег, и включать его
// в выручку было бы враньём цифрам. Разбивка по статусам
// (statusBreakdown), наоборот, показывает ВСЕ статусы, включая
// отменённые — в этом и есть её смысл: увидеть, сколько заказов
// отменяется.
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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

// Разрешённые периоды — то же самое, что показывает фронтенд в
// переключателе периода над графиками
const ALLOWED_PERIODS = [7, 30, 90] as const;

// Тот же набор статусов, что и в app/api/orders/route.ts и в
// CHECK-ограничении orders.status из schema.sql
const STATUS_VALUES = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'] as const;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawDays = parseInt(searchParams.get('days') || '30', 10);
    const days = (ALLOWED_PERIODS as readonly number[]).includes(rawDays) ? rawDays : 30;

    // ------------------------------------------------------------
    // 1. ВЫРУЧКА ПО ДНЯМ (для линейного графика)
    // ------------------------------------------------------------
    // generate_series строит полный ряд дат за период — так дни без
    // единого заказа тоже попадут в график с выручкой 0, а не
    // "выпадут" из него (иначе линия графика ломалась бы по датам)
    const revenueByDayResult = await pool.query(
      `
      SELECT
        d::date AS date,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS revenue
      FROM generate_series(
        (CURRENT_DATE - (INTERVAL '1 day' * ($1::int - 1))),
        CURRENT_DATE,
        INTERVAL '1 day'
      ) AS d
      LEFT JOIN orders o
        ON o.created_at::date = d AND o.status != 'cancelled'
      LEFT JOIN order_items oi
        ON oi.order_id = o.id
      GROUP BY d
      ORDER BY d
      `,
      [days]
    );

    const revenueByDay = revenueByDayResult.rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      revenue: parseFloat(row.revenue),
    }));

    // ------------------------------------------------------------
    // 2. ТОП ЗАПЧАСТЕЙ ПО ВЫРУЧКЕ
    // ------------------------------------------------------------
    const topProductsResult = await pool.query(
      `
      SELECT
        oi.article,
        MAX(oi.name) AS name,
        SUM(oi.quantity) AS quantity,
        SUM(oi.price * oi.quantity) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled'
        AND o.created_at >= now() - (INTERVAL '1 day' * $1::int)
      GROUP BY oi.article
      ORDER BY revenue DESC
      LIMIT 8
      `,
      [days]
    );

    const topProducts = topProductsResult.rows.map((row) => ({
      article: row.article,
      name: row.name,
      quantity: parseInt(row.quantity, 10),
      revenue: parseFloat(row.revenue),
    }));

    // ------------------------------------------------------------
    // 3. ВЫРУЧКА ПО ПОСТАВЩИКАМ
    // ------------------------------------------------------------
    // supplier_name в order_items — это "снимок" на момент покупки
    // (см. schema.sql), группируем именно по нему: так статистика
    // не меняется задним числом, если поставщика потом переименуют
    const supplierRevenueResult = await pool.query(
      `
      SELECT
        COALESCE(oi.supplier_name, 'Без поставщика') AS supplier_name,
        SUM(oi.price * oi.quantity) AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status != 'cancelled'
        AND o.created_at >= now() - (INTERVAL '1 day' * $1::int)
      GROUP BY COALESCE(oi.supplier_name, 'Без поставщика')
      ORDER BY revenue DESC
      LIMIT 8
      `,
      [days]
    );

    const supplierRevenue = supplierRevenueResult.rows.map((row) => ({
      supplierName: row.supplier_name,
      revenue: parseFloat(row.revenue),
    }));

    // ------------------------------------------------------------
    // 4. РАЗБИВКА ЗАКАЗОВ ПО СТАТУСАМ (включая отменённые)
    // ------------------------------------------------------------
    const statusBreakdownResult = await pool.query(
      `
      SELECT status, COUNT(*) AS count
      FROM orders
      WHERE created_at >= now() - (INTERVAL '1 day' * $1::int)
      GROUP BY status
      `,
      [days]
    );

    const countsByStatus = new Map<string, number>(
      statusBreakdownResult.rows.map((row) => [row.status, parseInt(row.count, 10)])
    );
    // Проходим по ПОЛНОМУ списку статусов, а не только по тем, что
    // нашлись в базе — иначе статус без единого заказа за период
    // просто не появился бы в ответе, и на графике "выпал" бы
    const statusBreakdown = STATUS_VALUES.map((status) => ({
      status,
      count: countsByStatus.get(status) || 0,
    }));

    // ------------------------------------------------------------
    // 5. ОБЩИЕ ЦИФРЫ (карточки сверху экрана)
    // ------------------------------------------------------------
    const summaryResult = await pool.query(
      `
      SELECT
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS total_revenue
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status != 'cancelled'
        AND o.created_at >= now() - (INTERVAL '1 day' * $1::int)
      `,
      [days]
    );

    const totalOrders = parseInt(summaryResult.rows[0].total_orders, 10);
    const totalRevenue = parseFloat(summaryResult.rows[0].total_revenue);
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    return NextResponse.json({
      success: true,
      periodDays: days,
      summary: { totalOrders, totalRevenue, averageOrderValue },
      revenueByDay,
      topProducts,
      supplierRevenue,
      statusBreakdown,
    });
  } catch (error) {
    console.error('Ошибка при получении аналитики:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить аналитику: ' + message },
      { status: 500 }
    );
  }
}
