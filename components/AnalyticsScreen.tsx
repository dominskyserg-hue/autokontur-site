'use client';

// ============================================================
// Экран "Аналитика" — сводка по продажам: выручка по дням, топ
// продаваемых запчастей, выручка по поставщикам и разбивка заказов
// по статусам. Все цифры — настоящие, посчитаны SQL-агрегацией по
// таблицам orders/order_items (см. app/api/analytics/route.ts),
// а не заглушки.
//
// Использует единственный эндпоинт:
//   GET /api/analytics?days=7|30|90
//
// Переключатель периода наверху — ОДНА строка над всеми графиками
// (а не отдельный фильтр у каждого виджета): меняя период, читатель
// видит, что все цифры на экране пересчитались по одной и той же
// выборке заказов, и они не могут "разъехаться" друг с другом.
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';
import RevenueLineChart from './charts/RevenueLineChart';
import HorizontalBarChart from './charts/HorizontalBarChart';

// ------------------------------------------------------------
// СТАТУСЫ ЗАКАЗА — тот же набор и те же цвета, что и на экране
// "Заказы" (components/OrdersScreen.tsx), чтобы один и тот же статус
// выглядел одинаково в обоих местах интерфейса
// ------------------------------------------------------------
type OrderStatus = 'new' | 'processing' | 'awaiting_parts' | 'ready' | 'cancelled';

const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Новый',
  processing: 'В обработке',
  awaiting_parts: 'Ожидает запчасти',
  ready: 'Готов к выдаче',
  cancelled: 'Отменён',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  new: '#8FA8FF',
  processing: '#F2A65A',
  awaiting_parts: '#B79CFF',
  ready: '#3FBE8B',
  cancelled: '#F2635F',
};

const PERIOD_OPTIONS = [7, 30, 90] as const;
type Period = (typeof PERIOD_OPTIONS)[number];

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface AnalyticsData {
  periodDays: number;
  summary: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
  };
  revenueByDay: Array<{ date: string; revenue: number }>;
  topProducts: Array<{ article: string; name: string | null; quantity: number; revenue: number }>;
  supplierRevenue: Array<{ supplierName: string; revenue: number }>;
  statusBreakdown: Array<{ status: OrderStatus; count: number }>;
}

// Копейки не показываем — только целые гривны, округлённые ВВЕРХ
function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function AnalyticsScreen() {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/analytics?days=${period}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Не удалось загрузить аналитику');
      }
      setData(result as AnalyticsData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке аналитики');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <AdminLayout active="analytics">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Аналитика
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Аналитика</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Продажи за выбранный период. Отменённые заказы не учитываются в выручке.
        </p>
      </header>

      {/* ==================== ПЕРЕКЛЮЧАТЕЛЬ ПЕРИОДА ==================== */}
      {/* Одна строка над всеми графиками — период задаётся один раз и
          скопом действует на весь экран, поэтому цифры на нём никогда
          не могут показывать разные диапазоны дат */}
      <div className="flex items-center gap-2 mb-5">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setPeriod(option)}
            className="text-xs px-3.5 py-1.5 rounded-md font-medium"
            style={{
              background: period === option ? 'var(--accent)' : 'var(--surface)',
              color: period === option ? 'var(--accent-ink)' : 'var(--ink-muted)',
              border: period === option ? 'none' : '1px solid var(--line)',
            }}
          >
            {option} дней
          </button>
        ))}
      </div>

      {loadError && (
        <p className="text-xs mb-4" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchAnalytics} className="underline">
            Повторить
          </button>
        </p>
      )}

      {/* Пока идёт перезагрузка данных (смена периода), предыдущий
          рендер остаётся на экране приглушённым — без "прыжка" вёрстки
          и пустого экрана на каждый клик по периоду */}
      <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
        {data && (
          <>
            {/* ==================== КАРТОЧКИ СВОДКИ ==================== */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Выручка за период</p>
                <p className="text-2xl font-semibold font-mono">{formatMoney(data.summary.totalRevenue)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>без отменённых заказов</p>
              </div>
              <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Заказов</p>
                <p className="text-2xl font-semibold">{data.summary.totalOrders}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>без отменённых заказов</p>
              </div>
              <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Средний чек</p>
                <p className="text-2xl font-semibold font-mono">{formatMoney(data.summary.averageOrderValue)}</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>выручка ÷ число заказов</p>
              </div>
            </div>

            {/* ==================== ВЫРУЧКА ПО ДНЯМ ==================== */}
            <div className="p-5 rounded-lg mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <h2 className="text-base font-semibold mb-1">Выручка по дням</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
                Сумма проданных позиций по дате оформления заказа, гривна.
              </p>
              <RevenueLineChart data={data.revenueByDay} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ==================== ТОП ЗАПЧАСТЕЙ ==================== */}
              <div className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <h2 className="text-base font-semibold mb-1">Топ запчастей по выручке</h2>
                <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
                  Сумма продаж по артикулу за выбранный период.
                </p>
                <HorizontalBarChart
                  data={data.topProducts.map((p) => ({
                    key: p.article,
                    label: p.name || p.article,
                    value: p.revenue,
                  }))}
                  formatValue={formatMoney}
                  emptyMessage="За этот период продаж не было"
                />
              </div>

              {/* ==================== ВЫРУЧКА ПО ПОСТАВЩИКАМ ==================== */}
              <div className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <h2 className="text-base font-semibold mb-1">Выручка по поставщикам</h2>
                <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
                  Чей товар приносит больше всего продаж.
                </p>
                <HorizontalBarChart
                  data={data.supplierRevenue.map((s) => ({
                    key: s.supplierName,
                    label: s.supplierName,
                    value: s.revenue,
                  }))}
                  formatValue={formatMoney}
                  emptyMessage="За этот период продаж не было"
                />
              </div>
            </div>

            {/* ==================== СТАТУСЫ ЗАКАЗОВ ==================== */}
            <div className="p-5 rounded-lg mt-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <h2 className="text-base font-semibold mb-1">Заказы по статусам</h2>
              <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
                Сколько заказов сейчас на каждом этапе — здесь отменённые ЗАСЧИТАНЫ, в отличие от выручки выше.
              </p>
              <HorizontalBarChart
                data={data.statusBreakdown.map((s) => ({
                  key: s.status,
                  label: STATUS_LABELS[s.status],
                  value: s.count,
                  color: STATUS_COLORS[s.status],
                }))}
                formatValue={(v) => String(v)}
              />
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
