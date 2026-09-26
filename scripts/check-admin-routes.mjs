// ============================================================
// Проверка: ни один НЕпубличный API-роут не отвечает без входа админа.
//
// Находит все app/api/**/route.ts, для каждого экспортированного метода
// (GET/POST/PUT/PATCH/DELETE), кроме публичных роутов витрины, делает
// запрос на локальный сервер и ждёт 401 или 403. В конце — таблица
// "роут, метод, код, ✅/❌". Код выхода 1, если есть хоть один ❌.
//
// Два режима:
//   node scripts/check-admin-routes.mjs
//     — запросы БЕЗ cookie (проверяет middleware.ts);
//   node --env-file=.env.local scripts/check-admin-routes.mjs --forged-cookie
//     — с cookie, ПРАВИЛЬНО подписанной SESSION_SECRET, но для сессии,
//       которой нет в базе. middleware такую пропускает (подпись верна),
//       поэтому режим проверяет второй слой — requireAdmin() в самих роутах.
//
// Адрес сервера — переменная CHECK_BASE_URL (по умолчанию
// http://localhost:3059, туда запускаем `npx next start -p 3059`).
// Тела запросов пустые ({}), подставленные id несуществующие — даже
// если какой-то роут окажется открытым, он ничего не найдёт и не изменит.
// ============================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = process.env.CHECK_BASE_URL || 'http://localhost:3059';
const FORGED = process.argv.includes('--forged-cookie');

// Публичные роуты витрины — тот же список, что PUBLIC_API_ROUTES в
// middleware.ts, кроме /api/customer/*: без сессии покупателя они должны
// отвечать 401 (при выключенном кабинете — 403). Их скрипт не проверяет
const PUBLIC_ROUTES = [
  ['GET', /^\/api\/products$/],
  ['GET', /^\/api\/products\/images$/],
  ['GET', /^\/api\/products\/car-options$/],
  ['GET', /^\/api\/products\/cross-lookup$/],
  ['POST', /^\/api\/orders\/create$/],
  ['POST', /^\/api\/vin-requests$/],
  ['GET', /^\/api\/announcements$/],
  ['GET', /^\/api\/site-settings$/],
  ['GET', /^\/api\/nova-poshta\/cities$/],
  ['GET', /^\/api\/nova-poshta\/warehouses$/],
  // Вход в кабинет по коду — публичные (у них свои лимиты)
  ['POST', /^\/api\/customer\/auth\/(request-code|verify-code|logout)$/],
  ['GET', /^\/api\/customer\/auth\/me$/],
  ['POST', /^\/api\/admin\/login$/],
  ['POST', /^\/api\/admin\/logout$/],
  // Защищён собственным секретом Telegram, а не входом админа
  ['POST', /^\/api\/telegram\/webhook$/],
];

// Значения для динамических сегментов [id], [docType] и т.п.
const SEGMENT_VALUES = {
  docType: 'invoice',
  phone: '0500000000',
};
const DEFAULT_SEGMENT = '00000000-0000-0000-0000-000000000000';

function findRouteFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return findRouteFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

// Cookie в формате lib/adminSessionToken.ts: v1.<токен>.<срок>.<HMAC>
function buildForgedCookie() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    console.error('Для --forged-cookie нужен SESSION_SECRET (запустите с --env-file=.env.local).');
    process.exit(2);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = `v1.${token}.${expires}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `autokontur_admin_session=${payload}.${signature}`;
}

const cookie = FORGED ? buildForgedCookie() : null;
const rows = [];

for (const file of findRouteFiles(path.join('app', 'api')).sort()) {
  const routeDir = path.dirname(file).split(path.sep).join('/').replace(/^app/, '');
  const url = routeDir.replace(/\[([^\]]+)\]/g, (_, name) => SEGMENT_VALUES[name] || DEFAULT_SEGMENT);
  const source = fs.readFileSync(file, 'utf8');
  const methods = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map((m) => m[1]);

  for (const method of methods) {
    if (PUBLIC_ROUTES.some(([m, re]) => m === method && re.test(url))) continue;

    let status;
    try {
      const response = await fetch(BASE_URL + url, {
        method,
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
      });
      status = response.status;
    } catch (error) {
      status = `ошибка: ${error.message}`;
    }
    rows.push({ route: routeDir, method, status, ok: status === 401 || status === 403 });
  }
}

const routeWidth = Math.max(5, ...rows.map((r) => r.route.length));
console.log(`Режим: ${FORGED ? 'поддельная подписанная cookie (несуществующая сессия)' : 'без cookie'} · ${BASE_URL}\n`);
console.log(`${'Роут'.padEnd(routeWidth)}  Метод   Код  `);
console.log(`${'-'.repeat(routeWidth)}  ------  ---- --`);
for (const r of rows) {
  console.log(`${r.route.padEnd(routeWidth)}  ${r.method.padEnd(6)}  ${String(r.status).padEnd(4)} ${r.ok ? '✅' : '❌'}`);
}
const failed = rows.filter((r) => !r.ok);
console.log(`\nПроверено: ${rows.length}, ✅ ${rows.length - failed.length}, ❌ ${failed.length}`);
process.exit(failed.length > 0 ? 1 : 0);
