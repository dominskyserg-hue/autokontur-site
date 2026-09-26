// Отдельные мета-теги для раздела админ-панели (/admin/*) — на
// вкладке браузера видно "Админка", а не название витрины магазина.
// Next.js сам объединяет этот layout с корневым app/layout.tsx
//
// Вторая проверка входа (кроме middleware.ts): сессия должна быть в
// базе (admin_sessions). middleware проверяет только подпись cookie —
// а здесь ловим, например, cookie после "Вийти" или истёкшую в базе
// сессию: такой посетитель уходит на страницу входа. Путь страницы
// layout сам не знает — его передаёт middleware в заголовке x-admin-pathname
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdminSession } from '@/lib/adminAuth';

export const metadata: Metadata = {
  title: 'Админ-панель — AUTOKONTUR',
};

const LOGIN_PATH = '/admin/login';

export default async function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-admin-pathname') || '';

  if (pathname !== LOGIN_PATH && !(await isAdminSession())) {
    redirect(`${LOGIN_PATH}?next=${encodeURIComponent(pathname || '/admin')}`);
  }

  return children;
}
