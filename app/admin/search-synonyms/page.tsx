// Страница "Словник пошуку" — управление многоязычным словарём
// синонимов для поиска по ключевым словам (см.
// components/SearchSynonymsManager.tsx)
import AdminLayout from '@/components/AdminLayout';
import SearchSynonymsManager from '@/components/SearchSynonymsManager';

export default function SearchSynonymsPage() {
  return (
    <AdminLayout active="searchSynonyms">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Словник пошуку
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Словник пошуку</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Многоязычные (укр/рос/англ) синонимы для поиска покупателей по ключевым словам из названия товара.
        </p>
      </header>

      <SearchSynonymsManager />
    </AdminLayout>
  );
}
