'use client';

// ============================================================
// Экран "Отчёты" — три финансовых отчёта (секция 28 schema.sql):
// P&L, дебиторка/кредиторка, Cash Flow.
//
// Использует эндпоинт:
//   GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import AdminLayout from './AdminLayout';

interface ReportsData {
  period: { from: string; to: string };
  pnl: {
    grossRevenue: number;
    cogs: number;
    grossProfit: number;
    returnedRevenue: number;
    returnedCogs: number;
    netProfit: number;
  };
  receivablesPayables: {
    totalReceivable: number;
    totalPayable: number;
    topDebtors: Array<{ id: string; name: string; surname: string | null; phone: string; balance: number }>;
    topCreditors: Array<{ id: string; name: string; balance: number }>;
  };
  cashFlow: {
    cashIn: number;
    cashOutToCustomers: number;
    cashOutToSuppliers: number;
    netCashFlow: number;
  };
}

type Tab = 'pnl' | 'debts' | 'cashflow';

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Сегодня', days: 0 },
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
];

export default function ReportsScreen() {
  const [tab, setTab] = useState<Tab>('pnl');
  const [from, setFrom] = useState(daysAgoIso(30));
  const [to, setTo] = useState(todayIso());
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/reports?from=${from}&to=${to}`);
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Не удалось получить отчёты');
      }
      setData(result as ReportsData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке отчётов');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'pnl', label: 'P&L (прибыль и убытки)' },
    { key: 'debts', label: 'Дебиторка / Кредиторка' },
    { key: 'cashflow', label: 'Движение денег' },
  ];

  return (
    <AdminLayout active="reports">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Отчёты
      </p>
      <h1 className="text-2xl font-semibold mb-1">Финансовые отчёты</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        P&L и движение денег считаются за выбранный период; дебиторка/кредиторка — это моментальный срез
        (сколько клиенты должны нам и сколько мы должны поставщикам прямо сейчас, вне зависимости от периода).
      </p>

      {/* ==================== ПЕРИОД ==================== */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            С
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            По
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          />
        </div>
        <div className="flex gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(daysAgoIso(p.days));
                setTo(todayIso());
              }}
              className="text-xs px-3 py-2 rounded-md"
              style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== ВКЛАДКИ ==================== */}
      <div className="flex gap-2 mb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="text-sm px-4 py-2.5 -mb-px"
            style={
              tab === t.key
                ? { color: 'var(--accent)', borderBottom: '2px solid var(--accent)', fontWeight: 500 }
                : { color: 'var(--ink-muted)', borderBottom: '2px solid transparent' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>
          Загрузка...
        </p>
      )}
      {loadError && (
        <p className="text-sm p-3 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      {!loading && data && (
        <>
          {tab === 'pnl' && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Валовая выручка', value: data.pnl.grossRevenue, color: 'var(--ink)' },
                  { label: 'Себестоимость (COGS)', value: data.pnl.cogs, color: 'var(--ink-muted)' },
                  { label: 'Валовая прибыль', value: data.pnl.grossProfit, color: 'var(--good)' },
                  {
                    label: 'Чистая прибыль (с учётом возвратов)',
                    value: data.pnl.netProfit,
                    color: data.pnl.netProfit >= 0 ? 'var(--good)' : 'var(--bad)',
                  },
                ].map((card) => (
                  <div key={card.label} className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                    <p className="text-xs mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {card.label}
                    </p>
                    <p className="text-xl font-semibold font-mono" style={{ color: card.color }}>
                      {formatMoney(card.value)} грн
                    </p>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
                  Поправка на возвраты за период
                </p>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Возвращённая выручка: </span>
                    <span className="font-mono">-{formatMoney(data.pnl.returnedRevenue)} грн</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Возвращённая себестоимость: </span>
                    <span className="font-mono">-{formatMoney(data.pnl.returnedCogs)} грн</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'debts' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--bad-soft)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Клиенты должны нам (всего)
                  </p>
                  <p className="text-xl font-semibold font-mono" style={{ color: 'var(--bad)' }}>
                    {formatMoney(data.receivablesPayables.totalReceivable)} грн
                  </p>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <h3 className="text-sm font-semibold px-4 pt-3 pb-2">Топ должников</h3>
                  {data.receivablesPayables.topDebtors.length === 0 ? (
                    <p className="text-xs px-4 pb-3" style={{ color: 'var(--ink-faint)' }}>
                      Долгов нет.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.receivablesPayables.topDebtors.map((c) => (
                          <tr key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td className="px-4 py-2">
                              <Link href={`/admin/customers/${c.id}`} className="underline">
                                {c.name} {c.surname || ''}
                              </Link>
                            </td>
                            <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--bad)' }}>
                              {formatMoney(c.balance)} грн
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div>
                <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--warn-soft)' }}>
                  <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Мы должны поставщикам (всего)
                  </p>
                  <p className="text-xl font-semibold font-mono" style={{ color: 'var(--warn)' }}>
                    {formatMoney(data.receivablesPayables.totalPayable)} грн
                  </p>
                </div>
                <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <h3 className="text-sm font-semibold px-4 pt-3 pb-2">Топ поставщиков, которым должны</h3>
                  {data.receivablesPayables.topCreditors.length === 0 ? (
                    <p className="text-xs px-4 pb-3" style={{ color: 'var(--ink-faint)' }}>
                      Долгов нет.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.receivablesPayables.topCreditors.map((s) => (
                          <tr key={s.id} style={{ borderTop: '1px solid var(--line)' }}>
                            <td className="px-4 py-2">
                              <Link href={`/admin/suppliers/${s.id}/finance`} className="underline">
                                {s.name}
                              </Link>
                            </td>
                            <td className="px-4 py-2 text-right font-mono" style={{ color: 'var(--warn)' }}>
                              {formatMoney(s.balance)} грн
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'cashflow' && (
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Пришло от клиентов', value: data.cashFlow.cashIn, color: 'var(--good)' },
                  // "|| 0" убирает отрицательный ноль (-0): при cashOutToCustomers === 0
                  // выражение "-0" в JS формально отрицательное и formatMoney напечатал
                  // бы "-0,00" — визуально неотличимо от нормального нуля по смыслу, но
                  // сбивает с толку рядом со знаком "+" перед числом
                  { label: 'Возвраты клиентам', value: -data.cashFlow.cashOutToCustomers || 0, color: 'var(--bad)' },
                  { label: 'Оплаты поставщикам', value: -data.cashFlow.cashOutToSuppliers || 0, color: 'var(--bad)' },
                  {
                    label: 'Чистый денежный поток',
                    value: data.cashFlow.netCashFlow,
                    color: data.cashFlow.netCashFlow >= 0 ? 'var(--good)' : 'var(--bad)',
                  },
                ].map((card) => (
                  <div key={card.label} className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                    <p className="text-xs mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      {card.label}
                    </p>
                    <p className="text-xl font-semibold font-mono" style={{ color: card.color }}>
                      {card.value >= 0 ? '+' : ''}
                      {formatMoney(card.value)} грн
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                Cash Flow считает только реальное движение денег (предоплаты, оплаты наличными/картой, возвраты,
                оплаты поставщикам) — в отличие от P&L, который считает по факту отгрузки заказа, а не по факту
                оплаты.
              </p>
            </div>
          )}
        </>
      )}
    </AdminLayout>
  );
}
