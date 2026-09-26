// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/logout
//
// Кнопка "Вийти": удаляет сессию из базы (admin_sessions) и стирает
// cookie. После этого та же cookie — даже если её кто-то скопировал —
// больше ничего не открывает: requireAdmin() в роутах не найдёт сессию
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/adminSessionToken';
import { deleteAdminSessionByCookie } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await deleteAdminSessionByCookie(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  } catch (error) {
    // Даже если база недоступна — cookie ниже всё равно стираем
    console.error('Ошибка при удалении сессии администратора:', error);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
