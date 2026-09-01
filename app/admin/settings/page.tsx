// Страница "Настройки" — здесь живут общесистемные настройки,
// не привязанные к конкретному поставщику: глобальные курсы валют
// (components/GlobalRatesWidget.tsx), контакты/часы работы витрины
// (components/ContactSettingsForm.tsx) и объявления на сайте
// (components/AnnouncementsManager.tsx)
import AdminLayout from '@/components/AdminLayout';
import GlobalRatesWidget from '@/components/GlobalRatesWidget';
import ContactSettingsForm from '@/components/ContactSettingsForm';
import AnnouncementsManager from '@/components/AnnouncementsManager';
import SitePagesManager from '@/components/SitePagesManager';

export default function SettingsPage() {
  return (
    <AdminLayout active="settings">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Настройки
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Настройки</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Общесистемные настройки, не привязанные к конкретному поставщику.
        </p>
      </header>

      <GlobalRatesWidget />
      <ContactSettingsForm />
      <SitePagesManager />
      <AnnouncementsManager />
    </AdminLayout>
  );
}
