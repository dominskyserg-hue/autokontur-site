'use client';

// ============================================================
// Экран "Скидки и наценки клиентам" — персональные правила цены для
// покупателя по номеру телефона (customer_pricing_rules). Правило
// применяется АВТОМАТИЧЕСКИ при оформлении заказа
// (app/api/orders/create/route.ts), как только покупатель укажет тот
// же номер телефона, что и здесь — без промокода и без личного
// кабинета/пароля (на этом сайте покупатель вообще не заводит
// аккаунт, см. components/CustomerDashboard.tsx).
//
// У одного телефона одновременно может быть только ОДНО правило —
// либо скидка, либо наценка (rule_type), не обе сразу.
//
// Использует эндпоинты:
//   GET    /api/admin/customer-pricing-rules          — список
//   POST   /api/admin/customer-pricing-rules          — назначить (создать/обновить)
//   DELETE /api/admin/customer-pricing-rules/[phone]  — снять правило
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';

type RuleType = 'discount' | 'markup';

interface CustomerPricingRule {
  phone: string;
  ruleType: RuleType;
  percent: number;
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

export default function CustomerPricingRulesScreen() {
  const [rules, setRules] = useState<CustomerPricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [ruleType, setRuleType] = useState<RuleType>('discount');
  const [percent, setPercent] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingPhone, setDeletingPhone] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/customer-pricing-rules');
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить список правил');
      }
      setRules(data.rules as CustomerPricingRule[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке правил');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const parsedPercent = parseFloat(percent);
    if (!phone.trim()) {
      setFormError('Укажите номер телефона покупателя');
      return;
    }
    if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
      setFormError('Процент должен быть положительным числом');
      return;
    }
    if (ruleType === 'discount' && parsedPercent > 100) {
      setFormError('Скидка не может быть больше 100%');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/admin/customer-pricing-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, ruleType, percent: parsedPercent, note: note || undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось назначить правило');
      }

      setPhone('');
      setPercent('');
      setNote('');
      setRuleType('discount');
      await fetchRules();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Ошибка сети при сохранении правила');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (targetPhone: string) => {
    setDeletingPhone(targetPhone);
    try {
      const response = await fetch(`/api/admin/customer-pricing-rules/${targetPhone}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось удалить правило');
      }
      setRules((prev) => prev.filter((r) => r.phone !== targetPhone));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при удалении правила');
    } finally {
      setDeletingPhone(null);
    }
  };

  return (
    <AdminLayout active="customerDiscounts">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Скидки и наценки клиентам
      </p>
      <h1 className="text-2xl font-semibold mb-1">Скидки и наценки клиентам</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Персональное правило цены по номеру телефона — применяется автоматически при оформлении
        заказа, как только покупатель укажет тот же номер. Промокод вводить не нужно.
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
        <div className="w-40">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Тип
          </label>
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as RuleType)}
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          >
            <option value="discount">Скидка</option>
            <option value="markup">Наценка</option>
          </select>
        </div>
        <div className="w-32">
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Процент, %
          </label>
          <input
            type="number"
            min={0}
            max={ruleType === 'discount' ? 100 : undefined}
            step={0.5}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
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

        {!loading && rules.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Правил пока не назначено.
          </p>
        )}

        {!loading && rules.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Телефон', 'Правило', 'Заметка', 'Обновлено', ''].map((heading) => (
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
                {rules.map((r) => (
                  <tr key={r.phone} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-3 font-mono whitespace-nowrap">{r.phone}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="text-xs px-2 py-1 rounded-full font-medium"
                        style={
                          r.ruleType === 'discount'
                            ? { background: 'var(--good-soft)', color: 'var(--good)' }
                            : { background: 'var(--warn-soft)', color: 'var(--warn)' }
                        }
                      >
                        {r.ruleType === 'discount' ? `Скидка -${r.percent}%` : `Наценка +${r.percent}%`}
                      </span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                      {r.note || '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                      {formatDateTime(r.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={deletingPhone === r.phone}
                        onClick={() => handleDelete(r.phone)}
                        className="text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
                        style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}
                      >
                        {deletingPhone === r.phone ? 'Удаление...' : 'Снять'}
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
