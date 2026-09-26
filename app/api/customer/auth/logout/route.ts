// ============================================================
// POST /api/customer/auth/logout — выход из Особистого кабінету:
// сессия удаляется из базы (customer_sessions) и cookie стирается.
// После этого та же cookie (даже скопированная) ничего не открывает
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { CUSTOMER_SESSION_COOKIE, customerSessionCookieOptions, deleteCustomerSession } from '@/lib/customerAuth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await deleteCustomerSession(request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value);
  } catch (error) {
    // База недоступна — cookie всё равно стираем ниже
    console.error('Ошибка при удалении сессии покупателя:', error);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(CUSTOMER_SESSION_COOKIE, '', customerSessionCookieOptions(0));
  response.cookies.set('customer_phone', '', { path: '/', maxAge: 0 });
  return response;
}
