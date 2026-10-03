// ============================================================
// История изменений заказа — кто и когда что поменял: статус, ТТН,
// цены и состав позиций, оплаты, возвраты. Показывается в окне заказа
// (components/OrderDetailsModal.tsx, блок "Історія змін"), читается
// через GET /api/orders/[id]/history.
//
// Таблица order_history добавлена в конец schema.sql. Чтобы не нужно
// было отдельно выполнять SQL в базе, этот модуль сам создаёт её при
// первом обращении, если её ещё нет (тот же приём, что и для колонок
// stock_movements.comment и orders.manager_note).
//
// ВАЖНО: запись в историю — дополнительная функция. Если она по
// какой-то причине не удалась, основное действие (смена статуса,
// оплата...) всё равно должно пройти — поэтому logOrderEvent никогда
// не выбрасывает ошибку наружу, а только пишет её в лог сервера.
// ============================================================

import { Pool } from 'pg';
import { getCurrentAdmin } from '@/lib/adminAuth';

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

// Проверка/создание таблицы — один раз на запуск функции; при ошибке
// забываем результат, чтобы следующий вызов попробовал снова
let tableReady: Promise<void> | null = null;

export function ensureOrderHistoryTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      // to_regclass — лёгкая проверка "есть ли такая таблица", без
      // блокировок; CREATE выполняем, только если таблицы нет
      const check = await pool.query(`SELECT to_regclass('order_history') AS name`);
      if (!check.rows[0].name) {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS order_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            message TEXT NOT NULL,
            created_by TEXT NOT NULL DEFAULT 'admin',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `);
        await pool.query(
          'CREATE INDEX IF NOT EXISTS idx_order_history_order_id ON order_history (order_id, created_at DESC)'
        );
      }
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

// Кто делает действие — имя вошедшего сотрудника (из cookie-сессии).
// Вне запроса браузера (cron, вебхуки, фоновые задачи) cookie нет —
// тогда пишем "система"; сбой определения автора никогда не должен
// мешать самой записи
async function resolveAuthor(): Promise<string> {
  try {
    const admin = await getCurrentAdmin();
    return admin ? admin.name : 'admin';
  } catch {
    return 'система';
  }
}

// Записать одно или несколько событий в историю заказа. Пустые
// сообщения пропускаются — удобно передавать список "что изменилось",
// где часть пунктов может оказаться пустой
export async function logOrderEvent(orderId: string, messages: string | Array<string | null | undefined>): Promise<void> {
  const list = (Array.isArray(messages) ? messages : [messages]).filter(
    (message): message is string => Boolean(message && message.trim())
  );
  if (list.length === 0) return;

  try {
    await ensureOrderHistoryTable();
    const author = await resolveAuthor();
    for (const message of list) {
      await pool.query('INSERT INTO order_history (order_id, message, created_by) VALUES ($1, $2, $3)', [
        orderId,
        message,
        author,
      ]);
    }
  } catch (error) {
    console.error('Не удалось записать историю заказа:', error);
  }
}

// Деньги для текста истории: "1 250,5 грн"
export function historyMoney(value: number): string {
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} грн`;
}

// Пустое значение в тексте истории показываем прочерком
export function historyValue(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '—';
}
