'use client';

// ============================================================
// Кнопка "Моє авто" в шапке сайта (components/SiteHeaderFull.tsx и шапка
// главной в components/StorefrontHome.tsx). Показывает сохранённое авто
// покупателя ("Hyundai Accent") или "Моє авто", если оно ещё не выбрано.
// По нажатию — окошко выбора (components/MyCarPicker.tsx).
//
// Выбранное авто дальше используется:
//   - в поиске — отметка "✓ підходить" и фильтр "Тільки для мого авто";
//   - на карточке товара — "Підходить до вашого авто?" (FitCheck).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { Car } from 'lucide-react';
import { myCarLabel } from '@/lib/myCar';
import { useMyCar } from '@/lib/useMyCar';
import MyCarPicker from '@/components/MyCarPicker';

export default function MyCarChip() {
  const car = useMyCar();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Клик мимо окошка — закрываем
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const label = car ? myCarLabel(car) : 'Моє авто';

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[11rem] items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-white/5"
        style={{ color: car ? '#34D399' : '#94A3B8', border: `1px solid ${car ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.08)'}` }}
        title={car ? `Моє авто: ${label} — змінити` : 'Вкажіть своє авто — покажемо, які деталі підходять'}
        aria-expanded={open}
      >
        <Car className="h-4 w-4 shrink-0" />
        {/* На телефоне и планшете — только значок, чтобы шапка не переполнялась */}
        <span className="hidden truncate lg:inline">{label}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl p-3"
          style={{ background: '#141B29', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 18px 40px rgba(0,0,0,0.45)' }}
        >
          <MyCarPicker current={car ?? null} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
