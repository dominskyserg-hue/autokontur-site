// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/users — управление пользователями админки.
// Только для владельца (роль owner).
//
//   GET  — список всех пользователей (без паролей)
//   POST — создать пользователя { login, name, password, role }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/adminAuth';
import {
  PASSWORD_MIN_LENGTH,
  createAdminUser,
  isValidLogin,
  listAdminUsers,
  normalizeLogin,
  type AdminRole,
} from '@/lib/adminUsers';

export const runtime = 'nodejs';

export async function GET() {
  const { denied } = await requireOwner();
  if (denied) return denied;

  try {
    return NextResponse.json({ success: true, users: await listAdminUsers() });
  } catch (error) {
    console.error('Ошибка при получении пользователей админки:', error);
    return NextResponse.json({ error: 'Не вдалося отримати список користувачів.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { denied } = await requireOwner();
  if (denied) return denied;

  let body: { login?: unknown; name?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const login = normalizeLogin(body.login);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role: AdminRole = body.role === 'owner' ? 'owner' : 'manager';

  if (!isValidLogin(login)) {
    return NextResponse.json(
      { error: 'Логін: 3–32 символи, лише латиниця, цифри, крапка, дефіс і підкреслення.' },
      { status: 400 }
    );
  }
  if (!name) {
    return NextResponse.json({ error: "Вкажіть ім'я користувача." }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: `Пароль має бути не коротший за ${PASSWORD_MIN_LENGTH} символів.` }, { status: 400 });
  }

  try {
    const user = await createAdminUser({ login, name, password, role });
    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (error) {
    // 23505 — нарушение UNIQUE: такой логин уже есть
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Користувач з таким логіном уже існує.' }, { status: 409 });
    }
    console.error('Ошибка при создании пользователя админки:', error);
    return NextResponse.json({ error: 'Не вдалося створити користувача.' }, { status: 500 });
  }
}
