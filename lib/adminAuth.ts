// ============================================================
// Проверка сессии администратора В БАЗЕ (Node.js-роуты и страницы).
//
// middleware.ts проверяет только подпись cookie (он в Edge Runtime и
// в Postgres ходить не может — см. lib/adminSessionToken.ts). Здесь —
// вторая, главная проверка: сессия есть в admin_sessions и не истекла.
// requireAdmin() вызывается в начале КАЖДОГО админского роута, чтобы
// защита не держалась на одном middleware (если middleware когда-нибудь
// обойдут, как в CVE-2025-29927, роуты всё равно ответят 401).
//
// Использование в роуте:
//   const denied = await requireAdmin();
//   if (denied) return denied;
// ============================================================

import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { ADMIN_SESSION_COOKIE, hashSessionToken, verifySessionCookie } from '@/lib/adminSessionToken';
import { sendTelegramMessage } from '@/lib/telegramNotify';
import { ensureAdminUsersTables, type AdminIdentity } from '@/lib/adminUsers';

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

// Ищет живую сессию по значению cookie и возвращает, КТО вошёл.
// last_seen_at обновляем не чаще раза в 5 минут — чтобы не писать в
// базу на каждый запрос админки. Сессия отключённого пользователя не
// считается живой. Сессия без user_id (создана до появления
// пользователей, вход по общему паролю) считается сессией владельца
async function findActiveAdmin(cookieValue: string | undefined): Promise<AdminIdentity | null> {
  const token = await verifySessionCookie(cookieValue);
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  try {
    await ensureAdminUsersTables();
    const result = await pool.query<{
      id: string;
      user_id: string | null;
      login: string | null;
      name: string | null;
      role: 'owner' | 'manager' | null;
      is_active: boolean | null;
    }>(
      `
      SELECT s.id, s.user_id, u.login, u.name, u.role, u.is_active
      FROM admin_sessions s
      LEFT JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      `,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.user_id && !row.is_active) return null;

    await pool.query(
      "UPDATE admin_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'",
      [row.id]
    );

    return {
      id: row.user_id,
      login: row.login ?? 'owner',
      name: row.name ?? 'Адмін',
      role: row.role ?? 'owner',
      sessionId: row.id,
    };
  } catch (error) {
    // База недоступна — безопасный вариант: "не админ"
    console.error('Ошибка при проверке сессии администратора:', error);
    return null;
  }
}

// Текущий пользователь админки (для страниц и роутов без объекта
// request) или null, если не вошёл
export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  const cookieStore = await cookies();
  return findActiveAdmin(cookieStore.get(ADMIN_SESSION_COOKIE)?.value);
}

// true — запрос от залогиненного пользователя админки (сессия в базе)
export async function isAdminSession(): Promise<boolean> {
  return (await getCurrentAdmin()) !== null;
}

// То же для роутов, где под рукой объект request (публичные роуты,
// которые отдают админу дополнительные поля: /api/products и т.п.)
export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  return (await findActiveAdmin(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)) !== null;
}

// Главная функция для админских роутов: null — можно продолжать,
// иначе готовый ответ 401, который роут просто возвращает
export async function requireAdmin(): Promise<NextResponse | null> {
  if (await isAdminSession()) return null;
  return NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
}

// Короткая форма requireOwner() для роутов закрытых разделов (закупки,
// касса, поставщики, отчёты, настройки): тот же формат ответа, что и у
// requireAdmin() — null или готовый 401/403. Менеджер получает 403
export async function requireOwnerAccess(): Promise<NextResponse | null> {
  return (await requireOwner()).denied;
}

// Для разделов только для владельца (управление менеджерами и т.п.):
// 401 — не вошёл, 403 — вошёл, но он менеджер. Вторым элементом
// возвращает пользователя, чтобы роуту не искать его ещё раз
export async function requireOwner(): Promise<{ denied: NextResponse } | { denied: null; admin: AdminIdentity }> {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return { denied: NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 }) };
  }
  if (admin.role !== 'owner') {
    return { denied: NextResponse.json({ error: 'Недостатньо прав: дія доступна лише власнику.' }, { status: 403 }) };
  }
  return { denied: null, admin };
}

// ------------------------------------------------------------
// Создание и удаление сессий (вход / выход)
// ------------------------------------------------------------

export async function createAdminSession(
  tokenHash: string,
  expiresAt: Date,
  ip: string | null,
  userAgent: string | null,
  userId: string
): Promise<void> {
  // Истёкшие сессии чистит ежедневный cron (cleanupAdminAuthTables)
  await ensureAdminUsersTables();
  await pool.query(
    'INSERT INTO admin_sessions (token_hash, expires_at, ip, user_agent, user_id) VALUES ($1, $2, $3, $4, $5)',
    [tokenHash, expiresAt, ip, userAgent ? userAgent.slice(0, 500) : null, userId]
  );
}

export async function deleteAdminSessionByCookie(cookieValue: string | undefined): Promise<void> {
  const token = await verifySessionCookie(cookieValue);
  if (!token) return;
  await pool.query('DELETE FROM admin_sessions WHERE token_hash = $1', [await hashSessionToken(token)]);
}

// ------------------------------------------------------------
// Лимит попыток входа: не больше 5 неудачных за 15 минут с одного IP
// ------------------------------------------------------------

export const LOGIN_MAX_FAILED_ATTEMPTS = 5;

// Общий лимит на ВСЕ IP вместе (подбор пароля с множества адресов):
// больше 30 неудачных входов за час — вход закрыт для всех на 15 минут
// и владельцу уходит уведомление в Telegram
export const LOGIN_GLOBAL_MAX_FAILED_PER_HOUR = 30;

// Служебное значение в колонке ip — отметка "включена общая блокировка"
// (время начала — attempted_at). Настоящий IP таким быть не может,
// поэтому в лимит конкретного IP эти строки не попадают
const GLOBAL_LOCKOUT_MARKER = '__global_lockout__';

// IP клиента. x-real-ip ставит сам Vercel — клиент его подменить не
// может. Первое значение x-forwarded-for, наоборот, может прислать сам
// клиент (Vercel дописывает настоящий адрес В КОНЕЦ), поэтому, если
// x-real-ip нет, берём ПОСЛЕДНИЙ элемент x-forwarded-for
export async function getClientIp(): Promise<string> {
  const headerStore = await headers();
  const realIp = headerStore.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const forwarded = headerStore.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

export async function countRecentFailedLogins(ip: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM admin_login_attempts WHERE ip = $1 AND attempted_at > now() - interval '15 minutes'",
    [ip]
  );
  return result.rows[0]?.count ?? 0;
}

// Действует ли сейчас общая блокировка (включена меньше 15 минут назад)
export async function isGlobalLoginLockoutActive(): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM admin_login_attempts WHERE ip = $1 AND attempted_at > now() - interval '15 minutes' LIMIT 1",
    [GLOBAL_LOCKOUT_MARKER]
  );
  return result.rows.length > 0;
}

export async function recordFailedLogin(ip: string): Promise<void> {
  await pool.query('INSERT INTO admin_login_attempts (ip) VALUES ($1)', [ip]);

  // Общий лимит: считаем неудачи за последний час, но только ПОСЛЕ
  // предыдущей общей блокировки — иначе после её окончания первая же
  // ошибка снова закрыла бы вход и прислала повторное уведомление
  const result = await pool.query<{ failed: number; ips: number }>(
    `
    SELECT COUNT(*)::int AS failed, COUNT(DISTINCT ip)::int AS ips
    FROM admin_login_attempts
    WHERE ip <> $1
      AND attempted_at > now() - interval '1 hour'
      AND attempted_at > COALESCE(
        (SELECT MAX(attempted_at) FROM admin_login_attempts WHERE ip = $1),
        '-infinity'::timestamptz
      )
    `,
    [GLOBAL_LOCKOUT_MARKER]
  );
  const failed = result.rows[0]?.failed ?? 0;
  if (failed <= LOGIN_GLOBAL_MAX_FAILED_PER_HOUR) return;

  await pool.query('INSERT INTO admin_login_attempts (ip) VALUES ($1)', [GLOBAL_LOCKOUT_MARKER]);
  // Тот же канал, что уведомления о новых заказах (чат владельца).
  // Ошибка отправки не должна ломать ответ на вход
  try {
    await sendTelegramMessage(
      [
        '🚨 Підозра на підбір пароля до адмінки DominatorParts',
        `За останню годину: ${failed} невдалих спроб входу з ${result.rows[0]?.ips ?? 0} IP-адрес.`,
        'Вхід в адмінку закрито для всіх на 15 хвилин.',
        'Якщо це не ви — варто змінити ADMIN_PASSWORD у Vercel.',
      ].join('\n')
    );
  } catch (error) {
    console.error('Не удалось отправить в Telegram уведомление о блокировке входа:', error);
  }
}

// Чистка служебных таблиц входа — вызывается из ежедневного cron
// (app/api/cron/fetch-product-images): истёкшие сессии и попытки
// входа старше суток (для лимитов нужны максимум последние 60 минут)
export async function cleanupAdminAuthTables(): Promise<{ sessions: number; attempts: number }> {
  const sessions = await pool.query('DELETE FROM admin_sessions WHERE expires_at < now()');
  const attempts = await pool.query("DELETE FROM admin_login_attempts WHERE attempted_at < now() - interval '1 day'");
  return { sessions: sessions.rowCount ?? 0, attempts: attempts.rowCount ?? 0 };
}

export async function clearFailedLogins(ip: string): Promise<void> {
  await pool.query('DELETE FROM admin_login_attempts WHERE ip = $1', [ip]);
}
