'use client';

// ============================================================
// Экран "Финансы поставщика" — долг перед поставщиком
// (suppliers.balance — кэш поверх леджера supplier_transactions,
// секция 28 schema.sql), лента операций, список приходных накладных
// и формы записи новой накладной / оплаты.
//
// Использует эндпоинты:
//   GET  /api/admin/suppliers/[id]/finance
//   POST /api/admin/suppliers/[id]/invoices      — новая накладная (приход)
//   POST /api/admin/suppliers/[id]/transactions  — оплата / корректировка
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import AdminLayout from './AdminLayout';

interface SupplierFinance {
  id: string;
  name: string;
  balance: number;
}

interface SupplierTransaction {
  id: string;
  amount: number;
  type: string;
  invoiceId: string | null;
  returnId: string | null;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface SupplierInvoice {
  id: string;
  invoiceNumber: string | null;
  totalAmount: number;
  orderId: string | null;
  comment: string | null;
  createdAt: string;
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  goods_received: 'Приход товара',
  payment_out: 'Оплата поставщику',
  supplier_return: 'Возврат поставщику',
  adjustment: 'Корректировка',
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

type FormMode = 'invoice' | 'payment' | 'adjustment' | 'return';

// Для выпадающего списка "касса" при оплате поставщику (секция 29
// schema.sql) — баланс показываем прямо в списке
interface CashRegisterOption {
  id: string;
  name: string;
  balance: number;
}

export default function SupplierFinanceScreen({ supplierId }: { supplierId: string }) {
  const [supplier, setSupplier] = useState<SupplierFinance | null>(null);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма ----
  const [formMode, setFormMode] = useState<FormMode>('invoice');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<'increase' | 'decrease'>('decrease');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ---- касса для реальной выплаты (formMode === 'payment') ----
  const [cashRegisters, setCashRegisters] = useState<CashRegisterOption[]>([]);
  const [paymentCashRegisterId, setPaymentCashRegisterId] = useState('');

  useEffect(() => {
    fetch('/api/admin/cash-registers?activeOnly=1')
      .then((response) => response.json())
      .then((data) => {
        if (data.registers) setCashRegisters(data.registers as CashRegisterOption[]);
      })
      .catch(() => {
        // Форма оплаты без списка касс просто не даст выбрать кассу —
        // остальная часть экрана финансов остаётся рабочей
      });
  }, []);

  // ---- поля, нужные только для возврата поставщику (formMode === 'return') ----
  const [returnArticle, setReturnArticle] = useState('');
  const [returnQuantity, setReturnQuantity] = useState('');
  const [returnReason, setReturnReason] = useState<'defect' | 'unclaimed'>('defect');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/admin/suppliers/${supplierId}/finance`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить финансовые данные поставщика');
      }
      setSupplier(data.supplier as SupplierFinance);
      setTransactions(data.transactions as SupplierTransaction[]);
      setInvoices(data.invoices as SupplierInvoice[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке данных');
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    // Возврат поставщику устроен иначе остальных форм — вместо суммы
    // здесь артикул и количество (себестоимость сервер сам берёт из
    // каталога), поэтому у него своя ветка валидации и отправки
    if (formMode === 'return') {
      const quantity = parseInt(returnQuantity, 10);
      if (!returnArticle.trim()) {
        setFormError('Укажите артикул товара.');
        return;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        setFormError('Количество должно быть целым числом больше нуля.');
        return;
      }

      setSaving(true);
      try {
        const response = await fetch(`/api/admin/suppliers/${supplierId}/returns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            article: returnArticle.trim(),
            quantity,
            reason: returnReason,
            comment: comment || undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Не удалось оформить возврат');
        }

        setReturnArticle('');
        setReturnQuantity('');
        setComment('');
        await fetchData();
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Ошибка сети при оформлении возврата');
      } finally {
        setSaving(false);
      }
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Сумма должна быть положительным числом.');
      return;
    }
    if (formMode === 'adjustment' && !comment.trim()) {
      setFormError('Для ручной корректировки укажите комментарий.');
      return;
    }
    if (formMode === 'payment' && !paymentCashRegisterId) {
      setFormError('Выберите кассу, из которой выплачены деньги поставщику.');
      return;
    }

    setSaving(true);
    try {
      let response: Response;
      if (formMode === 'invoice') {
        response = await fetch(`/api/admin/suppliers/${supplierId}/invoices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceNumber: invoiceNumber || undefined,
            totalAmount: parsedAmount,
            comment: comment || undefined,
          }),
        });
      } else {
        // Оплата поставщику всегда уменьшает наш долг (амount отрицательный);
        // для корректировки направление выбирает администратор
        const signedAmount =
          formMode === 'adjustment' ? (adjustmentDirection === 'increase' ? parsedAmount : -parsedAmount) : -parsedAmount;
        response = await fetch(`/api/admin/suppliers/${supplierId}/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: formMode === 'payment' ? 'payment_out' : 'adjustment',
            amount: signedAmount,
            cashRegisterId: formMode === 'payment' ? paymentCashRegisterId : undefined,
            comment: comment || undefined,
          }),
        });
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось записать операцию');
      }

      setInvoiceNumber('');
      setAmount('');
      setComment('');
      setPaymentCashRegisterId('');
      await fetchData();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Ошибка сети при записи операции');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout active="suppliers">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        <Link href="/admin" className="underline">
          Поставщики
        </Link>{' '}
        /{' '}
        <Link href={`/admin/suppliers/${supplierId}`} className="underline">
          {supplier?.name || '...'}
        </Link>{' '}
        / Финансы
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

      {!loading && supplier && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h1 className="text-2xl font-semibold">Финансы: {supplier.name}</h1>

            <div
              className="px-5 py-3 rounded-lg text-right"
              style={
                supplier.balance === 0
                  ? { background: 'var(--surface-2)' }
                  : supplier.balance > 0
                    ? { background: 'var(--bad-soft)' }
                    : { background: 'var(--good-soft)' }
              }
            >
              <p className="text-xs mb-0.5" style={{ color: 'var(--ink-muted)' }}>
                {supplier.balance > 0 ? 'Мы должны поставщику' : supplier.balance < 0 ? 'У нас переплата' : 'Баланс'}
              </p>
              <p
                className="text-xl font-semibold"
                style={{ color: supplier.balance === 0 ? 'var(--ink)' : supplier.balance > 0 ? 'var(--bad)' : 'var(--good)' }}
              >
                {formatMoney(Math.abs(supplier.balance))} грн
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
                    value={formMode}
                    onChange={(e) => setFormMode(e.target.value as FormMode)}
                    className="w-full px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  >
                    <option value="invoice">Приходная накладная (увеличивает долг)</option>
                    <option value="payment">Оплата поставщику (уменьшает долг)</option>
                    <option value="return">Возврат поставщику (уменьшает долг)</option>
                    <option value="adjustment">Ручная корректировка</option>
                  </select>
                </div>

                {formMode === 'invoice' && (
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      Номер накладной (необязательно)
                    </label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="напр. НН-0123"
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    />
                  </div>
                )}

                {formMode === 'adjustment' && (
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      Направление
                    </label>
                    <select
                      value={adjustmentDirection}
                      onChange={(e) => setAdjustmentDirection(e.target.value as 'increase' | 'decrease')}
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    >
                      <option value="decrease">Уменьшает наш долг</option>
                      <option value="increase">Увеличивает наш долг</option>
                    </select>
                  </div>
                )}

                {formMode === 'return' ? (
                  <>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                        Артикул товара
                      </label>
                      <input
                        type="text"
                        value={returnArticle}
                        onChange={(e) => setReturnArticle(e.target.value)}
                        placeholder="напр. NIS540092S601"
                        className="w-full px-3 py-2 text-sm rounded-md font-mono"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      />
                      <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                        Себестоимость берётся из каталога этого поставщика автоматически.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                        Количество
                      </label>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={returnQuantity}
                        onChange={(e) => setReturnQuantity(e.target.value)}
                        placeholder="напр. 2"
                        className="w-full px-3 py-2 text-sm rounded-md font-mono"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                        Причина
                      </label>
                      <select
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value as 'defect' | 'unclaimed')}
                        className="w-full px-3 py-2 text-sm rounded-md"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      >
                        <option value="defect">Брак</option>
                        <option value="unclaimed">Невостребованное</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      Сумма, грн
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="напр. 15000"
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    />
                  </div>
                )}

                {formMode === 'payment' && (
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                      Касса
                    </label>
                    <select
                      value={paymentCashRegisterId}
                      onChange={(e) => setPaymentCashRegisterId(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    >
                      <option value="">Выберите кассу</option>
                      {cashRegisters.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.balance.toLocaleString('ru-RU')} ₴)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                    Комментарий {formMode === 'adjustment' ? '(обязательно)' : '(необязательно)'}
                  </label>
                  <input
                    type="text"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="напр. оплата за сентябрь"
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
                            <td className="px-5 py-2.5 whitespace-nowrap">{TRANSACTION_TYPE_LABELS[t.type] || t.type}</td>
                            <td
                              className="px-5 py-2.5 font-mono whitespace-nowrap"
                              style={{ color: t.amount > 0 ? 'var(--bad)' : 'var(--good)' }}
                            >
                              {t.amount > 0 ? '+' : ''}
                              {formatMoney(t.amount)}
                            </td>
                            <td className="px-5 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                              {t.comment || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* ==================== ПРИХОДНЫЕ НАКЛАДНЫЕ ==================== */}
              <section className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <h2 className="text-base font-semibold px-5 pt-4 pb-3">Приходные накладные</h2>
                {invoices.length === 0 ? (
                  <p className="text-xs px-5 pb-4" style={{ color: 'var(--ink-faint)' }}>
                    Накладных пока нет.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--line)' }}>
                          {['Дата', 'Номер', 'Сумма', 'Комментарий'].map((h) => (
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
                        {invoices.map((inv) => (
                          <tr key={inv.id} style={{ borderBottom: '1px solid var(--line)' }}>
                            <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                              {formatDateTime(inv.createdAt)}
                            </td>
                            <td className="px-5 py-2.5 font-mono whitespace-nowrap">{inv.invoiceNumber || '—'}</td>
                            <td className="px-5 py-2.5 font-mono whitespace-nowrap">{formatMoney(inv.totalAmount)} грн</td>
                            <td className="px-5 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                              {inv.comment || '—'}
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
