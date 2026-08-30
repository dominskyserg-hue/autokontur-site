'use client';

// ============================================================
// Экран "Кроссы" — управление кросс-номерами товаров.
//
// "Кросс-номер" в автозапчастях — это артикул той же самой (или
// взаимозаменяемой) детали у ДРУГОГО производителя или по оригинальной
// (OEM) нумерации автопроизводителя: одна и та же тормозная колодка
// физически продаётся Bosch под артикулом "0 986 424 815", TRW — под
// "GDB1330", а сам автопроизводитель называет её ещё иначе. Это всё
// "кроссы" друг для друга — взаимозаменяемые детали, образующие ОДНУ
// группу взаимозаменяемости (см. подробности в schema.sql, раздел 11).
//
// Экран состоит из трёх независимых блоков:
//   1. Массовая загрузка кросс-номеров из Excel сразу для МНОГИХ
//      товаров одного поставщика (POST /api/products/cross-references/
//      import) — свой артикул ищется СРЕДИ ТОВАРОВ ВЫБРАННОГО
//      ПОСТАВЩИКА (та самая "сверка с базой поставщиков")
//   2. Ручное управление ОДНИМ товаром: найти его в каталоге, посмотреть
//      участников его группы взаимозаменяемости, добавить/удалить связь
//      (GET/POST/DELETE /api/products/[id]/cross-references)
//   3. Конфликты — связи, которые попытались бы объединить ДВЕ уже
//      РАЗНЫЕ группы (например, поставщик А сказал "X это Y", а
//      поставщик Б — "X это Z", хотя Y и Z уже в разных группах).
//      Такие связи не сливаются автоматически, а ждут решения
//      администратора здесь (GET/POST /api/products/cross-references/
//      conflicts)
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
type PartType = 'oem' | 'aftermarket';
type Source = 'official' | 'user-reported' | 'algorithmic';

const PART_TYPE_LABELS: Record<PartType, string> = {
  oem: 'OEM (оригинал)',
  aftermarket: 'Aftermarket (аналог)',
};

const SOURCE_LABELS: Record<Source, string> = {
  official: 'Официальный источник',
  'user-reported': 'Добавлено вручную',
  algorithmic: 'Алгоритмическое сопоставление',
};

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

interface CrossMember {
  memberId: string;
  brand: string;
  partNumber: string;
  partNumberRaw: string | null;
  partType: PartType;
  source: Source;
  productId: string | null;
  inStockRetailPrice: number | null;
  inStockQuantity: number | null;
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
  alreadyLinkedCount: number;
  conflictCount: number;
  notFoundCount: number;
  notFoundArticles: string[];
}

interface Conflict {
  id: string;
  partABrand: string;
  partANumber: string;
  partBBrand: string;
  partBNumber: string;
  source: Source;
  sourceFile: string | null;
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
  const [crossMembers, setCrossMembers] = useState<CrossMember[]>([]);
  const [loadingCrosses, setLoadingCrosses] = useState(false);
  const [crossesError, setCrossesError] = useState<string | null>(null);

  // ---- форма добавления кросс-номера ----
  const [newCrossArticle, setNewCrossArticle] = useState('');
  const [newCrossBrand, setNewCrossBrand] = useState('');
  const [newCrossPartType, setNewCrossPartType] = useState<PartType>('aftermarket');
  const [newCrossSource, setNewCrossSource] = useState<Source>('user-reported');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---- массовая загрузка кросс-номеров из Excel ----
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [importSupplierId, setImportSupplierId] = useState('');
  const [importArticleColumn, setImportArticleColumn] = useState('');
  const [importCrossBrandColumn, setImportCrossBrandColumn] = useState('');
  const [importCrossArticleColumn, setImportCrossArticleColumn] = useState('');
  const [importPartTypeColumn, setImportPartTypeColumn] = useState('');
  const [importSource, setImportSource] = useState<Source>('official');
  const [importStartRow, setImportStartRow] = useState('1');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // ---- конфликты ----
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loadingConflicts, setLoadingConflicts] = useState(false);
  const [conflictsError, setConflictsError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchConflicts = () => {
    setLoadingConflicts(true);
    setConflictsError(null);
    fetch('/api/products/cross-references/conflicts?status=pending')
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || 'Не удалось получить конфликты');
        setConflicts(data.conflicts as Conflict[]);
      })
      .catch((error) => {
        setConflictsError(error instanceof Error ? error.message : 'Ошибка сети при загрузке конфликтов');
      })
      .finally(() => setLoadingConflicts(false));
  };

  // Список поставщиков (для загрузки) и список конфликтов —
  // загружаются один раз при открытии экрана
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

    fetchConflicts();
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

  // ЗАГРУЗКА УЧАСТНИКОВ ГРУППЫ выбранного товара
  const fetchCrossMembers = (productId: string) => {
    setLoadingCrosses(true);
    setCrossesError(null);
    fetch(`/api/products/${productId}/cross-references`)
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || 'Не удалось получить кросс-номера');
        setCrossMembers(data.crossReferences as CrossMember[]);
      })
      .catch((error) => {
        setCrossesError(error instanceof Error ? error.message : 'Ошибка сети при загрузке кросс-номеров');
        setCrossMembers([]);
      })
      .finally(() => setLoadingCrosses(false));
  };

  const selectProduct = (product: ProductSearchResult) => {
    setSelectedProduct(product);
    setAddError(null);
    setNewCrossArticle('');
    setNewCrossBrand('');
    setNewCrossPartType('aftermarket');
    setNewCrossSource('user-reported');
    fetchCrossMembers(product.id);
  };

  const clearSelection = () => {
    setSelectedProduct(null);
    setCrossMembers([]);
    setCrossesError(null);
  };

  // ДОБАВЛЕНИЕ КРОСС-НОМЕРА — POST /api/products/[id]/cross-references
  const handleAddCross = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProduct || !newCrossArticle.trim() || !newCrossBrand.trim()) return;

    setAdding(true);
    setAddError(null);
    try {
      const response = await fetch(`/api/products/${selectedProduct.id}/cross-references`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crossArticle: newCrossArticle,
          crossBrand: newCrossBrand.trim(),
          crossPartType: newCrossPartType,
          source: newCrossSource,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось добавить кросс-номер');
      }
      setNewCrossArticle('');
      setNewCrossBrand('');
      fetchCrossMembers(selectedProduct.id);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Ошибка сети при добавлении кросс-номера');
      // Конфликт (409) мог создать запись в списке конфликтов — обновим его
      fetchConflicts();
    } finally {
      setAdding(false);
    }
  };

  // УДАЛЕНИЕ УЧАСТНИКА ГРУППЫ — DELETE /api/products/[id]/cross-references/[memberId]
  const handleDeleteCross = async (memberId: string) => {
    if (!selectedProduct) return;
    const confirmed = window.confirm('Убрать эту деталь из группы взаимозаменяемости?');
    if (!confirmed) return;

    setDeletingId(memberId);
    try {
      const response = await fetch(`/api/products/${selectedProduct.id}/cross-references/${memberId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось удалить кросс-номер');
      }
      setCrossMembers((prev) => prev.filter((cross) => cross.memberId !== memberId));
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
    if (!importArticleColumn.trim() || !importCrossBrandColumn.trim() || !importCrossArticleColumn.trim()) {
      setImportError('Укажите колонки "Наш артикул", "Кросс-бренд" и "Кросс-номер"');
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
      formData.append('source', importSource);
      formData.append(
        'mapping',
        JSON.stringify({
          article: importArticleColumn,
          crossBrand: importCrossBrandColumn,
          crossArticle: importCrossArticleColumn,
          partType: importPartTypeColumn || undefined,
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
        alreadyLinkedCount: data.alreadyLinkedCount,
        conflictCount: data.conflictCount,
        notFoundCount: data.notFoundCount,
        notFoundArticles: data.notFoundArticles,
      });
      setImportFile(null);

      if (data.conflictCount > 0) fetchConflicts();

      // Если сейчас открыт товар из того же поставщика — обновляем
      // его список кросс-номеров, чтобы не пришлось перевыбирать товар
      // руками, если только что загруженный файл его тоже затронул
      if (selectedProduct) {
        fetchCrossMembers(selectedProduct.id);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Ошибка сети при загрузке файла');
    } finally {
      setImporting(false);
    }
  };

  // РАЗРЕШЕНИЕ КОНФЛИКТА — POST /api/products/cross-references/conflicts/[id]
  const handleResolveConflict = async (conflictId: string, action: 'merge' | 'reject') => {
    setResolvingId(conflictId);
    try {
      const response = await fetch(`/api/products/cross-references/conflicts/${conflictId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось разрешить конфликт');
      }
      setConflicts((prev) => prev.filter((conflict) => conflict.id !== conflictId));
      if (selectedProduct) fetchCrossMembers(selectedProduct.id);
    } catch (error) {
      setConflictsError(error instanceof Error ? error.message : 'Ошибка сети при разрешении конфликта');
    } finally {
      setResolvingId(null);
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
          Файл с колонками "Наш артикул", "Кросс-бренд" и "Кросс-номер" (колонка "Тип" —
          необязательно: oem или aftermarket, по умолчанию aftermarket). Наш артикул сверяется
          с каталогом ВЫБРАННОГО ниже поставщика — строки, которых там не нашлось, попадут в
          список "не найдено" после загрузки, а не сломают всю загрузку.
        </p>

        <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Источник данных (для всего файла)
              </label>
              <select
                value={importSource}
                onChange={(e) => setImportSource(e.target.value as Source)}
                className="w-full px-3 py-2.5 text-sm rounded-md"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              >
                {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
                  <option key={source} value={source}>
                    {SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Наш артикул
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
                Кросс-бренд
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. B"
                value={importCrossBrandColumn}
                onChange={(e) => setImportCrossBrandColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Кросс-номер
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. C"
                value={importCrossArticleColumn}
                onChange={(e) => setImportCrossArticleColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Тип (необязательно)
              </label>
              <input
                type="text"
                maxLength={3}
                placeholder="напр. D"
                value={importPartTypeColumn}
                onChange={(e) => setImportPartTypeColumn(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Строка начала
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
              {'  ·  '}Уже было: <strong>{importResult.alreadyLinkedCount}</strong>
              {'  ·  '}Конфликтов:{' '}
              <strong style={{ color: importResult.conflictCount > 0 ? 'var(--warn)' : undefined }}>
                {importResult.conflictCount}
              </strong>
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
            {importResult.conflictCount > 0 && (
              <p style={{ color: 'var(--warn)' }}>
                Часть строк не удалось связать автоматически — они ждут решения ниже, на вкладке
                «Конфликты».
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

      {/* ==================== ВЫБРАННЫЙ ТОВАР И ЕГО ГРУППА ==================== */}
      {selectedProduct && (
        <div
          className="p-5 rounded-lg mb-6"
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
              {!selectedProduct.brand && (
                <p className="text-xs mt-1" style={{ color: 'var(--warn)' }}>
                  У товара не указан бренд — без него нельзя добавить кросс-номер (нужна пара
                  "бренд + артикул", чтобы однозначно определить деталь).
                </p>
              )}
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
              {crossMembers.length === 0 ? (
                <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
                  У этого товара пока нет группы взаимозаменяемости.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 mb-4">
                  {crossMembers.map((cross) => (
                    <div
                      key={cross.memberId}
                      className="flex items-center justify-between px-3 py-2 rounded-md text-sm"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <div>
                        <span className="font-mono">{cross.partNumberRaw || cross.partNumber}</span>
                        <span className="ml-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                          {cross.brand}
                        </span>
                        <span
                          className="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                          style={{
                            background: cross.partType === 'oem' ? 'var(--accent-soft)' : 'var(--surface)',
                            color: cross.partType === 'oem' ? 'var(--accent)' : 'var(--ink-faint)',
                          }}
                        >
                          {PART_TYPE_LABELS[cross.partType]}
                        </span>
                        <span className="ml-1.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                          {SOURCE_LABELS[cross.source]}
                        </span>
                        {cross.productId && (
                          <span className="ml-1.5 text-[10px]" style={{ color: 'var(--good)' }}>
                            {cross.inStockQuantity && cross.inStockQuantity > 0
                              ? `в наличии: ${cross.inStockQuantity}`
                              : 'нет в наличии'}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={deletingId === cross.memberId}
                        onClick={() => handleDeleteCross(cross.memberId)}
                        className="text-xs px-2 py-1 rounded-md disabled:opacity-50 shrink-0"
                        style={{ color: 'var(--bad)', border: '1px solid var(--bad)' }}
                      >
                        {deletingId === cross.memberId ? 'Удаление...' : 'Удалить'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ---- форма добавления ---- */}
              {selectedProduct.brand && (
                <form
                  onSubmit={handleAddCross}
                  className="flex flex-col gap-2.5 pt-4"
                  style={{ borderTop: '1px dashed var(--line)' }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={newCrossBrand}
                      onChange={(e) => setNewCrossBrand(e.target.value)}
                      placeholder="Бренд кросса, напр. Bosch"
                      className="px-3 py-2.5 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    />
                    <input
                      type="text"
                      value={newCrossArticle}
                      onChange={(e) => setNewCrossArticle(e.target.value)}
                      placeholder="Кросс-номер, напр. 0986424815"
                      className="px-3 py-2.5 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <select
                      value={newCrossPartType}
                      onChange={(e) => setNewCrossPartType(e.target.value as PartType)}
                      className="px-3 py-2.5 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    >
                      {(Object.keys(PART_TYPE_LABELS) as PartType[]).map((type) => (
                        <option key={type} value={type}>
                          {PART_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={newCrossSource}
                      onChange={(e) => setNewCrossSource(e.target.value as Source)}
                      className="px-3 py-2.5 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    >
                      {(Object.keys(SOURCE_LABELS) as Source[]).map((source) => (
                        <option key={source} value={source}>
                          {SOURCE_LABELS[source]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={adding || !newCrossArticle.trim() || !newCrossBrand.trim()}
                      className="px-4 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                    >
                      {adding ? 'Добавление...' : 'Добавить'}
                    </button>
                  </div>
                </form>
              )}
              {addError && (
                <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                  {addError}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ==================== КОНФЛИКТЫ ==================== */}
      <div
        className="p-4 rounded-lg"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <p className="text-sm font-semibold mb-1">
          Конфликты{conflicts.length > 0 ? ` (${conflicts.length})` : ''}
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
          Связи, которые попытались бы объединить ДВЕ уже разные группы взаимозаменяемости —
          например, если один файл поставщика говорит "X это Y", а другой — "X это Z", хотя Y и
          Z уже привязаны каждый к своей детали. Автоматически такие связи не принимаются —
          нужно решить вручную: это действительно одна и та же деталь, или ошибка в файле.
        </p>

        {conflictsError && (
          <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
            {conflictsError}
          </p>
        )}

        {loadingConflicts && (
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loadingConflicts && conflicts.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Нерешённых конфликтов нет.
          </p>
        )}

        {!loadingConflicts && conflicts.length > 0 && (
          <div className="flex flex-col gap-2">
            {conflicts.map((conflict) => (
              <div key={conflict.id} className="p-3 rounded-md text-sm" style={{ background: 'var(--surface-2)' }}>
                <p className="mb-2">
                  <span className="font-mono">{conflict.partANumber}</span>
                  <span className="text-xs ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                    ({conflict.partABrand})
                  </span>
                  <span className="mx-2" style={{ color: 'var(--ink-faint)' }}>
                    ⇄
                  </span>
                  <span className="font-mono">{conflict.partBNumber}</span>
                  <span className="text-xs ml-1.5" style={{ color: 'var(--ink-muted)' }}>
                    ({conflict.partBBrand})
                  </span>
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--ink-faint)' }}>
                  Источник: {SOURCE_LABELS[conflict.source]}
                  {conflict.sourceFile ? ` · файл: ${conflict.sourceFile}` : ''}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={resolvingId === conflict.id}
                    onClick={() => handleResolveConflict(conflict.id, 'merge')}
                    className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50"
                    style={{ background: 'var(--good)', color: '#0B0F17' }}
                  >
                    Это одна деталь — объединить
                  </button>
                  <button
                    type="button"
                    disabled={resolvingId === conflict.id}
                    onClick={() => handleResolveConflict(conflict.id, 'reject')}
                    className="text-xs px-3 py-1.5 rounded-md disabled:opacity-50"
                    style={{ color: 'var(--bad)', border: '1px solid var(--bad)' }}
                  >
                    Ошибка — отклонить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
