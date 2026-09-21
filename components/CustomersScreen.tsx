'use client';

// ============================================================
// Экран "Клиенты" — список покупателей с текущим балансом
// (customers.balance — кэш поверх леджера customer_transactions,
// см. секцию 28 schema.sql). Сами записи в customers появляются
// автоматически при оформлении заказа на витрине
// (app/api/orders/create/route.ts) — здесь их только смотрят,
// ищут и переходят в карточку клиента для деталей/операций.
//
// Использует эндпоинт:
//   GET /api/admin/customers?search=...
// ============================================================

import { useCallback, useEffect, useState } from 'react';
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

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomersScreen() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchCustomers = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const url = searchTerm ? `/api/admin/customers?search=${encodeURIComponent(searchTerm)}` : '/api/admin/customers';
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить список клиентов');
      }
      setCustomers(data.customers as CustomerListItem[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке клиентов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Дебаунс поиска — не дёргаем API на каждое нажатие клавиши,
    // а ждём паузу в 350мс после того, как пользователь перестал печатать
    const timeout = setTimeout(() => fetchCustomers(search), 350);
    return () => clearTimeout(timeout);
  }, [search, fetchCustomers]);

  return (
    <AdminLayout active="customers">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Клиенты
      </p>
      <h1 className="text-2xl font-semibold mb-1">Клиенты</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Баланс: зелёный — у клиента предоплата, красный — клиент должен нам. Нажмите на клиента, чтобы
        увидеть ленту операций и записать новую.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Поиск по телефону или имени..."
        className="w-full max-w-sm px-3 py-2 text-sm rounded-md mb-5"
        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
      />

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
            {search ? 'Ничего не найдено.' : 'Клиентов пока нет — появятся после первого заказа с витрины.'}
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
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="text-xs px-3 py-1.5 rounded-md font-medium"
                        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        Открыть →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
