'use client';

// ============================================================
// Экран "Заказы" — список всех заказов клиентов с пагинацией,
// быстрыми фильтрами-кнопками по статусу (со счётчиками), фильтром
// "Не оплачены", периодом дат и поиском по клиенту. Клик по строке/кнопке
// "Детали" открывает модальное окно карточки заказа
// (components/OrderDetailsModal.tsx) — вся логика самой карточки
// (статус, ТТН, авто, состав заказа, оплата) вынесена туда, здесь
// остался только список.
//
// Использует эндпоинт:
//   GET /api/orders — список заказов (пагинация + фильтр по статусу
//                      + поиск по имени/телефону + даты + "не оплачены"
//                      + счётчики для кнопок, withCounts=1)
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
  // Напоминание "Передзвонити" (или null)
  callbackAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

interface OrderCounts {
  byStatus: Record<string, number>;
  unpaid: number;
  all: number;
  callbacks: number;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

// Быстрый фильтр: либо статус заказа, либо "Не оплачены", либо "Все"
type QuickFilter = '' | OrderStatus | 'unpaid' | 'callback';

// Дата в формате ГГГГ-ММ-ДД по местному времени браузера — именно такой
// формат ждёт <input type="date"> и параметры dateFrom/dateTo в API
function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return toDateInput(date);
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
  const [counts, setCounts] = useState<OrderCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- фильтры ----
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
  }, [debouncedSearch, quickFilter, dateFrom, dateTo]);

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
      params.set('withCounts', '1');
      if (quickFilter === 'unpaid') params.set('unpaid', '1');
      else if (quickFilter === 'callback') params.set('callback', '1');
      else if (quickFilter) params.set('status', quickFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const response = await fetch(`/api/orders?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить список заказов');
      }

      setOrders(data.orders as OrderListItem[]);
      setPagination(data.pagination as Pagination);
      setCounts((data.counts as OrderCounts) || null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заказов');
    } finally {
      setLoading(false);
    }
  }, [page, quickFilter, debouncedSearch, dateFrom, dateTo]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const totalPages = pagination?.totalPages ?? 0;

  // Ссылка на выгрузку в Excel — с теми же фильтрами, что сейчас на
  // экране (app/api/admin/export/route.ts)
  const exportParams = new URLSearchParams({ kind: 'orders' });
  if (quickFilter === 'unpaid') exportParams.set('unpaid', '1');
  // Фильтр "Передзвонити" выгрузка не поддерживает — выгружаем без него
  else if (quickFilter && quickFilter !== 'callback') exportParams.set('status', quickFilter);
  if (debouncedSearch) exportParams.set('search', debouncedSearch);
  if (dateFrom) exportParams.set('dateFrom', dateFrom);
  if (dateTo) exportParams.set('dateTo', dateTo);
  const exportUrl = `/api/admin/export?${exportParams.toString()}`;

  // Кнопки быстрых фильтров: "Все", каждый статус и "Не оплачены".
  // Счётчик учитывает поиск и даты, но не сам выбранный статус — так
  // видно, сколько заказов "ждёт" в каждой колонке
  const quickFilters: { key: QuickFilter; label: string; count: number | undefined }[] = [
    { key: '', label: 'Все', count: counts?.all },
    ...STATUS_OPTIONS.map((status) => ({
      key: status as QuickFilter,
      label: STATUS_LABELS[status],
      count: counts ? counts.byStatus[status] || 0 : undefined,
    })),
    { key: 'unpaid', label: 'Не оплачены', count: counts?.unpaid },
    { key: 'callback', label: '📞 Передзвонити', count: counts?.callbacks },
  ];

  // Быстрый выбор периода — чтобы не щёлкать календарь каждый раз
  const periodPresets: { label: string; from: string; to: string }[] = [
    { label: 'Сегодня', from: daysAgo(0), to: daysAgo(0) },
    { label: '7 дней', from: daysAgo(6), to: daysAgo(0) },
    { label: '30 дней', from: daysAgo(29), to: daysAgo(0) },
  ];

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
        <div className="shrink-0 flex gap-2">
          <a
            href={exportUrl}
            className="px-4 py-2.5 rounded-md text-sm font-medium"
            style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
          >
            Скачать Excel
          </a>
          <Link
            href="/admin/orders/new"
            className="px-4 py-2.5 rounded-md text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            + Новый заказ
          </Link>
        </div>
      </header>

      {/* ==================== ПОИСК И ПЕРИОД ==================== */}
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

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            С даты
          </label>
          <input
            type="date"
            className="px-3 py-2 text-sm rounded-md"
            // colorScheme: 'dark' — иначе значок календаря чёрный на тёмном фоне
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', colorScheme: 'dark' }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            По дату
          </label>
          <input
            type="date"
            className="px-3 py-2 text-sm rounded-md"
            // colorScheme: 'dark' — иначе значок календаря чёрный на тёмном фоне
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)', colorScheme: 'dark' }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {periodPresets.map((preset) => {
            const isActive = dateFrom === preset.from && dateTo === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setDateFrom(preset.from);
                  setDateTo(preset.to);
                }}
                className="text-xs px-2.5 py-2 rounded-md"
                style={{
                  border: '1px solid var(--line)',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
                }}
              >
                {preset.label}
              </button>
            );
          })}
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="text-xs px-2.5 py-2 rounded-md underline"
              style={{ color: 'var(--ink-faint)' }}
            >
              Весь период
            </button>
          )}
        </div>
      </div>

      {/* ==================== БЫСТРЫЕ ФИЛЬТРЫ ПО СТАТУСУ ==================== */}
      <div className="flex flex-wrap gap-2 mb-5">
        {quickFilters.map((filter) => {
          const isActive = quickFilter === filter.key;
          return (
            <button
              key={filter.key || 'all'}
              type="button"
              onClick={() => setQuickFilter(filter.key)}
              className="text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap"
              style={{
                border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--line)'),
                background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
              }}
            >
              {filter.label}
              {filter.count !== undefined && (
                <span className="ml-1.5" style={{ color: isActive ? 'var(--accent)' : 'var(--ink-faint)' }}>
                  {filter.count}
                </span>
              )}
            </button>
          );
        })}
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
                      {/* Напоминание "Передзвонити": красное — уже пора (или
                          просрочено), жёлтое — позже */}
                      {order.callbackAt && (
                        <span
                          className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full font-medium"
                          style={
                            new Date(order.callbackAt).getTime() <= Date.now()
                              ? { background: 'var(--bad-soft)', color: 'var(--bad)' }
                              : { background: 'var(--warn-soft)', color: 'var(--warn)' }
                          }
                          title="Нагадування: передзвонити клієнту"
                        >
                          📞 {formatDateTime(order.callbackAt)}
                        </span>
                      )}
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
          // key — при переходе к соседнему заказу окно создаётся заново,
          // и все его поля/черновики сбрасываются, а не "протекают" от
          // предыдущего заказа
          key={selectedOrderId}
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onOrderChanged={fetchOrders}
          // "Повторити замовлення" — сразу открываем только что созданный заказ
          onOpenOrder={(newOrderId) => {
            fetchOrders();
            setSelectedOrderId(newOrderId);
          }}
          navigation={(() => {
            // Листаем в пределах текущей страницы списка (с теми же
            // фильтрами, что сейчас на экране)
            const index = orders.findIndex((o) => o.id === selectedOrderId);
            if (index === -1) return undefined;
            return {
              onPrev: index > 0 ? () => setSelectedOrderId(orders[index - 1].id) : null,
              onNext: index < orders.length - 1 ? () => setSelectedOrderId(orders[index + 1].id) : null,
              positionLabel: `${index + 1} з ${orders.length}`,
            };
          })()}
        />
      )}
    </AdminLayout>
  );
}
