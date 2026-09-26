// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/login
//
// Проверяет пароль администратора (переменная окружения ADMIN_PASSWORD)
// и, если он верный, создаёт СЕССИЮ:
//   - случайный токен 32 байта (crypto.randomBytes через Web Crypto);
//   - в базу (admin_sessions) — только sha256(токена), срок 7 дней,
//     IP и браузер (для просмотра "кто и откуда входил");
//   - в cookie — сам токен, подписанный SESSION_SECRET (см.
//     lib/adminSessionToken.ts), с флагами HttpOnly, Secure, SameSite=Lax.
//
// Раньше cookie была просто sha256(пароля): одинаковая для всех входов,
// вечная до смены пароля, "Вийти" её не отзывал, а из неё можно было
// подбирать сам пароль. Теперь каждая сессия своя и удаляется при выходе.
//
// Защита от подбора: не больше 5 неудачных попыток за 15 минут с
// одного IP (таблица admin_login_attempts), дальше — 429. Удачный вход
// сбрасывает счётчик этого IP. Плюс общий лимит: больше 30 неудачных
// входов за час со всех IP вместе — вход закрыт для всех на 15 минут и
// владельцу приходит уведомление в Telegram (lib/adminAuth.ts).
// IP — из x-real-ip, который ставит Vercel (клиент его не подменит).
//
// Здесь всего ОДИН пароль на всю админку (без логинов пользователей) —
// осознанное упрощение
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  generateSessionToken,
  hashSessionToken,
  signSessionCookie,
} from '@/lib/adminSessionToken';
import {
  LOGIN_MAX_FAILED_ATTEMPTS,
  clearFailedLogins,
  countRecentFailedLogins,
  createAdminSession,
  getClientIp,
  isGlobalLoginLockoutActive,
  recordFailedLogin,
} from '@/lib/adminAuth';

export const runtime = 'nodejs';

interface LoginRequestBody {
  password?: string;
}

// Сравнение пароля за постоянное время. timingSafeEqual требует буферы
// одинаковой длины — поэтому сравниваем sha256 обоих значений (всегда
// 32 байта), а не сами строки разной длины
function passwordsMatch(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  let body: LoginRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: 'На сервере не настроен пароль администратора (переменная ADMIN_PASSWORD).' },
      { status: 500 }
    );
  }

  const ip = await getClientIp();

  try {
    // Лимиты проверяем ДО сравнения пароля — пока действует блокировка,
    // даже верный пароль не принимается:
    //   - общая: >30 неудачных входов за час со всех IP — закрыто для всех на 15 минут;
    //   - по IP: 5 неудачных за 15 минут с этого адреса
    if (
      (await isGlobalLoginLockoutActive()) ||
      (await countRecentFailedLogins(ip)) >= LOGIN_MAX_FAILED_ATTEMPTS
    ) {
      return NextResponse.json({ error: 'Забагато спроб, спробуйте через 15 хвилин' }, { status: 429 });
    }

    const password = (body.password || '').trim();
    if (!password || !passwordsMatch(password, adminPassword)) {
      await recordFailedLogin(ip);
      return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
    }

    const token = generateSessionToken();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
    const cookieValue = await signSessionCookie(token, expiresAtUnix);
    if (!cookieValue) {
      // Подробности уже в console.error (lib/adminSessionToken.ts)
      return NextResponse.json({ error: 'SESSION_SECRET не налаштовано' }, { status: 500 });
    }

    await createAdminSession(
      await hashSessionToken(token),
      new Date(expiresAtUnix * 1000),
      ip,
      request.headers.get('user-agent')
    );
    await clearFailedLogins(ip);

    const response = NextResponse.json({ success: true });
    response.cookies.set(ADMIN_SESSION_COOKIE, cookieValue, {
      httpOnly: true, // недоступна из JavaScript — защита от кражи через XSS
      secure: process.env.NODE_ENV === 'production', // только HTTPS (локально http://localhost — без него)
      sameSite: 'lax',
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('Ошибка при входе администратора:', error);
    return NextResponse.json({ error: 'Сталася помилка, спробуйте пізніше' }, { status: 500 });
  }
}
