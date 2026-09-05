// ============================================================
// Next.js Middleware — единая точка входа для защиты админ-панели
// паролем. Выполняется НА КАЖДЫЙ запрос, который подпадает под
// config.matcher ниже, ДО того, как запрос доходит до самой страницы
// или API-роута.
//
// Раньше /admin/* и все административные API-роуты (создать/удалить
// товар, сменить статус заказа, загрузить прайс поставщика и т.п.)
// были открыты КАЖДОМУ, кто просто знает адрес — без единой проверки.
// Здесь это исправлено в ДВУХ местах разом:
//
//   1. Страницы /admin/* — без валидной cookie-сессии посетителя
//      перенаправляет на /admin/login
//   2. API-роуты — БЕЛЫЙ список (PUBLIC_API_ROUTES) явно перечисляет,
//      какие запросы вызывает САМА ВИТРИНА (не адмінка) и поэтому не
//      требуют пароля. ЛЮБОЙ другой запрос под /api/ без валидной
//      сессии получает 401. Это осознанно "белый", а не "чёрный"
//      список: если позже добавят новый административный роут и
//      забудут явно защитить его — он всё равно останется защищённым
//      по умолчанию, а не окажется случайно открытым всем
//
// Middleware выполняется в Edge Runtime, а не в Node.js — поэтому
// здесь НЕЛЬЗЯ использовать библиотеку pg или обычный модуль
// node:crypto (как в остальных API-роутах проекта). Вместо этого для
// хеширования пароля используется Web Crypto API (crypto.subtle) —
// он одинаково доступен и в Edge Runtime (здесь), и в обычном
// Node.js-роуте app/api/admin/login/route.ts, который выдаёт cookie
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

// Имя cookie с "сессией" администратора. Значение — не сам пароль, а
// SHA-256 хеш от него (см. sha256Hex ниже и app/api/admin/login/route.ts) —
// так, даже если кто-то увидит содержимое cookie, сам пароль оттуда
// не восстановить
const AUTH_COOKIE_NAME = 'autokontur_admin_session';

const LOGIN_PATH = '/admin/login';

// Публичные API-роуты — ими пользуется САМА ВИТРИНА (покупатель), а
// не адмінка, поэтому пароль для них не нужен. Проверяются и путь, и
// HTTP-метод: например, GET /api/announcements — публичный (витрина
// показывает баннер), а POST /api/announcements — уже административный
// (создание баннера), хоть адрес и общий
const PUBLIC_API_ROUTES: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/api\/products$/ },
  { method: 'GET', pattern: /^\/api\/products\/images$/ },
  { method: 'GET', pattern: /^\/api\/products\/car-options$/ },
  { method: 'GET', pattern: /^\/api\/products\/cross-lookup$/ },
  { method: 'POST', pattern: /^\/api\/orders\/create$/ },
  { method: 'GET', pattern: /^\/api\/customer\/orders$/ },
  { method: 'GET', pattern: /^\/api\/customer\/orders\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/vin-requests$/ },
  { method: 'GET', pattern: /^\/api\/announcements$/ },
  { method: 'GET', pattern: /^\/api\/site-settings$/ },
  { method: 'GET', pattern: /^\/api\/nova-poshta\/cities$/ },
  { method: 'GET', pattern: /^\/api\/nova-poshta\/warehouses$/ },
  { method: 'POST', pattern: /^\/api\/admin\/login$/ },
  { method: 'POST', pattern: /^\/api\/admin\/logout$/ },
];

function isPublicApiRoute(pathname: string, method: string): boolean {
  return PUBLIC_API_ROUTES.some((rule) => rule.method === method && rule.pattern.test(pathname));
}

// Роут фонової черги пошуку фото (app/api/cron/fetch-product-images) —
// його викликає Vercel Cron за розкладом (див. vercel.json), а не
// браузер адміна, тому в нього НЕМАЄ cookie-сесії. Він НЕ додається в
// PUBLIC_API_ROUTES вище (це відкрило б його для будь-кого без жодного
// секрету) — замість цього тут окремо перевіряється секрет із
// заголовка Authorization: Bearer, який Vercel Cron підставляє сам
// (див. .env.example, CRON_SECRET)
const CRON_ROUTE_PATTERN = /^\/api\/cron\//;

function isAuthorizedCronRoute(request: NextRequest): boolean {
  if (!CRON_ROUTE_PATTERN.test(request.nextUrl.pathname)) return false;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;

  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  // Пароль вообще не настроен на сервере — намеренно считаем ЭТО
  // "не авторизован", а не "пропустить всех": лучше временно
  // недоступная админка, чем случайно незапароленная. См. подробности
  // в комментарии в конце файла про переменную ADMIN_PASSWORD
  if (!adminPassword) return false;

  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!cookieValue) return false;

  const expectedValue = await sha256Hex(adminPassword);
  return cookieValue === expectedValue;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = await isAuthenticated(request);

  // ---- страницы /admin/* ----
  if (pathname.startsWith('/admin')) {
    if (pathname === LOGIN_PATH) {
      // Уже авторизован — со страницы входа сразу отправляем в саму панель
      if (authed) return NextResponse.redirect(new URL('/admin', request.url));
      return NextResponse.next();
    }

    if (!authed) {
      const loginUrl = new URL(LOGIN_PATH, request.url);
      // ?next=... — куда вернуть админа после успешного входа (ту же
      // страницу, которую он изначально открыл, а не всегда на /admin)
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
  }

  // ---- API-роуты ----
  if (pathname.startsWith('/api/')) {
    if (isPublicApiRoute(pathname, request.method) || isAuthorizedCronRoute(request)) {
      return NextResponse.next();
    }
    if (!authed) {
      return NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

// matcher — middleware выполняется ТОЛЬКО для запросов, подпадающих
// под эти пути (а не для каждого запроса на сайте вообще — витрина,
// статика и т.п. остаются без лишней проверки на каждый чих)
export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
};

// ------------------------------------------------------------
// ПЕРЕМЕННАЯ ОКРУЖЕНИЯ ADMIN_PASSWORD
// ------------------------------------------------------------
// Пароль администратора хранится ТОЛЬКО в переменной окружения
// ADMIN_PASSWORD (см. .env.local для разработки и Vercel → Settings →
// Environment Variables для продакшена) — не в базе данных и не в
// коде. Сменить пароль — значит просто поменять значение этой
// переменной и передеплоить (на Vercel: Deployments → ⋯ → Redeploy,
// как и после любой другой смены переменной окружения)
