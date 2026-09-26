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
// node:crypto (как в остальных API-роутах проекта). Поэтому здесь
// проверяется только ПОДПИСЬ cookie сессии (Web Crypto, см.
// lib/adminSessionToken.ts), а наличие сессии в базе — requireAdmin()
// в каждом админском роуте (lib/adminAuth.ts)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { CUSTOMER_CABINET_DISABLED_MESSAGE, isCustomerCabinetEnabled } from '@/lib/customerCabinet';
import { ADMIN_SESSION_COOKIE, verifySessionCookie } from '@/lib/adminSessionToken';

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
  // Вход в кабинет по коду из Telegram (lib/customerAuth.ts). Остальные
  // /api/customer/* ниже пропускаются middleware, но сами требуют сессию
  // (requireCustomer) — без входа отвечают 401
  { method: 'POST', pattern: /^\/api\/customer\/auth\/(request-code|verify-code|logout)$/ },
  { method: 'GET', pattern: /^\/api\/customer\/auth\/me$/ },
  { method: 'GET', pattern: /^\/api\/customer\/orders$/ },
  { method: 'GET', pattern: /^\/api\/customer\/orders\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/customer\/pricing-rule$/ },
  { method: 'GET', pattern: /^\/api\/customer\/vehicles$/ },
  { method: 'POST', pattern: /^\/api\/customer\/vehicles$/ },
  { method: 'PATCH', pattern: /^\/api\/customer\/vehicles\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/customer\/vehicles\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/customer\/favorites$/ },
  { method: 'POST', pattern: /^\/api\/customer\/favorites$/ },
  { method: 'DELETE', pattern: /^\/api\/customer\/favorites\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/customer\/addresses$/ },
  { method: 'POST', pattern: /^\/api\/customer\/addresses$/ },
  { method: 'PATCH', pattern: /^\/api\/customer\/addresses\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/customer\/addresses\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/customer\/telegram-link$/ },
  { method: 'POST', pattern: /^\/api\/vin-requests$/ },
  { method: 'GET', pattern: /^\/api\/announcements$/ },
  { method: 'GET', pattern: /^\/api\/site-settings$/ },
  { method: 'GET', pattern: /^\/api\/nova-poshta\/cities$/ },
  { method: 'GET', pattern: /^\/api\/nova-poshta\/warehouses$/ },
  { method: 'POST', pattern: /^\/api\/admin\/login$/ },
  { method: 'POST', pattern: /^\/api\/admin\/logout$/ },
  // Захищений НЕ паролем адмінки, а власним секретом у заголовку
  // X-Telegram-Bot-Api-Secret-Token (перевіряється всередині самого
  // роута) — Telegram не має пароля адмінки й не зможе його передати
  { method: 'POST', pattern: /^\/api\/telegram\/webhook$/ },
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

// Первый слой проверки сессии админа: cookie подписана нашим секретом
// и не истекла (lib/adminSessionToken.ts). В базу middleware ходить не
// может (Edge Runtime, без pg) — существование сессии в admin_sessions
// проверяет requireAdmin() (lib/adminAuth.ts) в самих роутах и в
// app/admin/layout.tsx. Старые cookie формата sha256(пароля) здесь не
// проходят — после деплоя нужно войти заново
async function isAuthenticated(request: NextRequest): Promise<boolean> {
  return (await verifySessionCookie(request.cookies.get(ADMIN_SESSION_COOKIE)?.value)) !== null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = await isAuthenticated(request);

  // ---- страницы /admin/* ----
  if (pathname.startsWith('/admin')) {
    // Передаём путь в app/admin/layout.tsx (layout сам его не знает) —
    // там вторая проверка сессии уже по базе. Заголовок выставляет
    // только middleware: присланный клиентом перезаписывается
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-admin-pathname', pathname);

    // Страницу входа пускаем всегда. Раньше залогиненного отсюда сразу
    // перекидывало в /admin — но теперь подпись cookie может быть верной,
    // а сессия уже удалена из базы (после "Вийти"), и получалась бы
    // бесконечная переадресация login ↔ admin
    if (pathname === LOGIN_PATH) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (!authed) {
      const loginUrl = new URL(LOGIN_PATH, request.url);
      // ?next=... — куда вернуть админа после успешного входа (ту же
      // страницу, которую он изначально открыл, а не всегда на /admin)
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // ---- API-роуты ----
  if (pathname.startsWith('/api/')) {
    // Кабинет покупателя временно выключен (lib/customerCabinet.ts) —
    // ВСЕ /api/customer/* (любой метод) отвечают 403 одной проверкой,
    // раньше белого списка ниже. Включается CUSTOMER_CABINET_ENABLED=true
    if (/^\/api\/customer(\/|$)/.test(pathname) && !isCustomerCabinetEnabled()) {
      return NextResponse.json({ error: CUSTOMER_CABINET_DISABLED_MESSAGE }, { status: 403 });
    }

    // Cron-роуты — ТОЛЬКО по Authorization: Bearer CRON_SECRET. Cookie
    // админа сюда не пускает (иначе ссылка на чужом сайте могла бы
    // запустить тяжёлую пересборку от имени залогиненного админа)
    if (CRON_ROUTE_PATTERN.test(pathname)) {
      return isAuthorizedCronRoute(request)
        ? NextResponse.next()
        : NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
    }

    if (isPublicApiRoute(pathname, request.method)) {
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
