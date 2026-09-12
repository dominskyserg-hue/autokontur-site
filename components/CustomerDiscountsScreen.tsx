'use client';

// ============================================================
// Экран "Скидки клиентам" — персональные скидки покупателям по
// номеру телефона (customer_discounts). Скидка применяется
// АВТОМАТИЧЕСКИ при оформлении заказа (app/api/orders/create/route.ts),
// как только покупатель укажет тот же номер телефона, что и здесь —
// без промокода и без личного кабинета/пароля (на этом сайте
// покупатель вообще не заводит аккаунт, см. components/CustomerDashboard.tsx).
//
// Использует эндпоинты:
//   GET    /api/admin/customer-discounts          — список
//   POST   /api/admin/customer-discounts          — назначить (создать/обновить)
//   DELETE /api/admin/customer-discounts/[phone]  — снять скидку
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';

interface CustomerDiscount {
  phone: string;
  discountPercent: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
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

export default function CustomerDiscountsScreen() {
  const [discounts, setDiscounts] = useState<CustomerDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);

  const fetchDiscounts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/customer-discounts');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить список скидок');
      }
      setDiscounts(data.discounts as CustomerDiscount[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке скидок');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDiscounts();
  }, [fetchDiscounts]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsedDiscount = parseFloat(discountPercent);
    if (!phone.trim()) {
      setFormError('Укажите номер телефона покупателя');
      return;
    }
    if (!Number.isFinite(parsedDiscount) || parsedDiscount <= 0 || parsedDiscount > 100) {
      setFormError('Скидка должна быть числом от 0 до 100 (больше нуля)');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/admin/customer-discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, discountPercent: parsedDiscount, note: note || undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось назначить скидку');
      }

      setPhone('');
      setDiscountPercent('');
      setNote('');
      await fetchDiscounts();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Ошибка сети при сохранении скидки');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (targetPhone: string) => {
    setDeletingPhone(targetPhone);
    try {
      const response = await fetch(`/api/admin/customer-discounts/${targetPhone}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось удалить скидку');
      }
      setDiscounts((prev) => prev.filter((d) => d.phone !== targetPhone));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при удалении скидки');
    } finally {
      setDeletingPhone(null);
    }
  };

  return (
    <AdminLayout active="customerDiscounts">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Скидки клиентам
      </p>
      <h1 className="text-2xl font-semibold mb-1">Скидки клиентам</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Персональная скидка по номеру телефона — применяется автоматически при оформлении заказа,
        как только покупатель укажет тот же номер. Промокод вводить не нужно.
      </p>

      <form
        onSubmit={handleSubmit}
        className="p-4 rounded-lg mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Телефон покупателя
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="напр. 0501234567"
            className="w-full px-3 py-2 text-sm rounded-md font-mono"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          />
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Скидка, %
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            placeholder="10"
            className="w-full px-3 py-2 text-sm rounded-md font-mono"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Заметка (необязательно)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="напр. постоянный клиент"
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm rounded-md font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {saving ? 'Сохранение...' : 'Назначить'}
        </button>
      </form>

      {formError && (
        <p className="text-sm p-3 rounded-lg mb-5" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {formError}
        </p>
      )}
      {loadError && (
        <p className="text-sm p-3 rounded-lg mb-5" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        {loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loading && discounts.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Скидок пока не назначено.
          </p>
        )}

        {!loading && discounts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Телефон', 'Скидка', 'Заметка', 'Обновлено', ''].map((heading) => (
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
                {discounts.map((d) => (
                  <tr key={d.phone} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">{d.phone}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="text-xs px-2 py-1 rounded-full font-medium"
                        style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                      >
                        -{d.discountPercent}%
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                      {d.note || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                      {formatDateTime(d.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={deletingPhone === d.phone}
                        onClick={() => handleDelete(d.phone)}
                        className="text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
                        style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}
                      >
                        {deletingPhone === d.phone ? 'Удаление...' : 'Снять скидку'}
                      </button>
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
