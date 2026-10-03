// Страница "Менеджеры" — только для владельца: создание сотрудников
// с отдельным логином и паролем, отключение и сброс пароля
// (components/ManagersManager.tsx). Менеджера, открывшего адрес
// напрямую, возвращаем к заказам; сами API (/api/admin/users) тоже
// проверяют роль и без этого ответят 403.
import { redirect } from 'next/navigation';
import AdminLayout from '@/components/AdminLayout';
import ManagersManager from '@/components/ManagersManager';
import { getCurrentAdmin } from '@/lib/adminAuth';

export default async function ManagersPage() {
  const admin = await getCurrentAdmin();
  if (!admin || admin.role !== 'owner') redirect('/admin/orders');

  return (
    <AdminLayout active="managers">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Менеджеры
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Менеджеры</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          У каждого сотрудника свой логин и пароль — так видно, кто какой заказ ведёт.
        </p>
      </header>

      <ManagersManager />
    </AdminLayout>
  );
}
