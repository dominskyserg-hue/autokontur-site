'use client';

// ============================================================
// Форма "Не знайшли деталь?" — показывается прямо в пустом результате
// поиска на главной (components/StorefrontHome.tsx). Раньше покупатель,
// не найдя деталь, просто уходил; теперь он за 10 секунд оставляет
// телефон, а то, что он искал, уже подставлено.
//
// Заявка уходит в тот же POST /api/vin-requests, что и подбор по VIN
// (поле searchQuery), и попадает в раздел админки "VIN-запросы" с
// пометкой "🔍 Не знайдено на сайті". VIN здесь необязателен.
// Авто подставляется из "моє авто" (lib/myCar.ts), если оно сохранено.
// ============================================================

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import HoneypotField, { readHoneypot } from '@/components/HoneypotField';
import { myCarLabel, readMyCar } from '@/lib/myCar';

const ACCENT = '#3B82F6';
const ACCENT_DIM = '#1D4ED8';
const ACCENT_BRIGHT = '#60A5FA';
const INK = '#F1F5F9';
const MUTED = '#94A3B8';
const BORDER_2 = 'rgba(255,255,255,0.14)';
const GOOD = '#34D399';

export default function SearchNotFoundRequest({ query }: { query: string }) {
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [vin, setVin] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Авто из "моє авто", если покупатель его уже выбирал
  useEffect(() => {
    const saved = readMyCar();
    if (saved) setCar(myCarLabel(saved));
  }, []);

  // Новый поиск — новая заявка
  useEffect(() => {
    setSent(false);
    setError(null);
  }, [query]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const honeypot = readHoneypot(event.currentTarget);
    setError(null);
    if (phone.replace(/\D/g, '').length < 9) {
      setError('Вкажіть номер телефону, щоб менеджер міг з вами зв\'язатись');
      return;
    }

    setSending(true);
    try {
      const response = await fetch('/api/vin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchQuery: query,
          car,
          vinCode: vin,
          phone,
          description: comment,
          website: honeypot,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати заявку');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі, спробуйте ще раз');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <p className="mt-4 max-w-md rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(52,211,153,0.12)', color: GOOD }}>
        ✓ Заявку прийнято! Менеджер пошукає «{query}» у наших постачальників і зателефонує вам.
      </p>
    );
  }

  const inputClass = 'w-full rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-[#54607A]';
  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER_2}`, color: INK };

  return (
    <form onSubmit={handleSubmit} className="mt-5 grid w-full max-w-lg grid-cols-1 gap-2.5 text-left sm:grid-cols-2">
      <HoneypotField />
      <p className="text-sm font-semibold sm:col-span-2" style={{ color: '#fff' }}>
        Не знайшли? Залиште телефон — знайдемо деталь у постачальників і зателефонуємо
      </p>
      <input
        type="tel"
        placeholder="Телефон *"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className={inputClass}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Авто (марка, модель, рік)"
        value={car}
        onChange={(e) => setCar(e.target.value)}
        className={inputClass}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="VIN-код (якщо знаєте)"
        value={vin}
        onChange={(e) => setVin(e.target.value)}
        className={`${inputClass} font-mono uppercase`}
        style={inputStyle}
      />
      <input
        type="text"
        placeholder="Коментар (необов'язково)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className={inputClass}
        style={inputStyle}
      />
      {error && (
        <p className="text-xs sm:col-span-2" style={{ color: '#FCA5A5' }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        className="rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-50 sm:col-span-2"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT_DIM})`, color: '#fff' }}
      >
        {sending ? 'Надсилаємо...' : `Знайдіть мені «${query.length > 30 ? `${query.slice(0, 30)}…` : query}»`}
      </button>
      <p className="text-[11px] sm:col-span-2" style={{ color: MUTED }}>
        Шукаємо серед тисяч позицій наших постачальників — зазвичай відповідаємо протягом робочого дня.{' '}
        <span style={{ color: ACCENT_BRIGHT }}>Без передоплати.</span>
      </p>
    </form>
  );
}
