'use client';

// ============================================================
// Экран "Кроссы" — управление кросс-номерами товаров.
//
// "Кросс-номер" в автозапчастях — это артикул той же самой (или
// взаимозаменяемой) детали у ДРУГОГО производителя или по оригинальной
// (OEM) нумерации автопроизводителя: одна и та же тормозная колодка
// физически продаётся Bosch под артикулом "0 986 424 815", TRW — под
// "GDB1330", а сам автопроизводитель называет её ещё иначе. Это всё
// "кроссы" друг для друга — взаимозаменяемые детали.
//
// Экран устроен в два шага:
//   1. Найти нужный товар в НАШЕМ каталоге (поиск по артикулу/бренду/
//      названию — тот же GET /api/products?search=..., что и на
//      экране "Товары")
//   2. Для выбранного товара — посмотреть/добавить/удалить его
//      кросс-номера (GET/POST/DELETE /api/products/[id]/cross-references)
//
// Как только кросс-номер добавлен, покупатель на витрине сможет найти
// этот товар, введя в поиск ЛЮБОЙ из его кросс-номеров — это уже
// работает на бэкенде (см. app/api/products/route.ts), здесь только
// управление самим списком номеров.
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface ProductSearchResult {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  supplierName: string;
}

interface SelectedProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
}

interface CrossReference {
  id: string;
  crossArticle: string;
  crossBrand: string | null;
  createdAt: string;
}

const SEARCH_DEBOUNCE_MS = 350;

export default function CrossReferencesScreen() {
  // ---- поиск товара ----
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ---- выбранный товар и его кросс-номера ----
  const [selectedProduct, setSelectedProduct] = useState<SelectedProduct | null>(null);
  const [crossReferences, setCrossReferences] = useState<CrossReference[]>([]);
  const [loadingCrosses, setLoadingCrosses] = useState(false);
  const [crossesError, setCrossesError] = useState<string | null>(null);

  // ---- форма добавления кросс-номера ----
  const [newCrossArticle, setNewCrossArticle] = useState('');
  const [newCrossBrand, setNewCrossBrand] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ЗАДЕРЖКА ПОИСКА (debounce) — не долбим сервер на каждую букву
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ПОИСК ТОВАРА — GET /api/products?search=...
  useEffect(() => {
    if (!debouncedSearch) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);

    const params = new URLSearchParams({ search: debouncedSearch, pageSize: '15' });
    fetch(`/api/products?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || 'Не удалось выполнить поиск');
        setSearchResults(data.products as ProductSearchResult[]);
      })
      .catch((error) => {
        setSearchError(error instanceof Error ? error.message : 'Ошибка сети при поиске');
        setSearchResults([]);
      })
      .finally(() => setSearching(false));
  }, [debouncedSearch]);

  // ЗАГРУЗКА КРОСС-НОМЕРОВ выбранного товара
  const fetchCrossReferences = (productId: string) => {
    setLoadingCrosses(true);
    setCrossesError(null);
    fetch(`/api/products/${productId}/cross-references`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || 'Не удалось получить кросс-номера');
        setCrossReferences(data.crossReferences as CrossReference[]);
      })
      .catch((error) => {
        setCrossesError(error instanceof Error ? error.message : 'Ошибка сети при загрузке кросс-номеров');
        setCrossReferences([]);
      })
      .finally(() => setLoadingCrosses(false));
  };

  const selectProduct = (product: ProductSearchResult) => {
    setSelectedProduct(product);
    setAddError(null);
    setNewCrossArticle('');
    setNewCrossBrand('');
    fetchCrossReferences(product.id);
  };

  const clearSelection = () => {
    setSelectedProduct(null);
    setCrossReferences([]);
    setCrossesError(null);
  };

  // ДОБАВЛЕНИЕ КРОСС-НОМЕРА — POST /api/products/[id]/cross-references
  const handleAddCross = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !newCrossArticle.trim()) return;

    setAdding(true);
    setAddError(null);
    try {
      const response = await fetch(`/api/products/${selectedProduct.id}/cross-references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crossArticle: newCrossArticle,
          crossBrand: newCrossBrand.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось добавить кросс-номер');
      }
      setCrossReferences((prev) => [...prev, data.crossReference as CrossReference]);
      setNewCrossArticle('');
      setNewCrossBrand('');
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Ошибка сети при добавлении кросс-номера');
    } finally {
      setAdding(false);
    }
  };

  // УДАЛЕНИЕ КРОСС-НОМЕРА — DELETE /api/products/[id]/cross-references/[crossId]
  const handleDeleteCross = async (crossId: string) => {
    if (!selectedProduct) return;
    const confirmed = window.confirm('Удалить этот кросс-номер?');
    if (!confirmed) return;

    setDeletingId(crossId);
    try {
      const response = await fetch(`/api/products/${selectedProduct.id}/cross-references/${crossId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось удалить кросс-номер');
      }
      setCrossReferences((prev) => prev.filter((cross) => cross.id !== crossId));
    } catch (error) {
      setCrossesError(error instanceof Error ? error.message : 'Ошибка сети при удалении кросс-номера');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AdminLayout active="crossReferences">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Кроссы
      </p>
      <h1 className="text-2xl font-semibold mb-1">Кроссы</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Кросс-номер — артикул той же детали у другого производителя или оригинальный (OEM)
        номер автозавода. Привяжите такие номера к товару — и покупатель найдёт его на витрине,
        даже если ищет по чужому артикулу.
      </p>

      {/* ==================== ПОИСК ТОВАРА ==================== */}
      <div
        className="p-4 rounded-lg mb-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
          Найти товар по артикулу, бренду или названию
        </label>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="напр. AB-123, Bosch или Втулка стабілізатора"
          className="w-full px-3 py-2.5 text-sm rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
        />

        {searchError && (
          <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
            {searchError}
          </p>
        )}

        {!searchError && debouncedSearch && (
          <div className="mt-3 flex flex-col gap-1 max-h-72 overflow-y-auto">
            {searching && (
              <p className="text-xs px-1" style={{ color: 'var(--ink-faint)' }}>
                Ищем...
              </p>
            )}
            {!searching && searchResults.length === 0 && (
              <p className="text-xs px-1" style={{ color: 'var(--ink-faint)' }}>
                Ничего не найдено.
              </p>
            )}
            {!searching &&
              searchResults.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="text-left px-3 py-2 rounded-md text-sm"
                  style={{
                    background: selectedProduct?.id === product.id ? 'var(--accent-soft)' : 'var(--surface-2)',
                  }}
                >
                  <span className="font-mono" style={{ color: 'var(--ink-muted)' }}>
                    {product.article}
                    {product.brand ? ` · ${product.brand}` : ''}
                  </span>
                  <span className="ml-2">{product.name || 'Без названия'}</span>
                  <span className="ml-2 text-xs" style={{ color: 'var(--ink-faint)' }}>
                    ({product.supplierName})
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>

      {/* ==================== ВЫБРАННЫЙ ТОВАР И ЕГО КРОССЫ ==================== */}
      {selectedProduct && (
        <div
          className="p-5 rounded-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
                Товар
              </p>
              <p className="text-sm font-medium">
                <span className="font-mono" style={{ color: 'var(--ink-muted)' }}>
                  {selectedProduct.article}
                  {selectedProduct.brand ? ` · ${selectedProduct.brand}` : ''}
                </span>
                <span className="ml-2">{selectedProduct.name || 'Без названия'}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs underline shrink-0"
              style={{ color: 'var(--ink-muted)' }}
            >
              Выбрать другой товар
            </button>
          </div>

          {crossesError && (
            <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
              {crossesError}
            </p>
          )}

          {loadingCrosses ? (
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Загрузка...
            </p>
          ) : (
            <>
              {crossReferences.length === 0 ? (
                <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
                  У этого товара пока нет кросс-номеров.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 mb-4">
                  {crossReferences.map((cross) => (
                    <div
                      key={cross.id}
                      className="flex items-center justify-between px-3 py-2 rounded-md text-sm"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <span>
                        <span className="font-mono">{cross.crossArticle}</span>
                        {cross.crossBrand && (
                          <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                            {cross.crossBrand}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={deletingId === cross.id}
                        onClick={() => handleDeleteCross(cross.id)}
                        className="text-xs px-2 py-1 rounded-md disabled:opacity-50"
                        style={{ color: 'var(--bad)', border: '1px solid var(--bad)' }}
                      >
                        {deletingId === cross.id ? 'Удаление...' : 'Удалить'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- форма добавления ---- */}
              <form onSubmit={handleAddCross} className="flex flex-col sm:flex-row gap-2.5 pt-4" style={{ borderTop: '1px dashed var(--line)' }}>
                <input
                  type="text"
                  value={newCrossArticle}
                  onChange={(e) => setNewCrossArticle(e.target.value)}
                  placeholder="Кросс-номер, напр. 0986424815"
                  className="flex-1 px-3 py-2.5 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                />
                <input
                  type="text"
                  value={newCrossBrand}
                  onChange={(e) => setNewCrossBrand(e.target.value)}
                  placeholder="Бренд (необязательно), напр. Bosch"
                  className="flex-1 px-3 py-2.5 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                />
                <button
                  type="submit"
                  disabled={adding || !newCrossArticle.trim()}
                  className="px-4 py-2.5 rounded-md text-sm font-medium disabled:opacity-50 shrink-0"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {adding ? 'Добавление...' : 'Добавить'}
                </button>
              </form>
              {addError && (
                <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                  {addError}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </AdminLayout>
  );
}
