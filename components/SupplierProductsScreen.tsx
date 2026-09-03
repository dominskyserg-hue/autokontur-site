'use client';

// ============================================================
// Экран "Поставщик" — детальная страница ОДНОГО поставщика: его
// контакты сверху и полный каталог ЕГО товаров снизу, с поиском,
// пагинацией, редактированием цены/остатка и удалением позиций.
//
// В отличие от общего экрана "Товары" (components/ProductsScreen.tsx),
// который показывает вообще ВСЕ товары всех поставщиков разом с
// фильтром "выбрать поставщика", здесь поставщик уже зафиксирован
// адресом страницы (/admin/suppliers/[id]) — отдельного выбора нет.
//
// Использует эндпоинты:
//   GET    /api/suppliers            — только чтобы найти карточку
//                                       ЭТОГО поставщика по id
//                                       (отдельного GET /api/suppliers/[id]
//                                       в проекте нет — список и так
//                                       короткий, искать в нём дёшево)
//   GET    /api/products?supplierId=...&search=...&page=...
//   PATCH  /api/products/[id]        — изменить цену/остаток
//   DELETE /api/products/[id]        — удалить товар насовсем
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  isActive: boolean;
  mapping: { markup: number } | null;
}

interface Product {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  costPrice: number;
  retailPrice: number;
  stock: number;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 350;

// Копейки не показываем — только целые гривны, округлённые ВВЕРХ
function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function SupplierProductsScreen({ supplierId }: { supplierId: string }) {
  // ---- карточка поставщика ----
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loadingSupplier, setLoadingSupplier] = useState(true);
  const [supplierError, setSupplierError] = useState<string | null>(null);

  // ---- поиск и пагинация товаров ЭТОГО поставщика ----
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  // ---- сами товары ----
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- редактирование одного товара (цена + остаток) ----
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editRetailPrice, setEditRetailPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ---- удаление товара — id, который сейчас удаляется (для спиннера
  // именно у той строки, которую нажали, а не у всей таблицы) ----
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // КАРТОЧКА ПОСТАВЩИКА (ищем по id в общем списке — см. комментарий
  // в шапке файла, зачем именно так, а не отдельным эндпоинтом)
  // ------------------------------------------------------------
  const fetchSupplier = useCallback(async () => {
    setLoadingSupplier(true);
    setSupplierError(null);
    try {
      const response = await fetch('/api/suppliers');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить поставщика');
      }
      const found = (data.suppliers as Supplier[]).find((s) => s.id === supplierId);
      if (!found) {
        throw new Error('Поставщик с таким id не найден');
      }
      setSupplier(found);
    } catch (error) {
      setSupplierError(error instanceof Error ? error.message : 'Ошибка сети при загрузке поставщика');
    } finally {
      setLoadingSupplier(false);
    }
  }, [supplierId]);

  useEffect(() => {
    fetchSupplier();
  }, [fetchSupplier]);

  // ------------------------------------------------------------
  // ЗАДЕРЖКА ПОИСКА (debounce)
  // ------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // ------------------------------------------------------------
  // ЗАГРУЗКА ТОВАРОВ ЭТОГО ПОСТАВЩИКА — GET /api/products?supplierId=...
  // ------------------------------------------------------------
  const fetchProducts = useCallback(async () => {
    setLoadingProducts(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('supplierId', supplierId);
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      if (debouncedSearch) params.set('search', debouncedSearch);

      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить товары поставщика');
      }
      setProducts(data.products as Product[]);
      setPagination(data.pagination as Pagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке товаров');
    } finally {
      setLoadingProducts(false);
    }
  }, [supplierId, page, debouncedSearch]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ------------------------------------------------------------
  // РЕДАКТИРОВАНИЕ ТОВАРА — PATCH /api/products/[id]
  // ------------------------------------------------------------
  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setEditRetailPrice(String(product.retailPrice));
    setEditStock(String(product.stock));
    setEditError(null);
  };

  const closeEditModal = () => {
    setEditingProduct(null);
    setEditError(null);
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct) return;

    const retailPrice = parseFloat(editRetailPrice.replace(',', '.'));
    const stock = parseInt(editStock, 10);

    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setEditError('Розничная цена должна быть числом не меньше нуля');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setEditError('Остаток должен быть целым числом не меньше нуля');
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retailPrice, stock }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить изменения');
      }
      setEditingProduct(null);
      await fetchProducts();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Ошибка сети при сохранении');
    } finally {
      setEditSaving(false);
    }
  };

  // ------------------------------------------------------------
  // УДАЛЕНИЕ ТОВАРА — DELETE /api/products/[id]
  // ------------------------------------------------------------
  const handleDelete = async (product: Product) => {
    // window.confirm — простое, но надёжное подтверждение перед
    // необратимым действием: удаление товара нельзя отменить
    const confirmed = window.confirm(
      `Удалить товар «${product.name || product.article}» (${product.article}) насовсем?`
    );
    if (!confirmed) return;

    setDeletingId(product.id);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось удалить товар');
      }
      await fetchProducts();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Ошибка сети при удалении товара');
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <AdminLayout active="suppliers">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Поставщики / {supplier?.name || '...'}
        </p>
        <div className="flex items-center gap-3 mb-1.5">
          <h1 className="text-2xl font-semibold">{loadingSupplier ? 'Загрузка...' : supplier?.name || 'Поставщик'}</h1>
          {supplier && (
            <span
              className="text-[11px] px-2 py-1 rounded-full font-medium"
              style={{
                background: supplier.isActive ? 'var(--good-soft)' : 'var(--warn-soft)',
                color: supplier.isActive ? 'var(--good)' : 'var(--warn)',
              }}
            >
              {supplier.isActive ? 'Активен' : 'На паузе'}
            </span>
          )}
        </div>
        <a href="/admin" className="text-xs underline" style={{ color: 'var(--ink-muted)' }}>
          ← Ко всем поставщикам
        </a>
      </header>

      {supplierError && (
        <p className="text-xs mb-5" style={{ color: 'var(--bad)' }}>
          {supplierError}
        </p>
      )}

      {/* ==================== КАРТОЧКА КОНТАКТОВ ==================== */}
      {supplier && (
        <div
          className="p-4 rounded-lg mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        >
          <div>
            <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>Контакт</p>
            <p>{supplier.contactName || '—'}</p>
          </div>
          <div>
            <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>Телефон / Email</p>
            <p className="font-mono text-xs">{[supplier.phone, supplier.email].filter(Boolean).join(' / ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>Валюта</p>
            <p>{supplier.currency}</p>
          </div>
          <div>
            <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>Наценка</p>
            <p>{supplier.mapping ? `${supplier.mapping.markup}%` : 'не настроена'}</p>
          </div>
        </div>
      )}

      {/* ==================== ПОИСК ПО ТОВАРАМ ПОСТАВЩИКА ==================== */}
      <div
        className="p-4 rounded-lg mb-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
          Поиск по артикулу или бренду среди товаров этого поставщика
        </label>
        <input
          type="text"
          className="w-full sm:w-96 px-3 py-2 text-sm rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          placeholder="напр. AB-123 или Bosch"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {deleteError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {deleteError}
        </p>
      )}

      {/* ==================== ТАБЛИЦА ТОВАРОВ ==================== */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loadError && (
          <p className="text-xs p-4" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchProducts} className="underline">
              Повторить
            </button>
          </p>
        )}

        {!loadError && loadingProducts && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loadError && !loadingProducts && products.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            {debouncedSearch
              ? 'Ничего не найдено по этому запросу.'
              : 'У этого поставщика пока нет ни одного товара — загрузите его прайс-лист на экране "Поставщики".'}
          </p>
        )}

        {!loadError && !loadingProducts && products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Артикул', 'Бренд', 'Название', 'Цена поставщика', 'Розничная цена', 'Остаток', ''].map(
                    (heading, index, arr) => {
                      const isLastColumn = index === arr.length - 1;
                      return (
                        <th
                          key={heading}
                          className="text-left px-4 py-2.5 text-xs font-medium whitespace-nowrap"
                          style={{
                            color: 'var(--ink-muted)',
                            ...(isLastColumn
                              ? { position: 'sticky', right: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)' }
                              : {}),
                          }}
                        >
                          {heading}
                        </th>
                      );
                    }
                  )}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{product.article}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {product.brand || '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate" title={product.name || undefined}>
                      {product.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(product.costPrice)}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(product.retailPrice)}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{product.stock}</td>
                    <td
                      className="px-4 py-2.5 whitespace-nowrap text-right"
                      style={{ position: 'sticky', right: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)' }}
                    >
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(product)}
                          className="text-xs px-3 py-1.5 rounded-md"
                          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)', background: 'var(--surface-2)' }}
                        >
                          Редактировать
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === product.id}
                          onClick={() => handleDelete(product)}
                          className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50"
                          style={{ border: '1px solid var(--bad)', color: 'var(--bad)', background: 'var(--surface-2)' }}
                        >
                          {deletingId === product.id ? '...' : 'Удалить'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== ПАГИНАЦИЯ ==================== */}
      {pagination && pagination.totalCount > 0 && (
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            ← Назад
          </button>
          <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Страница {pagination.page} из {totalPages} · Всего товаров: {pagination.totalCount}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Вперёд →
          </button>
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ==================== */}
      {editingProduct && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={closeEditModal}
        >
          <div
            className="w-full max-w-sm p-5 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-1">Редактировать товар</h3>
            <p className="text-xs mb-4 font-mono" style={{ color: 'var(--ink-faint)' }}>
              {editingProduct.article} — {editingProduct.name || 'без названия'}
            </p>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Розничная цена
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  value={editRetailPrice}
                  onChange={(e) => setEditRetailPrice(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Остаток
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                />
              </div>

              {editError && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  {editError}
                </p>
              )}

              <div className="flex gap-2 mt-1.5">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {editSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-md text-sm"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
