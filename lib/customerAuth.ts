// ============================================================
// Сессия покупателя (Особистий кабінет) — вход по одноразовому коду,
// который приходит в Telegram-бот.
//
// Раньше "входом" был просто ввод номера телефона: любой, кто знал
// чужой номер, видел чужие заказы, адреса, VIN, а cookie customer_phone
// с чужим номером давала персональные цены. Теперь:
//   1. POST /api/customer/auth/request-code — код в Telegram-чат,
//      привязанный к номеру через "📱 Поділитися номером" (номер
//      подтверждён самим Telegram);
//   2. POST /api/customer/auth/verify-code — верный код → сессия:
//      случайный токен 32 байта в cookie customer_session, в базе
//      (customer_sessions) — только его sha256, срок 30 дней;
//   3. все /api/customer/* берут телефон ТОЛЬКО из сессии
//      (requireCustomer), параметр phone из адреса/тела игнорируется.
// ============================================================

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { getClientIp } from '@/lib/adminAuth';
import { getSigningSecret } from '@/lib/adminSessionToken';
import { isCustomerCabinetEnabled, CUSTOMER_CABINET_DISABLED_MESSAGE } from '@/lib/customerCabinet';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';

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

export const CUSTOMER_SESSION_COOKIE = 'customer_session';
export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// Лимит для изменяющих запросов кабинета (POST/PATCH/DELETE) с одного IP
const CUSTOMER_WRITE_LIMIT = 30;
const CUSTOMER_WRITE_WINDOW_SECONDS = 10 * 60;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ------------------------------------------------------------
// Одноразовые коды
// ------------------------------------------------------------

// sha256(код + SESSION_SECRET): даже с доступом к базе 6-значный код
// нельзя перебрать офлайн — без секрета хеши не посчитать.
// null — секрет не настроен (в production вход тогда невозможен)
export function hashLoginCode(code: string): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;
  return sha256Hex(`${code}${secret}`);
}

// Сравнение хешей кода за постоянное время (оба — hex sha256 одной длины)
export function loginCodeHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

// ------------------------------------------------------------
// Сессии
// ------------------------------------------------------------

// Телефон (последние 9 цифр) по значению cookie, или null
async function findSessionPhone(cookieValue: string | undefined): Promise<string | null> {
  if (!cookieValue || cookieValue.length < 20 || !isCustomerCabinetEnabled()) return null;
  try {
    const result = await pool.query<{ id: string; phone: string }>(
      'SELECT id, phone FROM customer_sessions WHERE token_hash = $1 AND expires_at > now()',
      [sha256Hex(cookieValue)]
    );
    const row = result.rows[0];
    if (!row) return null;
    // last_seen_at — не чаще раза в 5 минут, чтобы не писать на каждый запрос
    await pool.query(
      "UPDATE customer_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'",
      [row.id]
    );
    return row.phone;
  } catch (error) {
    console.error('Ошибка при проверке сессии покупателя:', error);
    return null;
  }
}

// Телефон из сессии для серверных страниц (категории, марки, товар) —
// там нет объекта request, cookie читаем через next/headers.
// Используется для персональных цен (lib/customerPricing.ts)
export async function getCustomerSessionPhone(): Promise<string | null> {
  const cookieStore = await cookies();
  return findSessionPhone(cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value);
}

export async function getCustomerSessionPhoneFromRequest(request: NextRequest): Promise<string | null> {
  return findSessionPhone(request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value);
}

// Главная проверка для /api/customer/* (кроме auth/*): { phone } из
// сессии или готовый ответ (401 — не вошёл, 403 — кабинет выключен,
// 429 — слишком много изменяющих запросов с этого IP)
export async function requireCustomer(request: NextRequest): Promise<{ phone: string } | NextResponse> {
  if (!isCustomerCabinetEnabled()) {
    return NextResponse.json({ error: CUSTOMER_CABINET_DISABLED_MESSAGE }, { status: 403 });
  }

  const phone = await getCustomerSessionPhoneFromRequest(request);
  if (!phone) {
    return NextResponse.json({ error: 'Увійдіть в особистий кабінет.' }, { status: 401 });
  }

  if (request.method !== 'GET' && !(await checkCustomerWriteLimit())) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  return { phone };
}

// Лимит изменяющих запросов кабинета с одного IP (30 за 10 минут) —
// общий для requireCustomer и для auth-роутов (verify-code, logout)
export async function checkCustomerWriteLimit(): Promise<boolean> {
  const ip = await getClientIp();
  return rateLimit(`customer-write:${ip}`, CUSTOMER_WRITE_LIMIT, CUSTOMER_WRITE_WINDOW_SECONDS);
}

// Новая сессия: возвращает сам токен (его кладём в cookie)
export async function createCustomerSession(phone: string, ip: string, userAgent: string | null): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO customer_sessions (phone, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [phone, sha256Hex(token), CUSTOMER_SESSION_TTL_SECONDS, ip, userAgent ? userAgent.slice(0, 500) : null]
  );
  return token;
}

export async function deleteCustomerSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  await pool.query('DELETE FROM customer_sessions WHERE token_hash = $1', [sha256Hex(cookieValue)]);
}

// Параметры cookie сессии покупателя (и для установки, и для удаления)
export function customerSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true, // недоступна из JavaScript — защита от кражи через XSS
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
  };
}

// Чистка — из ежедневного cron: коды старше суток, истёкшие сессии
export async function cleanupCustomerAuthTables(): Promise<{ codes: number; sessions: number }> {
  const codes = await pool.query("DELETE FROM customer_login_codes WHERE created_at < now() - interval '1 day'");
  const sessions = await pool.query('DELETE FROM customer_sessions WHERE expires_at < now()');
  return { codes: codes.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
}
