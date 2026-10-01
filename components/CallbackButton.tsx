'use client';

// ============================================================
// Плавающая кнопка "Передзвоніть мені" (слева внизу экрана, на всех
// страницах витрины). Многие покупатели запчастей хотят сначала
// поговорить с человеком, а не оформлять заказ сами: оставляют телефон
// (имя и вопрос — по желанию), менеджер перезванивает.
//
// Заявка уходит в POST /api/vin-requests (callback: true) — видна в
// админке в разделе "VIN-запросы" с пометкой "📞 Дзвінок" и сразу
// приходит менеджеру в Telegram. Вместе с ней передаём, с какой
// страницы просили позвонить (например, карточка конкретного товара).
// На страницах админки кнопка не показывается.
// ============================================================

import { useState } from 'react';
import type { FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { Phone, X } from 'lucide-react';
import HoneypotField, { readHoneypot } from '@/components/HoneypotField';
import { readCheckoutMemory } from '@/lib/checkoutMemory';

const ACCENT = '#3B82F6';
const ACCENT_DIM = '#1D4ED8';
const INK = '#F1F5F9';
const MUTED = '#94A3B8';
const GOOD = '#34D399';
const BORDER_2 = 'rgba(255,255,255,0.14)';

export default function CallbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // В админке кнопка не нужна
  if (pathname?.startsWith('/admin')) return null;

  const openForm = () => {
    // Телефон и имя из прошлого заказа (lib/checkoutMemory.ts)
    const saved = readCheckoutMemory();
    if (saved?.customerPhone && !phone) setPhone(saved.customerPhone);
    if (saved?.customerName && !name) setName(saved.customerName);
    setSent(false);
    setError(null);
    setOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const honeypot = readHoneypot(event.currentTarget);
    setError(null);
    if (phone.replace(/\D/g, '').length < 9) {
      setError('Вкажіть номер телефону');
      return;
    }
    setSending(true);
    try {
      const response = await fetch('/api/vin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback: true,
          phone,
          name,
          description: question,
          pageUrl: window.location.pathname,
          pageTitle: document.title,
          website: honeypot,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');
      setSent(true);
      setQuestion('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі, спробуйте ще раз');
    } finally {
      setSending(false);
    }
  };

  const inputClass = 'w-full rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-[#54607A]';
  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER_2}`, color: INK };

  return (
    <>
      {/* Кнопка: слева внизу (справа — кнопка "Не знайшли?"). На телефоне
          чуть выше, чтобы не закрывать полосу "Купити" внизу карточки */}
      <button
        type="button"
        onClick={openForm}
        className="fixed bottom-24 left-4 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-lg md:bottom-6 md:left-6"
        style={{ background: GOOD, color: '#04110C', boxShadow: '0 0 0 1px rgba(52,211,153,0.5), 0 10px 30px rgba(16,185,129,0.35)' }}
        aria-label="Передзвоніть мені"
      >
        <Phone className="h-4 w-4" />
        <span className="hidden sm:inline">Передзвоніть мені</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0" style={{ background: 'rgba(11,15,23,0.78)' }} onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-5" style={{ background: '#1B2436', border: `1px solid ${BORDER_2}` }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 rounded-lg p-1.5 hover:bg-white/5"
              style={{ color: MUTED }}
              aria-label="Закрити"
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="mb-1 text-lg font-semibold" style={{ color: '#fff' }}>
              Передзвонимо вам
            </h2>
            {sent ? (
              <p className="mt-3 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(52,211,153,0.12)', color: GOOD }}>
                ✓ Дякуємо! Менеджер зателефонує вам найближчим часом у робочий час.
              </p>
            ) : (
              <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2.5">
                <HoneypotField />
                <p className="text-xs" style={{ color: MUTED }}>
                  Залиште номер — допоможемо підібрати деталь, розповімо про наявність і доставку.
                </p>
                <input type="tel" placeholder="Телефон *" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} style={inputStyle} autoFocus />
                <input type="text" placeholder="Ім'я (необов'язково)" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} />
                <input
                  type="text"
                  placeholder="Що шукаєте? (необов'язково)"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
                {error && (
                  <p className="text-xs" style={{ color: '#FCA5A5' }}>
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={sending}
                  className="rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
                  style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DIM})`, color: '#fff' }}
                >
                  {sending ? 'Надсилаємо...' : 'Передзвоніть мені'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
