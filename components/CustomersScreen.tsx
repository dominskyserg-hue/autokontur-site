'use client';

// ============================================================
// Экран "Клиенты" — список покупателей с текущим балансом
// (customers.balance — кэш поверх леджера customer_transactions,
// см. секцию 28 schema.sql). Сами записи в customers появляются
// автоматически при оформлении заказа на витрине
// (app/api/orders/create/route.ts) — здесь их смотрят, ищут,
// принимают оплату и переходят в карточку клиента для деталей.
//
// Для ежедневной работы с долгами:
//   - итог наверху: сколько всего клиенты должны и сколько предоплат;
//   - кнопка "Только должники" и сортировка "Сначала большие долги";
//   - кнопка "Принять оплату" прямо в строке клиента — сумма сама
//     раскладывается по неоплаченным заказам (см.
//     app/api/admin/customers/[id]/payment/route.ts).
//
// Использует эндпоинты:
//   GET  /api/admin/customers?search=...&debtorsOnly=1&sort=debt
//   GET  /api/admin/cash-registers?activeOnly=1
//   POST /api/admin/customers/[id]/payment
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import AdminLayout from './AdminLayout';

interface CustomerListItem {
  id: string;
  phone: string;
  name: string;
  surname: string | null;
  email: string | null;
  balance: number;
  orderCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerTotals {
  totalDebt: number;
  debtorsCount: number;
  totalPrepaid: number;
}

interface CashRegisterOption {
  id: string;
  name: string;
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputStyle = { border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' };

// ============================================================
// ОКНО "ПРИНЯТЬ ОПЛАТУ"
// ============================================================
function PaymentDialog({
  customer,
  onClose,
  onPaid,
}: {
  customer: CustomerListItem;
  onClose: () => void;
  onPaid: (message: string) => void;
}) {
  const [registers, setRegisters] = useState<CashRegisterOption[]>([]);
  const [registerId, setRegisterId] = useState('');
  // Если клиент должен — сразу подставляем сумму долга, чаще всего
  // платят именно её. Если не должен — поле пустое
  const [amount, setAmount] = useState(customer.balance > 0 ? String(customer.balance) : '');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/cash-registers?activeOnly=1')
      .then((response) => response.json())
      .then((data) => {
        const list = (data.registers || []) as CashRegisterOption[];
        setRegisters(list);
        if (list.length > 0) setRegisterId(list[0].id);
      })
      .catch(() => setError('Не удалось загрузить список касс'));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsed = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Сумма должна быть положительным числом');
      return;
    }
    if (!registerId) {
      setError('Выберите кассу. Если касс нет — создайте её в разделе «Кассы и счета»');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/customers/${customer.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashRegisterId: registerId, amount: parsed, comment: comment || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось провести платёж');

      // Короткий понятный итог: на какие заказы легли деньги
      const parts = (data.allocations as { orderNumber: number | null; amount: number }[]).map((part) =>
        part.orderNumber ? `заказ №${part.orderNumber} — ${formatMoney(part.amount)} грн` : `предоплата — ${formatMoney(part.amount)} грн`
      );
      onPaid(`${customer.name}: принято ${formatMoney(parsed)} грн (${parts.join('; ')})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сети');
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
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg p-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        // stopPropagation — клик внутри окна не должен его закрывать
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-1">Принять оплату</h2>
        <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>
          {customer.name} {customer.surname || ''} · {customer.phone}
          <br />
          {customer.balance > 0
            ? `Долг сейчас: ${formatMoney(customer.balance)} грн`
            : customer.balance < 0
              ? `Предоплата сейчас: ${formatMoney(-customer.balance)} грн`
              : 'Долга нет'}
        </p>

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
          Сумма, грн
        </label>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          className="w-full px-3 py-2 text-sm rounded-md font-mono mb-3"
          style={inputStyle}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
          Касса / счёт
        </label>
        <select
          className="w-full px-3 py-2 text-sm rounded-md mb-3"
          style={inputStyle}
          value={registerId}
          onChange={(e) => setRegisterId(e.target.value)}
        >
          {registers.length === 0 && <option value="">Нет активных касс</option>}
          {registers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
          Комментарий
        </label>
        <input
          type="text"
          className="w-full px-3 py-2 text-sm rounded-md mb-3"
          style={inputStyle}
          placeholder="необязательно"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <p className="text-[11px] mb-3" style={{ color: 'var(--ink-faint)' }}>
          Деньги автоматически закроют неоплаченные заказы клиента — начиная с самого старого. Если останется лишнее, оно
          запишется как предоплата.
        </p>

        {error && (
          <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md text-sm"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--good)', color: '#fff' }}
          >
            {saving ? 'Проводим...' : 'Принять оплату'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================
// ОСНОВНОЙ ЭКРАН
// ============================================================
export default function CustomersScreen() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [totals, setTotals] = useState<CustomerTotals | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debtorsOnly, setDebtorsOnly] = useState(false);
  const [sortByDebt, setSortByDebt] = useState(false);

  // ---- окно оплаты и сообщение об успешном платеже ----
  const [payingCustomer, setPayingCustomer] = useState<CustomerListItem | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);

  const fetchCustomers = useCallback(async (searchTerm: string, onlyDebtors: boolean, byDebt: boolean) => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (onlyDebtors) params.set('debtorsOnly', '1');
      if (byDebt) params.set('sort', 'debt');
      const response = await fetch(`/api/admin/customers?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить список клиентов');
      }
      setCustomers(data.customers as CustomerListItem[]);
      setTotals((data.totals as CustomerTotals) || null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке клиентов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Дебаунс поиска — не дёргаем API на каждое нажатие клавиши,
    // а ждём паузу в 350мс после того, как пользователь перестал печатать
    const timeout = setTimeout(() => fetchCustomers(search, debtorsOnly, sortByDebt), 350);
    return () => clearTimeout(timeout);
  }, [search, debtorsOnly, sortByDebt, fetchCustomers]);

  const toggleButtonStyle = (isActive: boolean) => ({
    border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--line)'),
    background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
    color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
  });

  return (
    <AdminLayout active="customers">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Клиенты
      </p>
      <h1 className="text-2xl font-semibold mb-1">Клиенты</h1>
      <p className="text-sm mb-5" style={{ color: 'var(--ink-muted)' }}>
        Баланс: зелёный — у клиента предоплата, красный — клиент должен нам. Нажмите «Открыть», чтобы увидеть ленту
        операций, или «Принять оплату», чтобы сразу провести платёж.
      </p>

      {/* ==================== ИТОГИ ==================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Клиенты должны нам
          </p>
          <p className="text-xl font-semibold" style={{ color: totals && totals.totalDebt > 0 ? 'var(--bad)' : 'var(--ink)' }}>
            {totals ? `${formatMoney(totals.totalDebt)} грн` : '—'}
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            {totals ? `должников: ${totals.debtorsCount}` : ''}
          </p>
        </div>
        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Предоплаты клиентов у нас
          </p>
          <p className="text-xl font-semibold" style={{ color: 'var(--good)' }}>
            {totals ? `${formatMoney(totals.totalPrepaid)} грн` : '—'}
          </p>
        </div>
      </div>

      {/* ==================== ПОИСК И ФИЛЬТРЫ ==================== */}
      <div className="flex flex-wrap gap-2 items-center mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по телефону или имени..."
          className="w-full max-w-sm px-3 py-2 text-sm rounded-md"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => setDebtorsOnly((v) => !v)}
          className="text-xs px-3 py-2 rounded-full font-medium"
          style={toggleButtonStyle(debtorsOnly)}
        >
          Только должники
        </button>
        <button
          type="button"
          onClick={() => setSortByDebt((v) => !v)}
          className="text-xs px-3 py-2 rounded-full font-medium"
          style={toggleButtonStyle(sortByDebt)}
        >
          Сначала большие долги
        </button>
      </div>

      {paymentMessage && (
        <p className="text-sm p-3 rounded-lg mb-5" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
          {paymentMessage}{' '}
          <button type="button" onClick={() => setPaymentMessage(null)} className="underline text-xs">
            скрыть
          </button>
        </p>
      )}

      {loadError && (
        <p className="text-sm p-3 rounded-lg mb-5" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loading && customers.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            {search || debtorsOnly
              ? 'Ничего не найдено.'
              : 'Клиентов пока нет — появятся после первого заказа с витрины.'}
          </p>
        )}

        {!loading && customers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Имя', 'Телефон', 'Заказов', 'Баланс', ''].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-4 py-2.5 text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.name} {c.surname || ''}
                    </td>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">{c.phone}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                      {c.orderCount}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {c.balance === 0 ? (
                        <span style={{ color: 'var(--ink-faint)' }}>0</span>
                      ) : (
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium"
                          style={
                            c.balance > 0
                              ? { background: 'var(--bad-soft)', color: 'var(--bad)' }
                              : { background: 'var(--good-soft)', color: 'var(--good)' }
                          }
                        >
                          {c.balance > 0
                            ? `Должен ${formatMoney(c.balance)} грн`
                            : `Предоплата ${formatMoney(-c.balance)} грн`}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setPayingCustomer(c)}
                          className="text-xs px-3 py-1.5 rounded-md font-medium"
                          style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                        >
                          Принять оплату
                        </button>
                        <Link
                          href={`/admin/customers/${c.id}`}
                          className="text-xs px-3 py-1.5 rounded-md font-medium"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          Открыть →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {payingCustomer && (
        <PaymentDialog
          customer={payingCustomer}
          onClose={() => setPayingCustomer(null)}
          onPaid={(message) => {
            setPayingCustomer(null);
            setPaymentMessage(message);
            fetchCustomers(search, debtorsOnly, sortByDebt);
          }}
        />
      )}
    </AdminLayout>
  );
}
