'use client';

// ============================================================
// Завжди видима (не модальна) форма заявки "Підбір за VIN" — для
// сторінки app/pidbir-za-vin/page.tsx. Валідація і сам запит
// (POST /api/vin-requests) — ТІ Ж САМІ, що і в плаваючій кнопці
// components/VinRequestButton.tsx і в модалці на Головній
// (components/StorefrontHome.tsx): усі три здають заявку в одну й ту
// саму таблицю vin_requests через один і той же роут. Окрема копія
// форми тут навмисна: на сторінку, оптимізовану під пошукові запити
// "підбір запчастин за VIN-кодом", відвідувач приходить одразу з
// Google і повинен побачити форму без кліку по плаваючій кнопці чи
// картці на Головній.
// ============================================================

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Check } from 'lucide-react';
import { decodeVin } from '@/lib/vinDecode';
import {
  TECH_SURFACE_2,
  TECH_BORDER_2,
  TECH_ACCENT,
  TECH_ACCENT_DIM,
  TECH_INK,
  TECH_MUTED,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_GLOW,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
  TECH_MONO_FONT,
} from '@/lib/techTheme';

function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

export default function VinLandingForm() {
  const [vinCode, setVinCode] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const vinDecoded = useMemo(() => decodeVin(vinCode), [vinCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!vinCode.trim() || vinCode.trim().length < 5) {
      setError('Вкажіть VIN-код автомобіля');
      return;
    }
    if (!isValidPhone(phone)) {
      setError('Введіть коректний номер телефону');
      return;
    }
    if (!description.trim()) {
      setError('Опишіть, яку деталь ви шукаєте');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/vin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vinCode: vinCode.trim(), phone: phone.trim(), description: description.trim() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося надіслати заявку');
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі, спробуйте ще раз');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div
        className="flex flex-col items-center rounded-2xl px-8 py-10 text-center"
        style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER_2}` }}
      >
        <div
          className="mb-5 flex h-16 w-16 items-center justify-center rounded-full"
          style={{ background: TECH_GOOD_SOFT, color: TECH_GOOD, boxShadow: '0 0 0 1px rgba(52,211,153,0.25), 0 0 24px -4px rgba(52,211,153,0.6)' }}
        >
          <Check size={28} />
        </div>
        <h2 className="mb-2 text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
          Дякуємо за заявку!
        </h2>
        <p className="text-sm leading-relaxed" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
          Ми зв&apos;яжемося з вами найближчим часом і підберемо потрібну деталь за вашим VIN-кодом.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl p-5 sm:p-6"
      style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER_2}` }}
    >
      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
          VIN-код автомобіля
        </label>
        <input
          type="text"
          value={vinCode}
          onChange={(event) => setVinCode(event.target.value.toUpperCase())}
          placeholder="напр. WVWZZZ1JZXW000001"
          className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
          style={{ fontFamily: TECH_MONO_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
        />
        {vinDecoded.make && (
          <p className="mt-1.5 text-xs" style={{ fontFamily: TECH_BODY_FONT, color: TECH_GOOD }}>
            Схоже, це {vinDecoded.make}
            {vinDecoded.year ? `, прибл. ${vinDecoded.year} р.` : ''}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
          Номер телефону
        </label>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="напр. 0671234567"
          className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
          style={{ fontFamily: TECH_MONO_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
          Яку деталь шукаєте?
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="напр. Гальмівні колодки передні"
          rows={3}
          className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
          style={{ fontFamily: TECH_BODY_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
        />
      </div>

      {error && (
        <p className="text-xs" style={{ fontFamily: TECH_BODY_FONT, color: '#F87171' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 w-full rounded-xl py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg disabled:cursor-not-allowed disabled:opacity-50"
        style={{ fontFamily: TECH_BODY_FONT, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
      >
        {submitting ? 'Надсилання...' : 'Надіслати заявку на підбір'}
      </button>
    </form>
  );
}
