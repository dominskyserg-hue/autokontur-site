'use client';

// ============================================================
// Форма "Де моє замовлення?" — покупатель вводит номер заказа и телефон
// и видит статус, состав заказа, номер ТТН и где сейчас посылка.
// Данные — из POST /api/order-status (app/api/order-status/route.ts).
// Страница: app/zamovlennia/page.tsx. Номер заказа можно передать в
// адресе: /zamovlennia?n=142 — тогда поле уже заполнено (так ссылка
// открывается из экрана "Дякуємо за замовлення").
// ============================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  TECH_ACCENT,
  TECH_ACCENT_BRIGHT,
  TECH_ACCENT_DIM,
  TECH_BORDER,
  TECH_BORDER_2,
  TECH_DISPLAY_FONT,
  TECH_FAINT,
  TECH_GLOW,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_HEAT,
  TECH_HEAT_SOFT,
  TECH_INK,
  TECH_MONO_FONT,
  TECH_MUTED,
  TECH_SURFACE_2,
} from '@/lib/techTheme';

// Текст-заглушка, который ставит "Купити в 1 клік" вместо города и
// отделения (components/QuickOrderModal.tsx) — такой адрес не показываем
const PENDING_NOTE = 'Уточнити при дзвінку менеджера';

interface OrderStatusData {
  orderNumber: number;
  status: string;
  statusLabel: string;
  createdAt: string;
  city: string | null;
  novaPoshtaAddress: string | null;
  items: { article: string; brand: string | null; name: string | null; price: number; quantity: number }[];
  totalAmount: number;
  ttnNumber: string | null;
  tracking: { statusText: string; kind: string; warehouse: string | null; scheduledDelivery: string | null } | null;
}

// Шаги заказа — для полоски прогресса
const STEPS: { key: string; label: string }[] = [
  { key: 'new', label: 'Прийнято' },
  { key: 'processing', label: 'В обробці' },
  { key: 'in_stock', label: 'Готуємо до відправки' },
  { key: 'shipped', label: 'Відправлено' },
];

// На каком шаге заказ (ordered_from_supplier — тоже "в обработке",
// ready_for_pickup — "готовим к отправке")
function stepIndex(status: string): number {
  switch (status) {
    case 'new':
      return 0;
    case 'processing':
    case 'ordered_from_supplier':
      return 1;
    case 'in_stock':
    case 'ready_for_pickup':
      return 2;
    case 'shipped':
      return 3;
    default:
      return -1;
  }
}

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function OrderStatusLookup({ initialOrderNumber = '' }: { initialOrderNumber?: string }) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderStatusData | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setOrder(null);
    if (!orderNumber.replace(/\D/g, '')) {
      setError('Вкажіть номер замовлення');
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      setError('Вкажіть номер телефону, який ви залишали при замовленні');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/order-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося знайти замовлення');
      setOrder(data.order as OrderStatusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі, спробуйте ще раз');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${TECH_BORDER_2}`,
    color: TECH_INK,
  };

  const currentStep = order ? stepIndex(order.status) : -1;
  const showAddress = order && order.city && order.city !== PENDING_NOTE;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-2xl p-5 sm:flex-row sm:items-end"
        style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
      >
        <label className="flex flex-1 flex-col gap-1.5 text-xs" style={{ color: TECH_MUTED }}>
          Номер замовлення
          <input
            type="text"
            inputMode="numeric"
            placeholder="напр. 142"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className="rounded-xl px-3.5 py-2.5 text-sm outline-none"
            style={{ ...inputStyle, fontFamily: TECH_MONO_FONT }}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-xs" style={{ color: TECH_MUTED }}>
          Телефон
          <input
            type="tel"
            placeholder="+380 __ ___ __ __"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-xl px-3.5 py-2.5 text-sm outline-none"
            style={{ ...inputStyle, fontFamily: TECH_MONO_FONT }}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl px-6 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
        >
          {loading ? 'Шукаємо...' : 'Перевірити'}
        </button>
      </form>

      {error && (
        <p
          className="rounded-xl p-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}
        >
          {error}
        </p>
      )}

      {order && (
        <section className="rounded-2xl p-5" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
              Замовлення №{order.orderNumber}
            </h2>
            <span className="text-xs" style={{ color: TECH_FAINT }}>
              від {formatDate(order.createdAt)}
            </span>
          </div>

          {/* Статус словами */}
          <p
            className="mb-4 inline-block rounded-full px-3 py-1.5 text-sm font-semibold"
            style={
              order.status === 'cancelled'
                ? { background: 'rgba(239,68,68,0.14)', color: '#FCA5A5' }
                : order.status === 'shipped'
                  ? { background: TECH_GOOD_SOFT, color: TECH_GOOD }
                  : { background: TECH_HEAT_SOFT, color: TECH_HEAT }
            }
          >
            {order.statusLabel}
          </p>

          {/* Полоска прогресса: Прийнято → В обробці → Готуємо → Відправлено */}
          {currentStep >= 0 && (
            <ol className="mb-5 grid grid-cols-4 gap-1.5">
              {STEPS.map((step, index) => (
                <li key={step.key} className="flex flex-col gap-1.5">
                  <span
                    className="h-1.5 rounded-full"
                    style={{ background: index <= currentStep ? TECH_GOOD : 'rgba(255,255,255,0.08)' }}
                  />
                  <span className="text-[11px] leading-tight" style={{ color: index <= currentStep ? TECH_INK : TECH_FAINT }}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* ТТН и где посылка */}
          {order.ttnNumber && (
            <div className="mb-5 rounded-xl p-3.5 text-sm" style={{ border: `1px solid ${TECH_BORDER}` }}>
              <div className="mb-1" style={{ color: TECH_MUTED }}>
                ТТН Нової Пошти:{' '}
                <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_INK }}>{order.ttnNumber}</span>
              </div>
              {order.tracking && (
                <div style={{ color: order.tracking.kind === 'problem' ? '#FCA5A5' : TECH_GOOD }}>
                  {order.tracking.statusText}
                  {order.tracking.warehouse ? ` · ${order.tracking.warehouse}` : ''}
                </div>
              )}
              <a
                href={`https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(order.ttnNumber)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs underline"
                style={{ color: TECH_ACCENT_BRIGHT }}
              >
                Відстежити на сайті Нової Пошти →
              </a>
            </div>
          )}

          {showAddress && (
            <p className="mb-4 text-sm" style={{ color: TECH_MUTED }}>
              Доставка: {order.city}, {order.novaPoshtaAddress}
            </p>
          )}

          {/* Состав заказа */}
          <ul className="flex flex-col">
            {order.items.map((item, index) => (
              <li
                key={`${item.article}-${index}`}
                className="flex items-start justify-between gap-3 py-2.5 text-sm"
                style={{ borderTop: index > 0 ? `1px solid ${TECH_BORDER}` : 'none' }}
              >
                <span>
                  <span style={{ color: TECH_INK }}>{item.name || item.article}</span>
                  <span className="block text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                    {[item.brand, item.article].filter(Boolean).join(' · ')} · {item.quantity} шт
                  </span>
                </span>
                <span className="whitespace-nowrap font-semibold" style={{ color: '#fff' }}>
                  {formatMoney(item.price * item.quantity)} грн
                </span>
              </li>
            ))}
          </ul>
          <div
            className="mt-2 flex justify-between pt-3 text-base font-semibold"
            style={{ borderTop: `1px solid ${TECH_BORDER}`, color: '#fff' }}
          >
            <span>Разом</span>
            <span>{formatMoney(order.totalAmount)} грн</span>
          </div>
        </section>
      )}
    </div>
  );
}
