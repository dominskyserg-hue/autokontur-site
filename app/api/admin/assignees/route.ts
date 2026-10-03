// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/assignees
//
// Список активных сотрудников для выпадающего списка "Передать
// менеджеру" в окне заказа (components/OrderManagerAssign.tsx). В
// отличие от /api/admin/users, доступен и менеджерам — но отдаёт
// только id, имя и роль, без логинов и дат входа.
// ============================================================

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { listAdminUsers } from '@/lib/adminUsers';

export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const users = (await listAdminUsers())
      .filter((user) => user.isActive)
      .map((user) => ({ id: user.id, name: user.name, role: user.role }));
    return NextResponse.json({ success: true, users });
  } catch (error) {
    console.error('Ошибка при получении списка сотрудников:', error);
    return NextResponse.json({ error: 'Не вдалося отримати список співробітників.' }, { status: 500 });
  }
}
