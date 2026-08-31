// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/logout
//
// Просто стирает cookie-сессию администратора (см. app/api/admin/
// login/route.ts) — после этого middleware.ts снова отправит на
// /admin/login при следующем заходе в панель
// ============================================================

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const AUTH_COOKIE_NAME = 'autokontur_admin_session';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
