'use client';

// ============================================================
// Плаваюча кнопка "Не знайшли, що шукали?" — глобальний вхід у заявку
// "Підбір за VIN" (та сама таблиця vin_requests і той самий
// POST /api/vin-requests, що і форма в components/StorefrontHome.tsx).
//
// Навіщо окремий компонент, а не перевикористання модалки з
// StorefrontHome.tsx: та модалка й уся її логіка (стан, валідація,
// відправка) живуть ВСЕРЕДИНІ StorefrontHome — компонента лише
// Головної сторінки. А цю кнопку потрібно показувати на КОЖНІЙ
// сторінці сайту (категорії, марки, картка товару) — раніше на них
// узагалі не було жодного способу лишити таку заявку, лише на
// Головній. Тому тут — повністю самодостатня копія тієї ж форми зі
// своїм станом, підключена в app/layout.tsx (рендериться в усіх
// клієнтських сторінках), і навмисно НЕ показується під /admin
// (усередині usePathname-перевірки нижче) — адмінці такий заклик до
// покупця не потрібен.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircleQuestion, X, Check } from 'lucide-react';
import { decodeVin } from '@/lib/vinDecode';
import HoneypotField, { readHoneypot } from '@/components/HoneypotField';
import { VIN_REQUEST_EVENT } from '@/lib/vinRequestEvent';
import {
  TECH_SURFACE_2,
  TECH_BORDER,
  TECH_BORDER_2,
  TECH_ACCENT,
  TECH_ACCENT_BRIGHT,
  TECH_ACCENT_DIM,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_GLOW,
  TECH_GLOW_LG,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
  TECH_MONO_FONT,
} from '@/lib/techTheme';

// Та сама перевірка телефону, що і скрізь на вітрині (StorefrontHome.tsx,
// app/api/vin-requests/route.ts) — лише цифри, від 9 до 13
function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

export default function VinRequestButton() {
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [vinCode, setVinCode] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const vinDecoded = useMemo(() => decodeVin(vinCode), [vinCode]);

  // Кнопка з'являється не одразу, а через 25 секунд після завантаження
  // сторінки — щоб не відволікати покупця в перші секунди, поки він
  // ще навіть не встиг подивитись на сам каталог
  const [buttonVisible, setButtonVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setButtonVisible(true), 25_000);
    return () => window.clearTimeout(timer);
  }, []);

  // Открыть форму из любого места страницы с уже подставленным текстом
  // (ссылка "Перевірити сумісність за VIN" на странице товара, кнопка на
  // хабе модели — components/VinCheckTrigger.tsx):
  //   window.dispatchEvent(new CustomEvent(VIN_REQUEST_EVENT, { detail: { description } }))
  useEffect(() => {
    const onOpen = (event: Event) => {
      const text = (event as CustomEvent<{ description?: string }>).detail?.description ?? '';
      setDescription(text);
      setError(null);
      setSubmitted(false);
      setOpen(true);
    };
    window.addEventListener(VIN_REQUEST_EVENT, onOpen);
    return () => window.removeEventListener(VIN_REQUEST_EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // Скидаємо форму при закритті — щоб наступного разу покупач
    // побачив чисту форму, а не залишки минулої заявки
    setVinCode('');
    setPhone('');
    setDescription('');
    setError(null);
    setSubmitted(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Скрытое поле-ловушка (components/HoneypotField.tsx) — читаем сразу,
    // до первого await: после него event.currentTarget уже пустой
    const honeypot = readHoneypot(event.currentTarget);
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
        body: JSON.stringify({ vinCode: vinCode.trim(), phone: phone.trim(), description: description.trim(), website: honeypot }),
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

  // На адмін-панелі покупцю ні до чого лишати заявку "Підбір за VIN" —
  // це інструмент персоналу, не вітрина
  if (pathname?.startsWith('/admin')) return null;

  return (
    <>
      <AnimatePresence>
        {buttonVisible && (
          <motion.button
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.8, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 12 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            // Круглая кнопка-значок справа внизу (над ней — "Передзвоніть мені",
            // components/CallbackButton.tsx): раньше широкие кнопки по обоим
            // бокам перекрывали карточки товаров. Подпись — при наведении.
            // На телефоне скрыта (там одна кнопка "Передзвоніть мені" —
            // components/CallbackButton.tsx; "Не знайшли?" там же есть в
            // пустом поиске и в меню "Підбір за VIN")
            className="group fixed bottom-20 right-4 z-40 hidden h-12 w-12 items-center justify-center rounded-full shadow-glow-lg md:bottom-6 md:right-6 md:flex"
            style={{
              fontFamily: TECH_BODY_FONT,
              background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`,
              color: '#fff',
            }}
            aria-label="Не знайшли, що шукали? Написати нам"
          >
            <MessageCircleQuestion size={22} strokeWidth={1.8} />
            {/* Подпись при наведении (только компьютер) */}
            <span
              className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold opacity-0 transition-opacity group-hover:opacity-100 md:block"
              style={{ background: '#1B2436', color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}
            >
              Не знайшли? Напишіть нам
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="absolute inset-0 backdrop-blur-sm"
              style={{ background: 'rgba(11,15,23,0.78)' }}
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Не знайшли, що шукали? Написати нам"
              className="relative w-full max-w-md overflow-hidden rounded-2xl"
              style={{
                background: TECH_SURFACE_2,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1px solid ${TECH_BORDER_2}`,
                boxShadow: TECH_GLOW_LG,
              }}
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${TECH_BORDER}` }}>
                <h2 style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 17, color: '#fff' }}>
                  Не знайшли, що шукали?
                </h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Закрити"
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
                  style={{ color: TECH_FAINT }}
                >
                  <X size={20} />
                </button>
              </div>

              {submitted ? (
                <div className="flex flex-col items-center px-8 py-10 text-center">
                  <div
                    className="mb-5 flex h-16 w-16 items-center justify-center rounded-full"
                    style={{
                      background: TECH_GOOD_SOFT,
                      color: TECH_GOOD,
                      boxShadow: '0 0 0 1px rgba(52,211,153,0.25), 0 0 24px -4px rgba(52,211,153,0.6)',
                    }}
                  >
                    <Check size={28} />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                    Дякуємо за заявку!
                  </h3>
                  <p className="mb-6 text-sm leading-relaxed" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
                    Ми зв&apos;яжемося з вами найближчим часом і підберемо потрібну деталь.
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-xl px-6 py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg"
                    style={{
                      fontFamily: TECH_BODY_FONT,
                      background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`,
                      color: '#fff',
                      boxShadow: TECH_GLOW,
                    }}
                  >
                    Закрити
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-5 py-5">
                  <HoneypotField />
                  <p className="text-xs leading-relaxed" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
                    Опишіть, яку деталь шукаєте, і лишіть VIN-код та телефон — наш менеджер підбере деталь
                    вручну і зв&apos;яжеться з вами.
                  </p>

                  <input
                    type="text"
                    value={vinCode}
                    onChange={(event) => setVinCode(event.target.value.toUpperCase())}
                    placeholder="VIN-код, напр. WVWZZZ1JZXW000001"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
                    style={{ fontFamily: TECH_MONO_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                  />

                  {vinDecoded.make && (
                    <p className="text-xs" style={{ fontFamily: TECH_BODY_FONT, color: TECH_GOOD }}>
                      Схоже, це {vinDecoded.make}
                      {vinDecoded.year ? `, прибл. ${vinDecoded.year} р.` : ''}
                    </p>
                  )}

                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Номер телефону"
                    className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
                    style={{ fontFamily: TECH_MONO_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                  />

                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Яку деталь шукаєте?"
                    rows={3}
                    className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
                    style={{ fontFamily: TECH_BODY_FONT, background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                  />

                  {error && (
                    <p className="text-xs" style={{ fontFamily: TECH_BODY_FONT, color: '#F87171' }}>
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-1 w-full rounded-xl py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                      fontFamily: TECH_BODY_FONT,
                      background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`,
                      color: '#fff',
                      boxShadow: TECH_GLOW,
                    }}
                  >
                    {submitting ? 'Надсилання...' : 'Надіслати заявку'}
                  </button>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
