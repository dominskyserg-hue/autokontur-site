// ============================================================
// Общий ограничитель частоты запросов (rate limit) на Postgres.
//
// rateLimit(key, limit, windowSeconds) — "не больше limit раз за
// windowSeconds секунд для ключа key". Ключ — произвольная строка,
// обычно "что:IP", например "orders-create:203.0.113.7".
// Каждый вызов, который пропущен, записывается строкой в rate_limits;
// если за окно строк уже limit — возвращает false (запрос отклонить).
//
// Почему в базе, а не в памяти: на Vercel каждый запрос может попасть в
// новый экземпляр функции, счётчик в памяти там бесполезен.
// Старые строки удаляет ежедневный cron (cleanupRateLimits).
//
// IP клиента — getClientIp() из lib/adminAuth.ts (x-real-ip, который
// ставит Vercel и который клиент подменить не может)
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

// Текст ответа 429 для публичных форм (заказы, VIN-запросы, кабинет)
export const RATE_LIMIT_MESSAGE = 'Забагато запитів, спробуйте через кілька хвилин';

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const result = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM rate_limits WHERE key = $1 AND created_at > now() - make_interval(secs => $2)",
      [key, windowSeconds]
    );
    if ((result.rows[0]?.count ?? 0) >= limit) return false;
    await pool.query('INSERT INTO rate_limits (key) VALUES ($1)', [key]);
    return true;
  } catch (error) {
    // База недоступна — лимит не должен ронять оформление заказа:
    // пропускаем, но пишем в логи
    console.error('Ошибка rate limit:', error);
    return true;
  }
}

// Чистка — из ежедневного cron: самое длинное окно лимитов — 15 минут,
// сутки берём с большим запасом
export async function cleanupRateLimits(): Promise<number> {
  const result = await pool.query("DELETE FROM rate_limits WHERE created_at < now() - interval '1 day'");
  return result.rowCount ?? 0;
}
