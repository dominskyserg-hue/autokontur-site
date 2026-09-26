// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/nova-poshta/sender-options
//
// Читает (не создаёт и не меняет ничего в Новой Почте) список
// контактных лиц и адресов забора посылки, зарегистрированных за
// нашим отправителем — для выпадающих списков в
// components/NovaPoshtaSettingsForm.tsx, где админ один раз выбирает,
// какие из них использовать при создании ТТН
// ============================================================

import { NextResponse } from 'next/server';
import { loadSenderOptions } from '@/lib/novaPoshta/sender';
import { NovaPoshtaApiError } from '@/lib/novaPoshta/api';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const options = await loadSenderOptions();
    return NextResponse.json({ success: true, ...options });
  } catch (error) {
    console.error('Ошибка при получении данных отправителя из Новой Почты:', error);
    const message = error instanceof NovaPoshtaApiError || error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить данные отправителя: ' + message }, { status: 502 });
  }
}
