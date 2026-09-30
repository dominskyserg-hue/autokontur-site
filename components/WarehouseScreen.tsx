'use client';

// ============================================================
// Экран "Склад" (/admin/warehouse) — что физически лежит у нас на
// полке, история движения каждой детали и ручные операции:
// исправление остатка после пересчёта и списание брака.
//
// Остаток = сумма всех движений stock_movements по товару (приходы,
// продажи, возвраты, ручные операции) — подробнее см.
// app/api/admin/warehouse/route.ts.
//
// Использует эндпоинты:
//   GET  /api/admin/warehouse                 — список остатков
//   GET  /api/admin/warehouse/[productId]     — история товара
//   POST /api/admin/warehouse/[productId]     — корректировка / списание
//   GET  /api/products?search=...             — поиск товара в каталоге,
//                                                чтобы оприходовать деталь,
//                                                которой на складе ещё не было
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';
import { formatDateTime, formatMoney, formatOrderNumber } from '@/lib/orderUi';

interface WarehouseItem {
  productId: string;
  article: string;
  brand: string | null;
  name: string | null;
  supplierName: string | null;
  costPrice: number;
  retailPrice: number;
  balance: number;
  lastMovementAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface Movement {
  id: string;
  quantityChange: number;
  reason: string;
  comment: string | null;
  createdAt: string;
  orderId: string | null;
  orderNumber: number | null;
  invoiceNumber: string | null;
}

interface ProductInfo {
  productId: string;
  article: string;
  brand: string | null;
  name: string | null;
  supplierName: string | null;
}

// Результат поиска по каталогу (/api/products) — берём только нужные поля
interface CatalogProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  supplierName?: string;
}

// Причины движения — как они называются в базе и как их показываем
const REASON_LABELS: Record<string, string> = {
  sale: 'Продажа',
  customer_return: 'Возврат от клиента',
  supplier_receipt: 'Приход от поставщика',
  supplier_return: 'Возврат поставщику',
  adjustment: 'Корректировка',
  defect_writeoff: 'Списание брака',
};

const SEARCH_DEBOUNCE_MS = 350;

const inputStyle = { border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' };

// ============================================================
// ОКНО ТОВАРА: остаток, форма операции, история движения
// ============================================================
function ProductPanel({
  productId,
  onClose,
  onChanged,
}: {
  productId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма ручной операции ----
  // direction нужен только для "Корректировки": плюс или минус.
  // Списание брака всегда уменьшает остаток
  const [reason, setReason] = useState<'adjustment' | 'defect_writeoff'>('adjustment');
  const [direction, setDirection] = useState<'plus' | 'minus'>('minus');
  const [quantity, setQuantity] = useState('1');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/warehouse/${productId}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить историю товара');
      setProduct(data.product as ProductInfo);
      setBalance(data.balance as number);
      setMovements(data.movements as Movement[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);

    const amount = parseInt(quantity, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      setSaveError('Укажите количество — целое число больше нуля');
      return;
    }
    if (!comment.trim()) {
      setSaveError('Напишите причину — через месяц без неё никто не вспомнит, что случилось');
      return;
    }

    const isMinus = reason === 'defect_writeoff' || direction === 'minus';

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/warehouse/${productId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantityChange: isMinus ? -amount : amount,
          reason,
          comment,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить операцию');

      setQuantity('1');
      setComment('');
      await fetchHistory();
      onChanged();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg p-5 md:p-6"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        // stopPropagation — клик внутри окна не должен его закрывать
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="font-mono text-xs" style={{ color: 'var(--ink-faint)' }}>
              {product ? `${product.brand || ''} ${product.article}` : '...'}
            </p>
            <h2 className="text-lg font-semibold">{product?.name || 'Товар'}</h2>
            {product?.supplierName && (
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Поставщик: {product.supplierName}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Закрыть
          </button>
        </div>

        {loadError && (
          <p className="text-sm p-3 rounded-lg mb-4" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
            {loadError}
          </p>
        )}

        <div className="p-4 rounded-lg mb-5" style={{ background: 'var(--surface-2)' }}>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Сейчас на складе
          </p>
          <p className="text-3xl font-semibold">{loading ? '…' : `${balance} шт.`}</p>
        </div>

        {/* ==================== ФОРМА РУЧНОЙ ОПЕРАЦИИ ==================== */}
        <form onSubmit={handleSubmit} className="mb-6">
          <h3 className="text-sm font-semibold mb-3">Ручная операция</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Что делаем
              </label>
              <select
                className="w-full px-3 py-2 text-sm rounded-md"
                style={inputStyle}
                value={reason}
                onChange={(e) => setReason(e.target.value as 'adjustment' | 'defect_writeoff')}
              >
                <option value="adjustment">Пересчёт (исправить)</option>
                <option value="defect_writeoff">Списать брак</option>
              </select>
            </div>

            {reason === 'adjustment' && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Направление
                </label>
                <select
                  className="w-full px-3 py-2 text-sm rounded-md"
                  style={inputStyle}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'plus' | 'minus')}
                >
                  <option value="minus">Меньше (−)</option>
                  <option value="plus">Больше (+)</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                Количество, шт.
              </label>
              <input
                type="number"
                min={1}
                step={1}
                className="w-full px-3 py-2 text-sm rounded-md font-mono"
                style={inputStyle}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
              Причина *
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm rounded-md"
              style={inputStyle}
              placeholder="напр. «пересчёт 30.09» или «треснул корпус»"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          {saveError && (
            <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
              {saveError}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || loading}
            className="mt-3 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {saving ? 'Сохранение...' : 'Сохранить операцию'}
          </button>
        </form>

        {/* ==================== ИСТОРИЯ ДВИЖЕНИЯ ==================== */}
        <h3 className="text-sm font-semibold mb-2">История движения</h3>
        {!loading && movements.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Движений по этому товару ещё не было.
          </p>
        )}
        {movements.length > 0 && (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--line)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Дата', 'Операция', 'Кол-во', 'Документ / причина'].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-3 py-2 text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{REASON_LABELS[m.reason] || m.reason}</td>
                    <td
                      className="px-3 py-2 font-mono whitespace-nowrap"
                      style={{ color: m.quantityChange > 0 ? 'var(--good)' : 'var(--bad)' }}
                    >
                      {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--ink-muted)' }}>
                      {[
                        m.orderNumber ? `Заказ ${formatOrderNumber(m.orderNumber)}` : null,
                        m.invoiceNumber ? `накладная ${m.invoiceNumber}` : null,
                        m.comment,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ОКНО "ОПРИХОДОВАТЬ ТОВАР": поиск по каталогу
// ============================================================
// Нужен, когда при пересчёте нашлась деталь, которой в системе на
// складе нет вообще (например, осталась со старых времён) — в списке
// склада её не найти, поэтому ищем по всему каталогу
function CatalogSearchPanel({ onPick, onClose }: { onPick: (productId: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(query)}&pageSize=20`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось выполнить поиск');
        setResults(data.products as CatalogProduct[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка сети');
      } finally {
        setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:p-8"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-lg font-semibold">Найти товар в каталоге</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded-md"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Закрыть
          </button>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--ink-muted)' }}>
          Введите артикул или название. Выберите товар — откроется окно, где можно добавить его на склад
          (операция «Пересчёт», направление «Больше (+)»).
        </p>
        <input
          type="text"
          autoFocus
          className="w-full px-3 py-2 text-sm rounded-md mb-3"
          style={inputStyle}
          placeholder="напр. 0986452041 или фильтр масляный"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {error && (
          <p className="text-xs mb-2" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}
        {loading && (
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Поиск...
          </p>
        )}
        <div className="flex flex-col gap-1">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className="text-left px-3 py-2 rounded-md text-sm"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="font-mono">{p.article}</span> · {p.brand || '—'} · {p.name || '—'}
              {p.supplierName && (
                <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                  {' '}
                  ({p.supplierName})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ОСНОВНОЙ ЭКРАН
// ============================================================
export default function WarehouseScreen() {
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [totals, setTotals] = useState<{ units: number; costAmount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- фильтры ----
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // По умолчанию показываем только то, что реально лежит на полке —
  // товары, которые уже полностью проданы, обычно не интересны
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [page, setPage] = useState(1);

  // ---- открытые окна ----
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [catalogSearchOpen, setCatalogSearchOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Смена фильтра или поиска — возвращаемся на первую страницу
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, onlyInStock]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (onlyInStock) params.set('onlyInStock', '1');

      const response = await fetch(`/api/admin/warehouse?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить остатки склада');

      setItems(data.items as WarehouseItem[]);
      setPagination(data.pagination as Pagination);
      setTotals(data.totals);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке склада');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, onlyInStock]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <AdminLayout active="warehouse">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
            Админ-панель / Склад
          </p>
          <h1 className="text-2xl font-semibold mb-1.5">Склад</h1>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Что физически лежит у нас. Нажмите на товар — увидите всю историю его движения и сможете исправить
            остаток или списать брак.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCatalogSearchOpen(true)}
          className="shrink-0 px-4 py-2.5 rounded-md text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          + Оприходовать товар
        </button>
      </header>

      {/* ==================== ИТОГИ ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          ['Позиций', pagination ? String(pagination.totalCount) : '—'],
          ['Штук на складе', totals ? String(totals.units) : '—'],
          ['Сумма по закупке, грн', totals ? formatMoney(totals.costAmount) : '—'],
        ].map(([label, value]) => (
          <div
            key={label}
            className="p-4 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              {label}
            </p>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* ==================== ПОИСК И ФИЛЬТР ==================== */}
      <div
        className="p-4 rounded-lg mb-5 flex flex-wrap gap-4 items-end"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Поиск по артикулу, бренду или названию
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 text-sm rounded-md"
            style={inputStyle}
            placeholder="напр. 0986452041"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
          Только в наличии
        </label>
      </div>

      {/* ==================== ТАБЛИЦА ОСТАТКОВ ==================== */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loadError && (
          <p className="text-xs p-4" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchItems} className="underline">
              Повторить
            </button>
          </p>
        )}
        {!loadError && loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}
        {!loadError && !loading && items.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Ничего не найдено. Товары появляются здесь после приёмки от поставщика (раздел «Закупки») или ручного
            оприходования.
          </p>
        )}
        {!loadError && !loading && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Артикул', 'Бренд', 'Название', 'Поставщик', 'Остаток', 'Последнее движение'].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-3 py-2.5 text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.productId}
                    onClick={() => setSelectedProductId(item.productId)}
                    className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">{item.article}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{item.brand || '—'}</td>
                    <td className="px-3 py-2.5">{item.name || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {item.supplierName || '—'}
                    </td>
                    <td
                      className="px-3 py-2.5 font-mono font-semibold whitespace-nowrap"
                      style={{ color: item.balance > 0 ? 'var(--ink)' : 'var(--ink-faint)' }}
                    >
                      {item.balance} шт.
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(item.lastMovementAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== ПАГИНАЦИЯ ==================== */}
      {pagination && totalPages > 1 && (
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
            Страница {pagination.page} из {totalPages}
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

      {selectedProductId && (
        <ProductPanel
          productId={selectedProductId}
          onClose={() => setSelectedProductId(null)}
          onChanged={fetchItems}
        />
      )}

      {catalogSearchOpen && (
        <CatalogSearchPanel
          onClose={() => setCatalogSearchOpen(false)}
          onPick={(productId) => {
            setCatalogSearchOpen(false);
            setSelectedProductId(productId);
          }}
        />
      )}
    </AdminLayout>
  );
}
