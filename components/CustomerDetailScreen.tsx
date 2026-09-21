'use client';

// ============================================================
// Экран "Карточка клиента" — баланс, лента операций (леджер
// customer_transactions) и список заказов одного клиента, плюс форма
// ручной записи новой операции (предоплата / корректировка / наличная
// выплата мимо баланса).
//
// Использует эндпоинты:
//   GET  /api/admin/customers/[id]
//   POST /api/admin/customers/[id]/transactions
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import AdminLayout from './AdminLayout';

interface CustomerDetail {
  id: string;
  phone: string;
  name: string;
  surname: string | null;
  email: string | null;
  balance: number;
  createdAt: string;
}

interface CustomerTransaction {
  id: string;
  amount: number;
  type: string;
  orderId: string | null;
  returnId: string | null;
  affectsCustomerBalance: boolean;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface CustomerOrder {
  id: string;
  status: string;
  createdAt: string;
  shippedAt: string | null;
  totalAmount: number;
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  prepayment: 'Предоплата',
  shipment: 'Отгрузка в долг',
  return_refund: 'Возврат денег',
  adjustment: 'Корректировка',
  cash_payment: 'Наличная оплата (мимо баланса)',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: 'Новое',
  processing: 'В обработке',
  ordered_from_supplier: 'Заказано у поставщика',
  in_stock: 'На складе',
  ready_for_pickup: 'Готов к выдаче',
  shipped: 'Отгружен',
  cancelled: 'Отменён',
};

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type FormType = 'prepayment' | 'cash_payment' | 'adjustment';

export default function CustomerDetailScreen({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма новой операции ----
  const [formType, setFormType] = useState<FormType>('prepayment');
  const [formAmount, setFormAmount] = useState('');
  const [formDirection, setFormDirection] = useState<'increase' | 'decrease'>('decrease');
  const [formComment, setFormComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/customers/${customerId}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить данные клиента');
      }
      setCustomer(data.customer as CustomerDetail);
      setTransactions(data.transactions as CustomerTransaction[]);
      setOrders(data.orders as CustomerOrder[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке клиента');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsedAmount = parseFloat(formAmount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Сумма должна быть положительным числом.');
      return;
    }
    if (formType === 'adjustment' && !formComment.trim()) {
      setFormError('Для ручной корректировки укажите комментарий.');
      return;
    }

    // prepayment и cash_payment всегда уменьшают долг клиента (деньги
    // получены) — знак не спрашиваем, чтобы не запутать. Для adjustment
    // направление выбирает сам администратор
    const signedAmount =
      formType === 'adjustment' ? (formDirection === 'increase' ? parsedAmount : -parsedAmount) : -parsedAmount;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/customers/${customerId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          amount: signedAmount,
          affectsCustomerBalance: formType !== 'cash_payment',
          comment: formComment || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось записать операцию');
      }

      setFormAmount('');
      setFormComment('');
      await fetchData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Ошибка сети при записи операции');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout active="customers">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        <Link href="/admin/customers" className="underline">
          Клиенты
        </Link>{' '}
        / Карточка клиента
      </p>

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

      {!loading && customer && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-semibold mb-1">
                {customer.name} {customer.surname || ''}
              </h1>
              <p className="text-sm font-mono" style={{ color: 'var(--ink-muted)' }}>
                {customer.phone} {customer.email ? `· ${customer.email}` : ''}
              </p>
            </div>

            <div
              className="px-5 py-3 rounded-lg text-right"
              style={
                customer.balance === 0
                  ? { background: 'var(--surface-2)' }
                  : customer.balance > 0
                    ? { background: 'var(--bad-soft)' }
                    : { background: 'var(--good-soft)' }
              }
            >
              <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>
                {customer.balance > 0 ? 'Клиент должен нам' : customer.balance < 0 ? 'Предоплата клиента' : 'Баланс'}
              </p>
              <p
                className="text-xl font-semibold"
                style={{ color: customer.balance === 0 ? 'var(--ink)' : customer.balance > 0 ? 'var(--bad)' : 'var(--good)' }}
              >
                {formatMoney(Math.abs(customer.balance))} грн
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-6 items-start">
            {/* ==================== ФОРМА НОВОЙ ОПЕРАЦИИ ==================== */}
            <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <h2 className="text-base font-semibold mb-3">Записать операцию</h2>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Тип операции
                  </label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as FormType)}
                    className="w-full px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  >
                    <option value="prepayment">Предоплата (уменьшает долг)</option>
                    <option value="cash_payment">Наличная оплата при получении (мимо баланса)</option>
                    <option value="adjustment">Ручная корректировка</option>
                  </select>
                </div>

                {formType === 'adjustment' && (
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      Направление
                    </label>
                    <select
                      value={formDirection}
                      onChange={(e) => setFormDirection(e.target.value as 'increase' | 'decrease')}
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    >
                      <option value="decrease">Уменьшает долг клиента</option>
                      <option value="increase">Увеличивает долг клиента</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Сумма, грн
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="напр. 500"
                    className="w-full px-3 py-2 text-sm rounded-md font-mono"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Комментарий {formType === 'adjustment' ? '(обязательно)' : '(необязательно)'}
                  </label>
                  <input
                    type="text"
                    value={formComment}
                    onChange={(e) => setFormComment(e.target.value)}
                    placeholder="напр. вернули деньги за неверный размер"
                    className="w-full px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  />
                </div>

                {formError && (
                  <p className="text-xs" style={{ color: 'var(--bad)' }}>
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {saving ? 'Сохранение...' : 'Записать'}
                </button>
              </form>
            </section>

            <div className="flex flex-col gap-6">
              {/* ==================== ЛЕНТА ОПЕРАЦИЙ ==================== */}
              <section className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <h2 className="text-base font-semibold px-5 pt-4 pb-3">История операций</h2>
                {transactions.length === 0 ? (
                  <p className="text-xs px-5 pb-4" style={{ color: 'var(--ink-faint)' }}>
                    Операций пока не было.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          {['Дата', 'Тип', 'Сумма', 'Комментарий'].map((h) => (
                            <th
                              key={h}
                              className="text-left px-5 py-2 text-xs font-medium whitespace-nowrap"
                              style={{ color: 'var(--ink-muted)' }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((t) => (
                          <tr key={t.id} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                              {formatDateTime(t.createdAt)}
                            </td>
                            <td className="px-5 py-2.5 whitespace-nowrap">
                              {TRANSACTION_TYPE_LABELS[t.type] || t.type}
                              {!t.affectsCustomerBalance && (
                                <span className="ml-1.5 text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                                  (не влияет на баланс)
                                </span>
                              )}
                            </td>
                            <td
                              className="px-5 py-2.5 font-mono whitespace-nowrap"
                              style={{ color: t.amount > 0 ? 'var(--bad)' : 'var(--good)' }}
                            >
                              {t.amount > 0 ? '+' : ''}
                              {formatMoney(t.amount)}
                            </td>
                            <td className="px-5 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                              {t.comment || '—'}
                              {t.orderId && (
                                <span className="ml-1.5 text-xs" style={{ color: 'var(--ink-faint)' }}>
                                  заказ №{t.orderId.slice(0, 8)}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ==================== ЗАКАЗЫ КЛИЕНТА ==================== */}
              <section className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <h2 className="text-base font-semibold px-5 pt-4 pb-3">Заказы</h2>
                {orders.length === 0 ? (
                  <p className="text-xs px-5 pb-4" style={{ color: 'var(--ink-faint)' }}>
                    Заказов пока нет.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          {['Дата', 'Статус', 'Сумма', ''].map((h) => (
                            <th
                              key={h}
                              className="text-left px-5 py-2 text-xs font-medium whitespace-nowrap"
                              style={{ color: 'var(--ink-muted)' }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o) => (
                          <tr key={o.id} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                              {formatDateTime(o.createdAt)}
                            </td>
                            <td className="px-5 py-2.5 whitespace-nowrap">{ORDER_STATUS_LABELS[o.status] || o.status}</td>
                            <td className="px-5 py-2.5 font-mono whitespace-nowrap">{formatMoney(o.totalAmount)} грн</td>
                            <td className="px-5 py-2.5 text-right whitespace-nowrap">
                              <Link
                                href="/admin/orders"
                                className="text-xs px-3 py-1 rounded-md font-medium"
                                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                              >
                                Все заказы →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
