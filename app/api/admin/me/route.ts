// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/me
//
// Кто сейчас вошёл в админку: имя, логин и роль. Читает боковое меню
// (components/AdminLayout.tsx) — показывает имя внизу и прячет разделы,
// недоступные менеджеру.
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  }
  return NextResponse.json({
    success: true,
    user: { id: admin.id, login: admin.login, name: admin.name, role: admin.role },
  });
}
