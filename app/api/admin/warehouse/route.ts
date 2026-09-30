// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/warehouse
//
// Список товаров, которые физически проходили через НАШ склад, с
// текущим остатком. Остаток считается как сумма всех движений
// stock_movements.quantity_change по товару (приходы от поставщиков,
// продажи, возвраты, ручные корректировки, списания брака).
//
// Почему не products.stock: в этой колонке лежит остаток ПОСТАВЩИКА из
// его прайс-листа — при каждой загрузке прайса она перезаписывается
// (см. app/api/suppliers/parse-excel/route.ts). А сумма движений —
// это именно то, что реально лежит у нас на полке.
//
//   Параметры запроса:
//     search      — поиск по артикулу, бренду или названию
//     onlyInStock — "1": только товары с остатком больше нуля
//     page        — номер страницы (по умолчанию 1)
//
//   Ответ: { success, items: [...], pagination, totals }
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

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const searchParams = request.nextUrl.searchParams;
  const search = (searchParams.get('search') || '').trim();
  const onlyInStock = searchParams.get('onlyInStock') === '1';
  const rawPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  // Артикулы в базе хранятся "очищенными" (без пробелов, дефисов,
  // в верхнем регистре) — поэтому для поиска по артикулу чистим
  // запрос так же, а для бренда/названия ищем как есть
  const articleSearch = search.toUpperCase().replace(/[^A-Z0-9А-ЯЁІЇЄҐ]/g, '');

  try {
    // Один общий подзапрос (WITH) для списка, количества и итогов —
    // чтобы фильтры гарантированно были одинаковыми во всех трёх местах
    const params: unknown[] = [search ? `%${search}%` : null, articleSearch ? `%${articleSearch}%` : null, onlyInStock];

    const baseSql = `
      WITH balances AS (
        SELECT
          sm.product_id,
          SUM(sm.quantity_change)::int AS balance,
          MAX(sm.created_at) AS last_movement_at
        FROM stock_movements sm
        GROUP BY sm.product_id
      )
      SELECT
        p.id,
        p.article,
        p.brand,
        p.name,
        p.cost_price,
        p.retail_price,
        s.name AS supplier_name,
        b.balance,
        b.last_movement_at
      FROM balances b
      JOIN products p ON p.id = b.product_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE ($1::text IS NULL OR p.name ILIKE $1 OR p.brand ILIKE $1 OR p.article ILIKE COALESCE($2::text, $1))
        AND ($3::boolean = false OR b.balance > 0)
    `;

    const [listResult, totalsResult] = await Promise.all([
      pool.query(
        `${baseSql}
        ORDER BY b.last_movement_at DESC
        LIMIT ${PAGE_SIZE} OFFSET $4`,
        [...params, (page - 1) * PAGE_SIZE]
      ),
      pool.query(
        `
        SELECT
          COUNT(*)::int AS total_count,
          COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::int AS total_units,
          COALESCE(SUM(balance * cost_price) FILTER (WHERE balance > 0), 0) AS total_cost
        FROM (${baseSql}) AS filtered
        `,
        params
      ),
    ]);

    const totals = totalsResult.rows[0];
    const totalCount: number = totals.total_count;

    return NextResponse.json({
      success: true,
      items: listResult.rows.map((row) => ({
        productId: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        supplierName: row.supplier_name,
        // NUMERIC драйвер pg отдаёт строкой — переводим в число
        costPrice: parseFloat(row.cost_price),
        retailPrice: parseFloat(row.retail_price),
        balance: row.balance,
        lastMovementAt: row.last_movement_at,
      })),
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
      },
      totals: {
        // Сколько штук всего лежит на складе и на какую сумму по
        // закупочной цене — удобно видеть "сколько денег на полке"
        units: totals.total_units,
        costAmount: parseFloat(totals.total_cost),
      },
    });
  } catch (error) {
    console.error('Ошибка при получении остатков склада:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить остатки склада: ' + message }, { status: 500 });
  }
}
