'use client';

// ============================================================
// Модальне вікно "Підбір за автомобілем" — відкривається з
// components/CategoryGridSection.tsx при кліку по картці розділу
// (напр. "Гальмівна система"), перш ніж вести покупця далі в каталог.
//
// Каскадні списки (марка -> модель -> рік -> об'єм двигуна) —
// ТОЧНО той самий принцип і той самий API (/api/products/car-options,
// див. коментар у файлі роута), що і у вкладці "За автомобілем" на
// Головній (components/StorefrontHome.tsx) — тут просто своя копія
// стану, бо цей компонент навмисно самодостатній (не залежить від
// StorefrontHome і може відкриватись з будь-якої сторінки).
//
// Марка обов'язкова для кнопки "Показати деталі" (без неї фільтр не
// мав би сенсу — та ж вимога, що і в existing car-search формі),
// решта кроків — необов'язкові уточнення поверх марки.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, ChevronRight } from 'lucide-react';
import { CAR_MAKES } from '@/lib/carMakes';
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
  TECH_GLOW,
  TECH_GLOW_LG,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
} from '@/lib/techTheme';

export interface VehicleSelection {
  make: string;
  model: string;
  year: string;
  engine: string;
}

interface VehicleFilterModalProps {
  open: boolean;
  // Назва категорії/розділу, під яку підбираємо авто — показується в
  // заголовку ("...в категорії Гальмівна система")
  categoryName: string;
  onClose: () => void;
  onSubmit: (selection: VehicleSelection) => void;
  onSkip: () => void;
}

const STEP_LABELS = ['Марка', 'Модель', 'Рік', 'Двигун'] as const;

export default function VehicleFilterModal({ open, categoryName, onClose, onSubmit, onSkip }: VehicleFilterModalProps) {
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [engine, setEngine] = useState('');

  const [makeOptions, setMakeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [yearOptions, setYearOptions] = useState<string[]>([]);
  const [engineOptions, setEngineOptions] = useState<string[]>([]);
  const [loadingMakes, setLoadingMakes] = useState(false);

  // Скидаємо всю форму щоразу, коли модалку відкривають заново — інакше
  // покупач побачить вибір, залишений з минулого разу (для іншої
  // категорії чи просто після "Пропустити")
  useEffect(() => {
    if (!open) return;
    setMake('');
    setModel('');
    setYear('');
    setEngine('');
    setModelOptions([]);
    setYearOptions([]);
    setEngineOptions([]);

    setLoadingMakes(true);
    fetch('/api/products/car-options?field=make')
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setMakeOptions(data.options as string[]);
      })
      .catch(() => {
        // Список марок необов'язковий для роботи форми в цілому —
        // просто покажемо весь курований список CAR_MAKES як є нижче
      })
      .finally(() => setLoadingMakes(false));
  }, [open]);

  // марка -> моделі
  useEffect(() => {
    setModel('');
    setYear('');
    setEngine('');
    setYearOptions([]);
    setEngineOptions([]);

    if (!make) {
      setModelOptions([]);
      return;
    }

    const params = new URLSearchParams({ field: 'model', make });
    fetch(`/api/products/car-options?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setModelOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [make]);

  // марка(+модель) -> роки
  useEffect(() => {
    setYear('');
    setEngine('');
    setEngineOptions([]);

    if (!make) {
      setYearOptions([]);
      return;
    }

    const params = new URLSearchParams({ field: 'year', make });
    if (model) params.set('model', model);
    fetch(`/api/products/car-options?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setYearOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [make, model]);

  // марка+рік -> об'єм двигуна
  useEffect(() => {
    setEngine('');

    if (!make || !year) {
      setEngineOptions([]);
      return;
    }

    const params = new URLSearchParams({ field: 'engineVolume', make, year });
    fetch(`/api/products/car-options?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setEngineOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [make, year]);

  const close = useCallback(() => onClose(), [onClose]);

  // Escape закриває модалку, і блокуємо прокрутку сторінки під нею —
  // той самий підхід, що і в components/ProductModalShell.tsx
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

  // Лого показуємо тільки для марок, які реально є в каталозі
  // (makeOptions з API) — якщо запит ще не повернувся чи впав, просто
  // показуємо весь курований список, щоб форма лишалась робочою
  const availableMakes =
    makeOptions.length > 0
      ? CAR_MAKES.filter((carMake) => makeOptions.some((option) => option.toLowerCase() === carMake.name.toLowerCase()))
      : CAR_MAKES;

  const handleSubmit = () => {
    if (!make) return;
    onSubmit({ make, model, year, engine });
  };

  const activeStepIndex = engine ? 4 : year ? 3 : model ? 2 : make ? 1 : 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
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
            aria-label={`Підбір за автомобілем — ${categoryName}`}
            className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
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
            {/* ==================== ЗАГОЛОВОК ==================== */}
            <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: `1px solid ${TECH_BORDER}` }}>
              <div>
                <p
                  className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
                  style={{ fontFamily: TECH_BODY_FONT, color: TECH_FAINT }}
                >
                  Підбір за автомобілем
                </p>
                <h2 className="text-lg leading-snug" style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, color: '#fff' }}>
                  Оберіть авто для категорії <span style={{ color: TECH_ACCENT_BRIGHT }}>{categoryName}</span>
                </h2>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Закрити"
                className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/5"
                style={{ color: TECH_FAINT }}
              >
                <X size={20} />
              </button>
            </div>

            {/* ==================== СТЕП-ІНДИКАТОР ==================== */}
            <div className="flex items-center gap-1.5 px-6 pt-4">
              {STEP_LABELS.map((label, index) => (
                <div key={label} className="flex flex-1 items-center gap-1.5">
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors"
                    style={
                      index < activeStepIndex
                        ? { background: TECH_ACCENT, color: '#fff' }
                        : index === activeStepIndex
                          ? { background: 'rgba(59,130,246,0.16)', color: TECH_ACCENT_BRIGHT, boxShadow: `0 0 0 1px ${TECH_ACCENT}` }
                          : { background: 'rgba(255,255,255,0.05)', color: TECH_FAINT }
                    }
                  >
                    {index < activeStepIndex ? <Check size={12} /> : index + 1}
                  </div>
                  {index < STEP_LABELS.length - 1 && (
                    <div className="h-px flex-1" style={{ background: index < activeStepIndex ? TECH_ACCENT : TECH_BORDER }} />
                  )}
                </div>
              ))}
            </div>

            {/* ==================== ФОРМА, ЩО ПРОКРУЧУЄТЬСЯ ==================== */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {/* Крок 1 — марка, з логотипами */}
              <div className="mb-5">
                <label className="mb-2 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
                  1. Марка авто {loadingMakes && '· завантаження…'}
                </label>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {availableMakes.map((carMake) => {
                    const selected = make.toLowerCase() === carMake.name.toLowerCase();
                    return (
                      <button
                        key={carMake.slug}
                        type="button"
                        onClick={() => setMake(carMake.name)}
                        className="flex flex-col items-center gap-1.5 rounded-xl p-2 transition-colors"
                        style={{
                          background: selected ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${selected ? TECH_ACCENT : TECH_BORDER}`,
                          boxShadow: selected ? TECH_GLOW : 'none',
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={carMake.logo}
                          alt={carMake.name}
                          className="h-6 w-6 object-contain"
                          style={{ filter: selected ? 'none' : 'grayscale(1) opacity(0.75)' }}
                        />
                        <span
                          className="max-w-full truncate text-[10px]"
                          style={{ fontFamily: TECH_BODY_FONT, color: selected ? '#fff' : TECH_MUTED }}
                        >
                          {carMake.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Кроки 2-4 — каскадні селекти */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SelectField
                  label="2. Модель"
                  value={model}
                  onChange={setModel}
                  options={modelOptions}
                  disabled={!make}
                  placeholder={make ? 'Будь-яка' : 'Спершу марка'}
                />
                <SelectField
                  label="3. Рік випуску"
                  value={year}
                  onChange={setYear}
                  options={yearOptions}
                  disabled={!make}
                  placeholder={make ? 'Будь-який' : 'Спершу марка'}
                />
                <SelectField
                  label="4. Об'єм / двигун"
                  value={engine}
                  onChange={setEngine}
                  options={engineOptions}
                  disabled={!year}
                  placeholder={year ? 'Будь-який' : 'Спершу рік'}
                />
              </div>
            </div>

            {/* ==================== ФУТЕР ==================== */}
            <div
              className="flex flex-col gap-2.5 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderTop: `1px solid ${TECH_BORDER}` }}
            >
              <button
                type="button"
                onClick={onSkip}
                className="text-sm underline-offset-2 transition-colors hover:underline"
                style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
              >
                Пропустити і показати всі деталі категорії
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!make}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold transition-shadow hover:shadow-glow-lg disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: TECH_BODY_FONT, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
              >
                Показати деталі
                <ChevronRight size={16} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Невеликий допоміжний select, стилізований під Dark Glass — щоб не
// повторювати одну й ту саму розмітку тричі (модель/рік/двигун)
function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  disabled: boolean;
  placeholder: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          fontFamily: TECH_BODY_FONT,
          border: `1px solid ${TECH_BORDER_2}`,
          background: 'rgba(255,255,255,0.04)',
          color: value ? TECH_INK : TECH_FAINT,
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option} value={option} style={{ color: '#000' }}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
