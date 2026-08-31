// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/login
//
// Проверяет пароль администратора (переменная окружения ADMIN_PASSWORD)
// и, если он верный, выдаёт cookie-"сессию" — её потом на каждый
// запрос проверяет middleware.ts, решая, пускать в /admin и в
// административные API-роуты или отправлять на экран входа.
//
// В cookie кладётся НЕ сам пароль, а его SHA-256-хеш — так же его
// проверяет middleware.ts (там ровно та же функция sha256Hex, но
// продублированная, а не вынесенная в общий файл — см. комментарий
// про это в middleware.ts: middleware выполняется в Edge Runtime,
// этот же роут — в обычном Node.js, поэтому их проще держать
// самостоятельными, чем городить общий модуль под оба рантайма).
//
// Здесь всего ОДИН пароль на всю админку (без логинов пользователей) —
// это осознанное упрощение, ровно как и в остальной "авторизации"
// проекта (например, вход покупателя в личный кабинет по одному
// телефону, см. app/api/customer/orders/route.ts)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

// Хотя этот роут не обращается к базе данных, Node.js runtime указан
// явно для единообразия с остальными роутами проекта
export const runtime = 'nodejs';

const AUTH_COOKIE_NAME = 'autokontur_admin_session';
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

interface LoginRequestBody {
  password?: string;
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
    // Переменная окружения не настроена вообще — это ошибка
    // конфигурации сервера, а не неверный пароль пользователя
    return NextResponse.json(
      { error: 'На сервере не настроен пароль администратора (переменная ADMIN_PASSWORD).' },
      { status: 500 }
    );
  }

  const password = (body.password || '').trim();
  if (!password || password !== adminPassword) {
    return NextResponse.json({ error: 'Неверный пароль.' }, { status: 401 });
  }

  const sessionToken = await sha256Hex(adminPassword);

  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, sessionToken, {
    httpOnly: true, // недоступна из JavaScript в браузере — защита от XSS-кражи cookie
    secure: process.env.NODE_ENV === 'production', // на Vercel — только по HTTPS; локально (http://localhost) это бы сломало cookie
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_IN_SECONDS,
    path: '/',
  });

  return response;
}
