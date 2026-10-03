// ============================================================
// Ответственный менеджер заказа.
//
// В orders добавлены две колонки:
//   assigned_manager_id — кто ведёт заказ (admin_users.id); NULL — заказ
//                         никому не назначен. ON DELETE SET NULL: если
//                         пользователя когда-нибудь удалят из базы, заказ
//                         не пропадёт, а просто станет "без менеджера"
//   assigned_at         — когда заказ взяли в работу / передали
//
// Колонки описаны в конце schema.sql, но этот модуль сам добавляет их при
// первом обращении (тот же приём, что и для orders.manager_note и
// order_history), поэтому SQL в базе вручную запускать не нужно.
// ============================================================

import { Pool } from 'pg';
import { ensureAdminUsersTables } from '@/lib/adminUsers';

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

let columnsReady: Promise<void> | null = null;

// Один раз на запуск функции; при ошибке забываем результат, чтобы
// следующий вызов попробовал снова
export function ensureOrderAssignmentColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      // admin_users должна существовать раньше, чем на неё сошлётся FK
      await ensureAdminUsersTables();
      await pool.query(
        'ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_manager_id UUID REFERENCES admin_users(id) ON DELETE SET NULL'
      );
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ');
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_orders_assigned_manager_id ON orders (assigned_manager_id)'
      );
    })().catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  return columnsReady;
}
