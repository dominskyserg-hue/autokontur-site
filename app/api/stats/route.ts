// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/stats
//
// Отдаёт агрегированные цифры для карточек статистики наверху
// экрана "Поставщики и маппинг Excel":
//   - сколько всего поставщиков и сколько из них активны
//   - у скольких настроен маппинг Excel
//   - средняя наценка по всем настроенным маппингам
//   - сколько всего товарных позиций загружено в каталог
//
// Все цифры — настоящие, посчитанные прямо по таблицам suppliers /
// supplier_excel_mappings / products, а не заглушки.
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

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

export async function GET() {
  try {
    // Один запрос сразу считает всё нужное через подзапросы —
    // так дешевле, чем делать 4 отдельных обращения к базе
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM suppliers) AS suppliers_count,
        (SELECT COUNT(*) FROM suppliers WHERE is_active) AS active_suppliers_count,
        (SELECT COUNT(*) FROM supplier_excel_mappings) AS mapped_suppliers_count,
        (SELECT COALESCE(AVG(markup_percent), 0) FROM supplier_excel_mappings) AS average_markup,
        (SELECT COUNT(*) FROM products) AS products_count
    `);

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      suppliersCount: parseInt(row.suppliers_count, 10),
      activeSuppliersCount: parseInt(row.active_suppliers_count, 10),
      mappedSuppliersCount: parseInt(row.mapped_suppliers_count, 10),
      // average_markup — колонка NUMERIC, драйвер pg возвращает
      // такие значения строкой, поэтому явно переводим в число
      averageMarkup: Math.round(parseFloat(row.average_markup) * 10) / 10,
      productsCount: parseInt(row.products_count, 10),
    });
  } catch (error) {
    console.error('Ошибка при получении статистики:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить статистику: ' + message },
      { status: 500 }
    );
  }
}
