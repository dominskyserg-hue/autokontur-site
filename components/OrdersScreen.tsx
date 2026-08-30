'use client';

// ============================================================
// Экран "Заказы" — управление заказами клиентов. Показывает список
// всех заказов с пагинацией, фильтром по статусу и поиском по
// клиенту, а по клику на заказ открывает панель с полным составом
// заказа (какие детали заказаны, по какой цене и в каком количестве)
// и позволяет сменить статус.
//
// Использует эндпоинты:
//   GET   /api/orders        — список заказов (пагинация + фильтр
//                               по статусу + поиск по имени/телефону)
//   GET   /api/orders/[id]   — полный состав одного заказа
//   PATCH /api/orders/[id]   — сменить статус заказа
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';

// ------------------------------------------------------------
// СТАТУСЫ ЗАКАЗА — тот же набор, что и на бэкенде (см.
// app/api/orders/route.ts и CHECK-ограничение в schema.sql)
// ------------------------------------------------------------
type OrderStatus = 'new' | 'processing' | 'awaiting_parts' | 'ready' | 'cancelled';

const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  processing: 'В обработке',
  awaiting_parts: 'Ожидает запчасти',
  ready: 'Готов к выдаче',
  cancelled: 'Отменён',
};

// Цвета бейджа статуса — фон/текст. Заданы напрямую (не через общие
// CSS-переменные темы), потому что это цвета конкретно ДЛЯ статусов,
// а не часть общей палитры оформления
const STATUS_COLORS: Record<OrderStatus, { bg: string; fg: string }> = {
  new: { bg: '#1B2142', fg: '#8FA8FF' },
  processing: { bg: '#3A2A16', fg: '#F2A65A' },
  awaiting_parts: { bg: '#2B1F4A', fg: '#B79CFF' },
  ready: { bg: '#12301F', fg: '#3FBE8B' },
  cancelled: { bg: '#3A1E22', fg: '#F2635F' },
};

// Порядок статусов в выпадающем списке — не алфавитный, а
// "естественный" порядок жизни заказа, от нового до готового/отменённого
const STATUS_OPTIONS: OrderStatus[] = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'];

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface OrderListItem {
  id: string;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
}

interface OrderItem {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
  supplierId: string | null;
  supplierName: string | null;
}

// Для выпадающего списка "сменить поставщика" нужны только id и
// название — остальные поля поставщика здесь не используются
interface SupplierOption {
  id: string;
  name: string;
}

interface OrderDetails {
  id: string;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  comment: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  totalAmount: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Короткая, читаемая часть UUID для отображения в таблице — полный
// id всё равно виден в панели деталей и в самом запросе к API
function shortId(id: string): string {
  return `#${id.slice(0, 8)}`;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const colors = STATUS_COLORS[status];
  return (
    <span
      className="text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: colors.bg, color: colors.fg }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function OrdersScreen() {
  // ---- список заказов ----
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- фильтры ----
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  // ---- панель деталей выбранного заказа ----
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // ---- смена статуса внутри панели деталей ----
  const [statusDraft, setStatusDraft] = useState<OrderStatus>('new');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusSaveError, setStatusSaveError] = useState<string | null>(null);

  // ---- список поставщиков для выпадающего списка "сменить поставщика" ----
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  // ---- редактирование ОДНОЙ позиции заказа (цена + поставщик) ----
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemPrice, setEditItemPrice] = useState('');
  const [editItemSupplierId, setEditItemSupplierId] = useState('');
  const [editItemSaving, setEditItemSaving] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // СПИСОК ПОСТАВЩИКОВ ДЛЯ ВЫПАДАЮЩЕГО СПИСКА (загружается один раз)
  // ------------------------------------------------------------
  useEffect(() => {
    fetch('/api/suppliers')
      .then((response) => response.json())
      .then((data) => {
        if (data.suppliers) {
          setSuppliers(
            (data.suppliers as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name }))
          );
        }
      })
      .catch(() => {
        // Список нужен только для смены поставщика внутри заказа —
        // если он не загрузился, сам заказ всё равно можно посмотреть
      });
  }, []);

  // ------------------------------------------------------------
  // ЗАДЕРЖКА ПОИСКА (debounce) — не отправляем запрос на каждую букву
  // ------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Смена фильтра или поиска — возвращаемся на первую страницу
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  // ------------------------------------------------------------
  // ЗАГРУЗКА СПИСКА ЗАКАЗОВ (GET /api/orders)
  // ------------------------------------------------------------
  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      if (statusFilter) params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const response = await fetch(`/api/orders?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить список заказов');
      }

      setOrders(data.orders as OrderListItem[]);
      setPagination(data.pagination as Pagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заказов');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ------------------------------------------------------------
  // ОТКРЫТИЕ ПАНЕЛИ ДЕТАЛЕЙ ЗАКАЗА (GET /api/orders/[id])
  // ------------------------------------------------------------
  const openOrderDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
  };

  const closeOrderDetails = () => {
    setSelectedOrderId(null);
    setOrderDetails(null);
    setDetailsError(null);
    setStatusSaveError(null);
    setEditingItemId(null);
    setEditItemError(null);
  };

  useEffect(() => {
    if (!selectedOrderId) return;

    let cancelled = false;
    setLoadingDetails(true);
    setDetailsError(null);

    fetch(`/api/orders/${selectedOrderId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Не удалось загрузить заказ');
        }
        // cancelled — на случай, если админ успел кликнуть другой
        // заказ до того, как первый запрос завершился: тогда не
        // затираем уже загруженные данные более свежего выбора
        if (!cancelled) {
          setOrderDetails(data.order as OrderDetails);
          setStatusDraft((data.order as OrderDetails).status);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailsError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заказа');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOrderId]);

  // ------------------------------------------------------------
  // СМЕНА СТАТУСА — PATCH /api/orders/[id]
  // ------------------------------------------------------------
  const handleSaveStatus = async () => {
    if (!orderDetails) return;

    setSavingStatus(true);
    setStatusSaveError(null);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusDraft }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось изменить статус заказа');
      }

      setOrderDetails({ ...orderDetails, status: statusDraft });
      // Список заказов тоже показывает статус бейджем — обновляем и
      // его, чтобы после закрытия панели новый статус уже был виден
      await fetchOrders();
    } catch (error) {
      setStatusSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении статуса');
    } finally {
      setSavingStatus(false);
    }
  };

  // ------------------------------------------------------------
  // РЕДАКТИРОВАНИЕ ПОЗИЦИИ ЗАКАЗА (цена + поставщик) —
  // PATCH /api/orders/[id]/items/[itemId]
  // ------------------------------------------------------------
  const openItemEdit = (item: OrderItem) => {
    setEditingItemId(item.id);
    setEditItemPrice(String(item.price));
    setEditItemSupplierId(item.supplierId || '');
    setEditItemError(null);
  };

  const cancelItemEdit = () => {
    setEditingItemId(null);
    setEditItemError(null);
  };

  const handleSaveItem = async () => {
    if (!orderDetails || !editingItemId) return;

    const price = parseFloat(editItemPrice.replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) {
      setEditItemError('Цена должна быть числом не меньше нуля');
      return;
    }
    if (!editItemSupplierId) {
      setEditItemError('Выберите поставщика');
      return;
    }

    setEditItemSaving(true);
    setEditItemError(null);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items/${editingItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price, supplierId: editItemSupplierId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить позицию заказа');
      }

      const updatedItem = data.item as OrderItem;
      // Обновляем позицию прямо в уже открытой панели, не перезапрашивая
      // весь заказ заново — и пересчитываем итоговую сумму по новым
      // данным (цена могла измениться)
      const nextItems = orderDetails.items.map((item) =>
        item.id === updatedItem.id ? updatedItem : item
      );
      const nextTotal = nextItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      setOrderDetails({ ...orderDetails, items: nextItems, totalAmount: nextTotal });
      setEditingItemId(null);

      // Сумма заказа в общем списке справа тоже должна обновиться
      await fetchOrders();
    } catch (error) {
      setEditItemError(error instanceof Error ? error.message : 'Ошибка сети при сохранении позиции');
    } finally {
      setEditItemSaving(false);
    }
  };

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <AdminLayout active="orders">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Заказы
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Заказы</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Все заказы клиентов. Найдено: {pagination ? pagination.totalCount : '—'}.
        </p>
      </header>

      {/* ==================== ПОИСК И ФИЛЬТР ПО СТАТУСУ ==================== */}
      <div
        className="p-4 rounded-lg mb-5 flex flex-wrap gap-3 items-end"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Поиск по имени или телефону
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            placeholder="напр. Иван или 0501234567"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="w-56">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Статус
          </label>
          <select
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as '' | OrderStatus)}
          >
            <option value="">Все статусы</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ==================== ТАБЛИЦА ЗАКАЗОВ ==================== */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loadError && (
          <p className="text-xs p-4" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchOrders} className="underline">
              Повторить
            </button>
          </p>
        )}

        {!loadError && loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loadError && !loading && orders.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Заказов не найдено. Попробуйте изменить поиск или фильтр.
          </p>
        )}

        {!loadError && !loading && orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['ID заказа', 'Дата', 'Клиент', 'Телефон', 'Кол-во товаров', 'Сумма', 'Статус', ''].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="text-left px-4 py-2.5 text-xs font-medium whitespace-nowrap"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => openOrderDetails(order.id)}
                    className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                      {shortId(order.id)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(order.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {order.customerName} {order.customerSurname}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{order.customerPhone}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{order.itemsCount}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(order.totalAmount)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          // stopPropagation — иначе сработали бы сразу
                          // два обработчика: клик по строке и по кнопке
                          e.stopPropagation();
                          openOrderDetails(order.id);
                        }}
                        className="text-xs px-3 py-1.5 rounded-md"
                        style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                      >
                        Детали
                      </button>
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

      {/* ==================== МОДАЛЬНОЕ ОКНО С ДЕТАЛЯМИ ЗАКАЗА ==================== */}
      {selectedOrderId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={closeOrderDetails}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            // stopPropagation — клик ВНУТРИ окна не должен его закрывать
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <h2 className="text-base font-semibold">
                Заказ {orderDetails ? shortId(orderDetails.id) : ''}
              </h2>
              <button
                type="button"
                onClick={closeOrderDetails}
                className="text-sm px-2 py-1 rounded-md"
                style={{ color: 'var(--ink-muted)' }}
                aria-label="Закрыть"
              >
                ✕
              </button>
            </div>

            {detailsError && (
              <p className="text-xs mb-4" style={{ color: 'var(--bad)' }}>
                {detailsError}
              </p>
            )}

            {loadingDetails && (
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                Загрузка...
              </p>
            )}

            {!loadingDetails && orderDetails && (
              <>
                {/* ---- данные клиента и доставки ---- */}
                <div className="text-sm mb-5 flex flex-col gap-1">
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>Клиент: </span>
                    {orderDetails.customerName} {orderDetails.customerSurname}
                  </div>
                  <div className="font-mono">
                    <span className="font-sans" style={{ color: 'var(--ink-muted)' }}>Телефон: </span>
                    {orderDetails.customerPhone}
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>Город: </span>
                    {orderDetails.city}
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>Отделение Новой Почты: </span>
                    {orderDetails.novaPoshtaAddress}
                  </div>
                  {orderDetails.comment && (
                    <div>
                      <span style={{ color: 'var(--ink-muted)' }}>Комментарий: </span>
                      {orderDetails.comment}
                    </div>
                  )}
                  <div>
                    <span style={{ color: 'var(--ink-muted)' }}>Создан: </span>
                    {formatDateTime(orderDetails.createdAt)}
                  </div>
                </div>

                {/* ---- смена статуса ---- */}
                <div
                  className="p-3.5 rounded-md mb-5"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                >
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Статус заказа
                  </label>
                  <div className="flex gap-2">
                    <select
                      className="flex-1 px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value as OrderStatus)}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={savingStatus || statusDraft === orderDetails.status}
                      onClick={handleSaveStatus}
                      className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                    >
                      {savingStatus ? 'Сохранение...' : 'Сохранить'}
                    </button>
                  </div>
                  {statusSaveError && (
                    <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                      {statusSaveError}
                    </p>
                  )}
                </div>

                {/* ---- состав заказа ---- */}
                <h3 className="text-sm font-semibold mb-2.5">Состав заказа</h3>
                {orderDetails.items.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                    В заказе нет ни одной позиции.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {orderDetails.items.map((item) => {
                      const isEditing = editingItemId === item.id;

                      return (
                        <div
                          key={item.id}
                          className="p-3 rounded-md text-sm"
                          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate">{item.name || 'Без названия'}</p>
                              <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                                {item.article}
                                {item.brand ? ` · ${item.brand}` : ''}
                                {!isEditing && item.supplierName ? ` · ${item.supplierName}` : ''}
                              </p>
                            </div>
                            {!isEditing && (
                              <div className="text-right shrink-0">
                                <p className="font-mono">{formatMoney(item.price)} × {item.quantity}</p>
                                <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                                  = {formatMoney(item.price * item.quantity)}
                                </p>
                              </div>
                            )}
                          </div>

                          {!isEditing ? (
                            <button
                              type="button"
                              onClick={() => openItemEdit(item)}
                              className="text-[11px] mt-2 px-2 py-1 rounded"
                              style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                            >
                              Изменить цену/поставщика
                            </button>
                          ) : (
                            <div className="mt-3 pt-3 flex flex-col gap-2.5" style={{ borderTop: '1px dashed var(--line)' }}>
                              <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                    Цена за шт.
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    className="w-full px-2.5 py-1.5 text-xs rounded-md font-mono"
                                    style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                    value={editItemPrice}
                                    onChange={(e) => setEditItemPrice(e.target.value)}
                                    autoFocus
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                    Поставщик
                                  </label>
                                  <select
                                    className="w-full px-2.5 py-1.5 text-xs rounded-md"
                                    style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                    value={editItemSupplierId}
                                    onChange={(e) => setEditItemSupplierId(e.target.value)}
                                  >
                                    <option value="">Выберите поставщика</option>
                                    {suppliers.map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>

                              {editItemError && (
                                <p className="text-[11px]" style={{ color: 'var(--bad)' }}>
                                  {editItemError}
                                </p>
                              )}

                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={editItemSaving}
                                  onClick={handleSaveItem}
                                  className="flex-1 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                                >
                                  {editItemSaving ? 'Сохранение...' : 'Сохранить'}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelItemEdit}
                                  className="px-3 py-1.5 rounded-md text-xs"
                                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div
                  className="flex items-center justify-between mt-4 pt-4 text-sm font-semibold"
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <span>Итого</span>
                  <span className="font-mono">{formatMoney(orderDetails.totalAmount)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
