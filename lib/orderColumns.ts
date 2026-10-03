// ============================================================
// Дополнительные колонки таблицы orders, которые добавились вместе с
// доработками окна заказа, — чтобы не выполнять SQL в базе вручную,
// код сам проверяет их наличие при первом обращении и добавляет
// недостающие (тот же приём, что и для stock_movements.comment).
//
//   manager_note — внутренняя заметка менеджера (клиент не видит)
//   callback_at  — напоминание "Передзвонити": когда перезвонить клиенту
//
// Обе колонки также описаны в конце schema.sql.
// Используется: app/api/orders/[id]/route.ts (окно заказа),
// app/api/orders/route.ts (список заказов, фильтр "Передзвонити"),
// app/api/admin/nav-counters/route.ts (счётчик в меню).
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
  { name: 'manager_note', sql: 'ALTER TABLE orders ADD COLUMN IF NOT EXISTS manager_note TEXT' },
  { name: 'callback_at', sql: 'ALTER TABLE orders ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ' },
];

// Результат запоминаем — проверка идёт один раз на запуск функции;
// при ошибке забываем, чтобы следующий запрос попробовал снова
let columnsReady: Promise<void> | null = null;

export function ensureOrderExtraColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      // Сначала лёгкая проверка через information_schema: ALTER TABLE
      // на мгновение блокирует таблицу, поэтому запускаем его только
      // для реально отсутствующих колонок
      const check = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = ANY($1::text[])`,
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
