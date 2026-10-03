// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: PATCH /api/admin/users/[id] — изменить пользователя.
// Только для владельца.
//
// В теле можно передать любые из полей: name, role, isActive, password.
// После отключения, смены роли или пароля все сессии этого пользователя
// закрываются — старые входы перестают работать (при смене СВОЕГО
// пароля текущая сессия остаётся).
//
// Нельзя отключить или понизить самого себя — иначе легко остаться
// без владельца.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireOwner } from '@/lib/adminAuth';
import { PASSWORD_MIN_LENGTH, deleteUserSessions, updateAdminUser, type AdminRole } from '@/lib/adminUsers';

export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner();
  if (auth.denied !== null) return auth.denied;
  const admin = auth.admin;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Некоректний id користувача.' }, { status: 400 });
  }

  let body: { name?: unknown; role?: unknown; isActive?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const changes: { name?: string; role?: AdminRole; isActive?: boolean; password?: string } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: "Ім'я не може бути порожнім." }, { status: 400 });
    changes.name = name;
  }
  if (body.role !== undefined) {
    if (body.role !== 'owner' && body.role !== 'manager') {
      return NextResponse.json({ error: 'Невідома роль.' }, { status: 400 });
    }
    changes.role = body.role;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive має бути true або false.' }, { status: 400 });
    }
    changes.isActive = body.isActive;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < PASSWORD_MIN_LENGTH) {
      return NextResponse.json({ error: `Пароль має бути не коротший за ${PASSWORD_MIN_LENGTH} символів.` }, { status: 400 });
    }
    changes.password = body.password;
  }

  const isSelf = admin.id === id;
  if (isSelf && (changes.isActive === false || changes.role === 'manager')) {
    return NextResponse.json({ error: 'Не можна відключити або понизити самого себе.' }, { status: 400 });
  }

  try {
    const user = await updateAdminUser(id, changes);
    if (!user) {
      return NextResponse.json({ error: 'Користувача не знайдено або нема що змінювати.' }, { status: 404 });
    }

    if (changes.isActive === false || changes.role !== undefined || changes.password !== undefined) {
      await deleteUserSessions(id, isSelf ? admin.sessionId : undefined);
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error('Ошибка при изменении пользователя админки:', error);
    return NextResponse.json({ error: 'Не вдалося зберегти зміни.' }, { status: 500 });
  }
}
