// ============================================================
// Cookie-сессия администратора — формат и ПОДПИСЬ токена.
//
// Файл без зависимостей от Node.js (только Web Crypto API), потому что
// его импортирует middleware.ts, а middleware в Next.js 15 работает в
// Edge Runtime: там НЕЛЬЗЯ ходить в Postgres (драйвер pg требует TCP и
// модулей Node). Поэтому защита двухслойная:
//
//   1. middleware.ts — быстрая проверка без базы: cookie подписана нашим
//      SESSION_SECRET (HMAC-SHA256) и срок в ней не истёк. Подделать
//      такую cookie без секрета нельзя.
//   2. lib/adminAuth.ts (requireAdmin) — в КАЖДОМ админском роуте и в
//      layout админки: sha256(токена) должен быть в таблице
//      admin_sessions и не истечь. Именно это даёт настоящий выход:
//      "Вийти" удаляет строку из базы — и та же cookie (даже
//      скопированная) больше ничего не открывает.
//
// Формат cookie: v1.<токен base64url>.<срок, unix-секунды>.<подпись>
// В базе хранится только sha256(токена) — сам токен есть лишь у браузера.
// ============================================================

export const ADMIN_SESSION_COOKIE = 'autokontur_admin_session';

// Срок жизни сессии — 7 дней (и cookie, и строки в admin_sessions)
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const TOKEN_VERSION = 'v1';

// Минимальная длина SESSION_SECRET — короче такой ключ проще подобрать
export const SESSION_SECRET_MIN_LENGTH = 32;

// Временный ключ ТОЛЬКО для разработки (npm run dev), если SESSION_SECRET
// не задан. Случайный на каждый запуск процесса — сессии живут до
// перезапуска dev-сервера, и этого достаточно для локальной работы
let devFallbackSecret: string | null = null;

// Ключ подписи — только SESSION_SECRET (отдельная случайная строка в
// переменных окружения Vercel, не пароль админа). Не задан или короче
// 32 символов:
//   - production — null: вход отвечает 500 "SESSION_SECRET не
//     налаштовано", любая cookie недействительна, в логах — ошибка;
//   - development — временный случайный ключ с предупреждением
function getSigningSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= SESSION_SECRET_MIN_LENGTH) return secret;

  if (process.env.NODE_ENV === 'production') {
    console.error(
      `SESSION_SECRET не задан или короче ${SESSION_SECRET_MIN_LENGTH} символов — вход в админку невозможен. ` +
        'Добавьте SESSION_SECRET в Vercel → Settings → Environment Variables и сделайте Redeploy.'
    );
    return null;
  }

  if (!devFallbackSecret) {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    devFallbackSecret = bytesToBase64Url(bytes);
    console.warn('SESSION_SECRET не задан — для разработки используется временный ключ (сессии сбросятся при перезапуске).');
  }
  return devFallbackSecret;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacBase64Url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToBase64Url(new Uint8Array(signature));
}

// Сравнение строк за постоянное время (Edge Runtime не имеет
// crypto.timingSafeEqual из Node) — чтобы по времени ответа нельзя было
// подбирать подпись посимвольно
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Новый случайный токен (32 байта) — вызывается при успешном входе
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

// sha256(токена) в hex — именно это лежит в admin_sessions.token_hash
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Собирает подписанное значение cookie из токена и срока
export async function signSessionCookie(token: string, expiresAtUnix: number): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) return null;
  const payload = `${TOKEN_VERSION}.${token}.${expiresAtUnix}`;
  return `${payload}.${await hmacBase64Url(secret, payload)}`;
}

// Проверяет подпись и срок. Возвращает сам токен (для поиска в базе)
// или null. Старые cookie (просто sha256 пароля) сюда не проходят —
// после деплоя все прежние сессии перестают работать
export async function verifySessionCookie(cookieValue: string | undefined | null): Promise<string | null> {
  if (!cookieValue) return null;
  const secret = getSigningSecret();
  if (!secret) return null;

  const parts = cookieValue.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  const [version, token, expiresRaw, signature] = parts;

  const expiresAtUnix = Number(expiresRaw);
  if (!Number.isFinite(expiresAtUnix) || expiresAtUnix * 1000 <= Date.now()) return null;

  const expected = await hmacBase64Url(secret, `${version}.${token}.${expiresRaw}`);
  if (!constantTimeEqual(expected, signature)) return null;

  return token;
}
