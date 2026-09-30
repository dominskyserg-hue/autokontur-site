// ============================================================
// Дополнительные колонки таблицы order_items для закупок —
// ожидаемая дата поставки от поставщика. Как и lib/orderColumns.ts,
// код сам проверяет их наличие при первом обращении и добавляет
// недостающие, чтобы не выполнять SQL в базе вручную.
//
//   supplier_ordered_at — когда позицию заказали у поставщика
//                         (нажали "Сформировать заказ поставщику")
//   expected_at         — когда поставщик обещал привезти (дата).
//                         Если дата прошла, а товар не принят —
//                         на экране "Закупки" пишем "запізнюється на N днів",
//                         а в меню горит счётчик опозданий
//
// Обе колонки также описаны в конце schema.sql.
// Используется: app/api/admin/procurement/needed/route.ts,
// app/api/admin/procurement/order-from-supplier/route.ts,
// app/api/admin/procurement/expected-date/route.ts,
// app/api/admin/nav-counters/route.ts.
// ============================================================

import { Pool } from 'pg';

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

const EXTRA_COLUMNS: Array<{ name: string; sql: string }> = [
  { name: 'supplier_ordered_at', sql: 'ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_ordered_at TIMESTAMPTZ' },
  { name: 'expected_at', sql: 'ALTER TABLE order_items ADD COLUMN IF NOT EXISTS expected_at DATE' },
];

// "Сегодня" считаем по киевскому времени, а не по UTC сервера базы —
// иначе после полуночи по Киеву (но до 03:00) опоздание "не наступало"
export const KYIV_TODAY_SQL = `(now() AT TIME ZONE 'Europe/Kyiv')::date`;

// Результат запоминаем — проверка идёт один раз на запуск функции;
// при ошибке забываем, чтобы следующий запрос попробовал снова
let columnsReady: Promise<void> | null = null;

export function ensureOrderItemProcurementColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      // Лёгкая проверка через information_schema: ALTER TABLE на мгновение
      // блокирует таблицу, поэтому запускаем его только для отсутствующих колонок
      const check = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'order_items' AND column_name = ANY($1::text[])`,
        [EXTRA_COLUMNS.map((c) => c.name)]
      );
      const existing = new Set(check.rows.map((row) => row.column_name as string));
      for (const column of EXTRA_COLUMNS) {
        if (!existing.has(column.name)) {
          await pool.query(column.sql);
        }
      }
    })().catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  return columnsReady;
}
