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
// Экран состоит из двух независимых блоков:
//   1. Ручное управление ОДНИМ товаром: найти его в каталоге (поиск
//      по артикулу/бренду/названию — тот же GET /api/products?search=...,
//      что и на экране "Товары"), посмотреть/добавить/удалить его
//      кросс-номера (GET/POST/DELETE /api/products/[id]/cross-references)
//   2. Массовая загрузка кросс-номеров из Excel сразу для МНОГИХ
//      товаров одного поставщика (POST /api/products/cross-references/
//      import) — свой артикул ищется СРЕДИ ТОВАРОВ ВЫБРАННОГО
//      ПОСТАВЩИКА (та самая "сверка с базой поставщиков"): если
//      артикул не нашёлся, строка попадает в список "не найдено" в
//      результате, а не ломает всю загрузку
//
// Как только кросс-номер добавлен (вручную или массово), покупатель
// на витрине сможет найти этот товар, введя в поиск ЛЮБОЙ из его
// кросс-номеров — это уже работает на бэкенде (см.
// app/api/products/route.ts), здесь только управление самими номерами.
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

// Для выпадающего списка "поставщик, чей каталог сверяем" — остальные
// поля поставщика здесь не используются
interface SupplierOption {
  id: string;
  name: string;
}

// Результат массовой загрузки — то, что отдаёт POST
// /api/products/cross-references/import
interface ImportResult {
  addedCount: number;
  updatedCount: number;
  notFoundCount: number;
  notFoundArticles: string[];
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

  // ---- массовая загрузка кросс-номеров из Excel ----
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [importSupplierId, setImportSupplierId] = useState('');
  const [importArticleColumn, setImportArticleColumn] = useState('');
  const [importCrossColumn, setImportCrossColumn] = useState('');
  const [importBrandColumn, setImportBrandColumn] = useState('');
  const [importStartRow, setImportStartRow] = useState('1');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Список поставщиков для выпадающего списка — загружается один раз
  useEffect(() => {
    fetch('/api/suppliers')
      .then((response) => response.json())
      .then((data) => {
        if (data.suppliers) setSuppliers(data.suppliers as SupplierOption[]);
      })
      .catch(() => {
        // Список поставщиков необязателен для остальной работы экрана —
        // просто форма загрузки временно окажется без выбора поставщика
      });
  }, []);

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

  // МАССОВАЯ ЗАГРУЗКА — POST /api/products/cross-references/import
  const handleImportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setImportError(null);
    setImportResult(null);

    if (!importSupplierId) {
      setImportError('Выберите поставщика — по его каталогу будут сверяться артикулы из файла');
      return;
    }
    if (!importArticleColumn.trim() || !importCrossColumn.trim()) {
      setImportError('Укажите обе обязательные колонки — "Наш артикул" и "Кросс-номер"');
      return;
    }
    if (!importFile) {
      setImportError('Выберите файл Excel');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('supplierId', importSupplierId);
      formData.append(
        'mapping',
        JSON.stringify({
          article: importArticleColumn,
          crossArticle: importCrossColumn,
          crossBrand: importBrandColumn || undefined,
          startRow: parseInt(importStartRow, 10) || 1,
        })
      );

      // Заголовок Content-Type специально НЕ проставляем вручную —
      // браузер сам добавит "multipart/form-data" с правильным boundary
      const response = await fetch('/api/products/cross-references/import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось обработать файл');
      }

      setImportResult({
        addedCount: data.addedCount,
        updatedCount: data.updatedCount,
        notFoundCount: data.notFoundCount,
        notFoundArticles: data.notFoundArticles,
      });
      setImportFile(null);

      // Если сейчас открыт товар из того же поставщика — обновляем
      // его список кросс-номеров, чтобы не пришлось перевыбирать товар
      // руками, если только что загруженный файл его тоже затронул
      if (selectedProduct) {
        fetchCrossReferences(selectedProduct.id);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Ошибка сети при загрузке файла');
    } finally {
      setImporting(false);
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

      {/* ==================== МАССОВАЯ ЗАГРУЗКА ИЗ EXCEL ==================== */}
      <div
        className="p-4 rounded-lg mb-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <p className="text-sm font-semibold mb-1">Загрузка кроссов из Excel</p>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
          Файл с колонками "Наш артикул" и "Кросс-номер" (бренд кросса — необязательно). Наш
          артикул сверяется с каталогом ВЫБРАННОГО ниже поставщика — строки, которых там не
          нашлось, попадут в список "не найдено" после загрузки, а не сломают всю загрузку.
        </p>

        <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
              Поставщик, по каталогу которого сверяем артикулы
            </label>
            <select
              value={importSupplierId}
              onChange={(e) => setImportSupplierId(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            >
              <option value="">— выберите поставщика —</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Колонка: наш артикул
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. A"
                value={importArticleColumn}
                onChange={(e) => setImportArticleColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Колонка: кросс-номер
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. B"
                value={importCrossColumn}
                onChange={(e) => setImportCrossColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Колонка: бренд кросса
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. C"
                value={importBrandColumn}
                onChange={(e) => setImportBrandColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Строка начала данных
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={importStartRow}
                onChange={(e) => setImportStartRow(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md font-mono text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="text-xs"
              style={{ color: 'var(--ink-muted)' }}
            />
            <button
              type="submit"
              disabled={importing}
              className="px-4 py-2.5 rounded-md text-sm font-medium disabled:opacity-50 shrink-0"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {importing ? 'Загрузка...' : 'Загрузить прайс кроссов'}
            </button>
          </div>
        </form>

        {importError && (
          <p className="text-xs mt-3" style={{ color: 'var(--bad)' }}>
            {importError}
          </p>
        )}

        {importResult && (
          <div
            className="text-xs mt-3 p-3 rounded-md flex flex-col gap-1.5"
            style={{ background: 'var(--surface-2)' }}
          >
            <p>
              Добавлено: <strong style={{ color: 'var(--good)' }}>{importResult.addedCount}</strong>
              {'  ·  '}Обновлено: <strong>{importResult.updatedCount}</strong>
              {'  ·  '}Не найдено у поставщика:{' '}
              <strong style={{ color: importResult.notFoundCount > 0 ? 'var(--warn)' : undefined }}>
                {importResult.notFoundCount}
              </strong>
            </p>
            {importResult.notFoundArticles.length > 0 && (
              <p style={{ color: 'var(--ink-muted)' }}>
                Не найдены артикулы: <span className="font-mono">{importResult.notFoundArticles.join(', ')}</span>
                {importResult.notFoundCount > importResult.notFoundArticles.length ? ' …' : ''}
              </p>
            )}
          </div>
        )}
      </div>

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
