'use client';

// ============================================================
// Экран "Заказы" — список всех заказов клиентов с пагинацией,
// фильтром по статусу и поиском по клиенту. Клик по строке/кнопке
// "Детали" открывает модальное окно карточки заказа
// (components/OrderDetailsModal.tsx) — вся логика самой карточки
// (статус, ТТН, авто, состав заказа, оплата) вынесена туда, здесь
// остался только список.
//
// Использует эндпоинт:
//   GET /api/orders — список заказов (пагинация + фильтр по статусу
//                      + поиск по имени/телефону)
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from './AdminLayout';
import OrderDetailsModal from './OrderDetailsModal';
import PaymentBadge from './PaymentBadge';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  formatDateTime,
  formatMoney,
  formatOrderNumber,
  type OrderStatus,
} from '@/lib/orderUi';

interface OrderListItem {
  id: string;
  orderNumber: number;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

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

  // ---- выбранный заказ (открывает OrderDetailsModal) ----
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

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

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <AdminLayout active="orders">
      <header className="mb-7 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
            Админ-панель / Заказы
          </p>
          <h1 className="text-2xl font-semibold mb-1.5">Заказы</h1>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Все заказы клиентов. Найдено: {pagination ? pagination.totalCount : '—'}.
          </p>
        </div>
        <Link
          href="/admin/orders/new"
          className="shrink-0 px-4 py-2.5 rounded-md text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          + Новый заказ
        </Link>
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
                  {['№', 'Дата', 'Клиент', 'Телефон', 'К-сть', 'Сумма', 'Статус / Оплата', ''].map((heading) => (
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
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--line)' }}
                  >
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                      {formatOrderNumber(order.orderNumber)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(order.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {order.customerName} {order.customerSurname}
                    </td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">{order.customerPhone}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{order.itemsCount}</td>
                    <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatMoney(order.totalAmount)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={order.status} />
                        <PaymentBadge paidAmount={order.paidAmount} totalAmount={order.totalAmount} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          // stopPropagation — иначе сработали бы сразу
                          // два обработчика: клик по строке и по кнопке
                          e.stopPropagation();
                          setSelectedOrderId(order.id);
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

      {/* ==================== МОДАЛЬНОЕ ОКНО КАРТОЧКИ ЗАКАЗА ==================== */}
      {selectedOrderId && (
        <OrderDetailsModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onOrderChanged={fetchOrders}
        />
      )}
    </AdminLayout>
  );
}
