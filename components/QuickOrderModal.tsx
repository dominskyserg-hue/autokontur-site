'use client';

// ============================================================
// Кнопка + модальне вікно "Купити в 1 клік" для сторінки товару.
//
// Покупець залишає лише ім'я і телефон — доставку, оплату і (за
// потреби) VIN менеджер уточнює вже під час дзвінка. Це РЕАЛЬНЕ
// замовлення, а не заглушка: воно йде через той самий
// POST /api/orders/create, яким користується кошик на Головній
// (components/StorefrontHome.tsx), і одразу з'являється в адмінці
// на екрані "Заказы".
//
// Бекенд вимагає city і novaPoshtaAddress як обов'язкові поля (див.
// app/api/orders/create/route.ts) — жодної реальної адреси на цьому
// етапі ще немає, тому замість вигаданої адреси чесно пишемо туди
// позначку "Уточнити при дзвінку менеджера": менеджер одразу побачить
// у заказі, що це "швидке" замовлення, і сам зателефонує уточнити
// деталі доставки.
//
// Компонент навмисно самодостатній (сам зберігає open/close-стан і
// малює кнопку-тригер) — той самий підхід, що і в
// components/AddToCartButton.tsx: не пов'язувати цю одну кнопку з
// усім ProductDetailContent, а тримати логіку локально.
//
// Стильова палітра — та сама темна "Tech Premium", що і в
// CartDrawer/VIN-модалці на Головній (components/StorefrontHome.tsx).
// Константи кольорів тут продубльовано (а не імпортовано з того
// файлу) — навмисно, з тієї ж причини, що описана в коментарі на
// початку AddToCartButton.tsx: тягнути сюди весь StorefrontHome
// заради кількох hex-кодів дорожче, ніж повторити рядок.
// ============================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { trackBeginCheckout, trackPurchase } from '@/lib/analytics';

const TECH_SURFACE_2 = '#1B2436';
const TECH_BORDER = 'rgba(255,255,255,0.08)';
const TECH_BORDER_2 = 'rgba(255,255,255,0.14)';
const TECH_ACCENT = '#3B82F6';
const TECH_ACCENT_BRIGHT = '#60A5FA';
const TECH_ACCENT_DIM = '#1D4ED8';
const TECH_INK = '#F1F5F9';
const TECH_MUTED = '#94A3B8';
const TECH_FAINT = '#54607A';
const TECH_GOOD = '#34D399';
const TECH_GOOD_SOFT = 'rgba(52,211,153,0.14)';
const TECH_GLOW = '0 0 0 1px rgba(59,130,246,0.4), 0 0 24px 2px rgba(59,130,246,0.35)';
const TECH_GLOW_LG = '0 0 0 1px rgba(59,130,246,0.5), 0 0 44px 6px rgba(59,130,246,0.28)';
const DISPLAY_FONT_TECH = 'var(--font-space-grotesk), "Space Grotesk", sans-serif';
const SANS_TECH = 'var(--font-inter-tech), Inter, sans-serif';

// Адреса на цьому кроці ще невідома — чесна позначка для менеджера,
// а не вигадана адреса. Використовується і для city, і для
// novaPoshtaAddress, бо обидва поля обов'язкові на бекенді
const PENDING_NOTE = 'Уточнити при дзвінку менеджера';

// Та сама перевірка, що і на Головній (components/StorefrontHome.tsx,
// isValidPhone) і на бекенді (app/api/orders/create/route.ts) —
// продубльована тут з тієї ж причини, що й кольори вище
function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

interface QuickOrderModalProps {
  product: {
    id: string;
    article: string;
    brand: string | null;
    name: string | null;
    retailPrice: number;
  };
}

export default function QuickOrderModal({ product }: QuickOrderModalProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);

  const displayName = product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ');

  const nameError = touched && name.trim().length === 0 ? "Введіть ваше ім'я" : null;
  const phoneError = touched && !isValidPhone(phone) ? 'Введіть коректний номер телефону' : null;

  const close = () => {
    setOpen(false);
    // Скидаємо форму й статус з невеликою затримкою, щоб покупач не
    // побачив, як поля порожніють ще до завершення анімації закриття
    setTimeout(() => {
      setName('');
      setPhone('');
      setTouched(false);
      setStatus('idle');
      setError(null);
    }, 200);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (name.trim().length === 0 || !isValidPhone(phone)) return;

    setStatus('submitting');
    setError(null);

    trackBeginCheckout([{ id: product.id, name: displayName, brand: product.brand, price: product.retailPrice, quantity: 1 }]);

    // Бекенд вимагає ім'я І прізвище окремо (customerName/customerSurname
    // NOT NULL) — а швидка форма навмисно просить лише одне поле "Ім'я"
    // (саме так, як просив клієнт: мінімум тертя). Якщо покупець ввів
    // кілька слів, друге й далі йде як прізвище; якщо слово одне —
    // дублюємо його ж, аби не городити ще одне поле заради валідації,
    // якої покупець на цьому кроці не бачить сенсу заповнювати
    const parts = name.trim().split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: firstName,
          customerSurname: lastName,
          customerPhone: phone.trim(),
          city: PENDING_NOTE,
          novaPoshtaAddress: PENDING_NOTE,
          comment: 'Замовлення оформлено через "Купити в 1 клік" — уточнити спосіб доставки та оплати під час дзвінка.',
          items: [{ id: product.id, count: 1 }],
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося оформити замовлення');
      }

      trackPurchase(data.orderId, [{ id: product.id, name: displayName, brand: product.brand, price: product.retailPrice, quantity: 1 }]);
      setStatus('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі під час оформлення замовлення');
      setStatus('idle');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-colors hover:bg-[rgba(59,130,246,0.08)]"
        style={{ fontFamily: SANS_TECH, border: '1.5px solid rgba(59,130,246,0.5)', color: TECH_ACCENT_BRIGHT }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 2 3 14h7l-1 8 11-14h-7l1-8Z" />
        </svg>
        Купити в 1 клік
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'rgba(11,15,23,0.78)' }} onClick={close} />

          <div
            className="relative w-full max-w-sm overflow-hidden rounded-2xl"
            style={{ background: TECH_SURFACE_2, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${TECH_BORDER_2}`, boxShadow: TECH_GLOW_LG }}
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${TECH_BORDER}` }}>
              <h2 style={{ fontFamily: DISPLAY_FONT_TECH, fontWeight: 600, fontSize: 17, color: '#fff' }}>
                Купити в 1 клік
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Закрити"
                className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
                style={{ color: TECH_FAINT }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {status === 'success' ? (
              <div className="flex flex-col items-center px-8 py-10 text-center">
                <div
                  className="mb-5 flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ background: TECH_GOOD_SOFT, color: TECH_GOOD, boxShadow: '0 0 0 1px rgba(52,211,153,0.25), 0 0 24px -4px rgba(52,211,153,0.6)' }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="mb-2 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT_TECH, color: '#fff' }}>
                  Заявку прийнято!
                </h3>
                <p className="mb-6 text-sm leading-relaxed" style={{ fontFamily: SANS_TECH, color: TECH_MUTED }}>
                  Наш менеджер зателефонує вам найближчим часом, щоб уточнити доставку і оформити відправлення.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-xl px-6 py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg"
                  style={{ fontFamily: SANS_TECH, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
                >
                  Закрити
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-5">
                <p className="text-xs leading-relaxed" style={{ fontFamily: SANS_TECH, color: TECH_MUTED }}>
                  Залиште ім&apos;я і телефон — менеджер сам зателефонує, уточнить доставку і оплату для «{displayName}».
                </p>

                <div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Як до вас звертатись?"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
                    style={{ fontFamily: SANS_TECH, background: 'rgba(255,255,255,0.04)', border: `1px solid ${nameError ? 'rgba(239,68,68,0.55)' : TECH_BORDER_2}`, color: TECH_INK }}
                  />
                  {nameError && (
                    <p className="mt-1 text-xs" style={{ color: '#FCA5A5' }}>
                      {nameError}
                    </p>
                  )}
                </div>

                <div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+380 __ ___ __ __"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
                    style={{
                      fontFamily: 'var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace',
                      background: 'rgba(255,255,255,0.04)',
                      border: `1px solid ${phoneError ? 'rgba(239,68,68,0.55)' : TECH_BORDER_2}`,
                      color: TECH_INK,
                    }}
                  />
                  {phoneError && (
                    <p className="mt-1 text-xs" style={{ color: '#FCA5A5' }}>
                      {phoneError}
                    </p>
                  )}
                </div>

                {error && (
                  <p
                    className="rounded-lg p-2.5 text-xs"
                    style={{ fontFamily: SANS_TECH, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={status === 'submitting'}
                  className="mt-1 w-full rounded-xl py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg disabled:opacity-50 disabled:shadow-none"
                  style={{ fontFamily: SANS_TECH, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
                >
                  {status === 'submitting' ? 'Надсилаємо...' : 'Замовити дзвінок'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
