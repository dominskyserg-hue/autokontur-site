// ============================================================
// Проверка "это запрос от залогиненного администратора?" для
// ПУБЛИЧНЫХ API-роутов (тех, что в PUBLIC_API_ROUTES в middleware.ts).
//
// Middleware пропускает такие роуты без пароля — ими пользуется
// витрина. Но некоторые из них (например, GET /api/products) вызывает
// ещё и адмінка, которой нужны служебные поля (закупочная цена
// costPrice), недопустимые для покупателя. Эта функция позволяет роуту
// самому решить, отдавать ли такие поля: да — только если в запросе
// есть валидная cookie-сессия администратора.
//
// Логика ровно та же, что и isAuthenticated() в middleware.ts, и
// значение cookie выдаётся в app/api/admin/login/route.ts: SHA-256
// хеш от ADMIN_PASSWORD. Если пароль на сервере не настроен — считаем
// "не админ" (безопасный вариант по умолчанию)
// ============================================================

import type { NextRequest } from 'next/server';

const AUTH_COOKIE_NAME = 'autokontur_admin_session';

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;

  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!cookieValue) return false;

  return cookieValue === (await sha256Hex(adminPassword));
}
