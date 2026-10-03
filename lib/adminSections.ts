// ============================================================
// Какие страницы админки закрыты для менеджеров (роль manager).
// Менеджеру доступны заказы, клиенты, склад, отгрузка, товары, кроссы,
// словарь поиска, скидки клиентам и VIN-запросы. Закрыто: закупки,
// касса, поставщики, отчёты, аналитика, настройки, управление менеджерами.
//
// Используется в app/admin/layout.tsx (переадресация, если менеджер
// открыл адрес вручную). Сами API закрытых разделов проверяют роль
// отдельно (requireOwnerAccess в lib/adminAuth.ts) — этот список
// только про страницы. Скрытие пунктов в меню — флаг ownerOnly в
// components/AdminLayout.tsx; при добавлении нового закрытого раздела
// его нужно указать в обоих местах.
// ============================================================

// Страница, на которую уводим менеджера, если он открыл закрытый раздел
export const MANAGER_HOME_PATH = '/admin/orders';

const OWNER_ONLY_PREFIXES = [
  '/admin/procurement',
  '/admin/analytics',
  '/admin/treasury',
  '/admin/reports',
  '/admin/settings',
  '/admin/managers',
  '/admin/suppliers',
];

export function isOwnerOnlyAdminPath(pathname: string): boolean {
  // "/admin" — корневая страница "Поставщики"
  if (pathname === '/admin' || pathname === '/admin/') return true;
  return OWNER_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'));
}
