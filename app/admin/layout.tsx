// Отдельные мета-теги для раздела админ-панели (/admin/*) — на
// вкладке браузера видно "Админка", а не название витрины магазина.
// Next.js сам объединяет этот layout с корневым app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Админ-панель — AUTOKONTUR',
};

export default function AdminSectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
