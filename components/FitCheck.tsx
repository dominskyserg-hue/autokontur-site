'use client';

// ============================================================
// "Підходить до вашого авто?" — блок на странице товара.
//
// Покупатель один раз выбирает своё авто (марка + модель) — оно
// запоминается в браузере (lib/myCar.ts), и на КАЖДОМ товаре сразу видно:
//   ✓ "Підходить до вашого Hyundai Accent" — авто есть в списке
//     применимости детали ("Застосовується для");
//   ~ "Підходить до Hyundai — модель уточніть" — совпала только марка
//     (в применимости модель не указана);
//   ⚠ "Немає у списку сумісності" / "немає даних про сумісність" —
//     советуем проверить по VIN (кнопка ведёт на /pidbir-za-vin).
// Так меньше возвратов из-за неправильно подобранной детали.
//
// Списки марок и моделей — тот же словарь, что и у подбора по авто
// (GET /api/products/car-options), поэтому названия совпадают с
// применимостью товара.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { Car, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { carMatches, myCarLabel } from '@/lib/myCar';
import { useMyCar } from '@/lib/useMyCar';
import MyCarPicker from '@/components/MyCarPicker';

const MUTED = '#94A3B8';
const ACCENT_BRIGHT = '#60A5FA';
const BORDER = 'rgba(255,255,255,0.1)';
const GOOD = '#34D399';
const WARN = '#FBBF24';

interface FitCheckProps {
  // Применимость товара (то же, что в блоке "Застосовується для")
  compatibility: { make: string; makeRaw: string; model: string }[];
}

export default function FitCheck({ compatibility }: FitCheckProps) {
  // "Моє авто" из браузера (lib/useMyCar.ts); undefined — ещё не прочитали
  const car = useMyCar();
  const [editing, setEditing] = useState(false);
  const startEditing = () => setEditing(true);

  // Пока не прочитали браузер — ничего не рисуем (без "мигания")
  if (car === undefined) return null;

  if (editing) {
    return (
      <div className="mb-4 rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
        <MyCarPicker current={car} onDone={() => setEditing(false)} />
      </div>
    );
  }

  // Авто ещё не выбрано — приглашение
  if (!car) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="mb-4 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors hover:bg-white/5"
        style={{ border: `1px dashed ${BORDER}`, color: ACCENT_BRIGHT }}
      >
        <Car className="h-4 w-4" />
        Підходить до мого авто? Вкажіть авто
      </button>
    );
  }

  // Лучшее совпадение среди всей применимости детали
  const results = compatibility.map((item) => carMatches(car, item));
  const verdict = results.includes('full') ? 'full' : results.includes('make') ? 'make' : 'none';
  const label = myCarLabel(car);

  const view =
    verdict === 'full'
      ? { color: GOOD, icon: <CheckCircle2 className="h-4 w-4 shrink-0" />, text: `Підходить до вашого ${label}` }
      : verdict === 'make'
        ? { color: WARN, icon: <Info className="h-4 w-4 shrink-0" />, text: `Підходить до ${car.make} — модель уточніть за VIN` }
        : compatibility.length > 0
          ? { color: WARN, icon: <AlertTriangle className="h-4 w-4 shrink-0" />, text: `Вашого ${label} немає у списку сумісності` }
          : { color: MUTED, icon: <Info className="h-4 w-4 shrink-0" />, text: `Немає даних про сумісність з ${label}` };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: view.color }}>
        {view.icon}
        {view.text}
      </span>
      {verdict !== 'full' && (
        <Link href="/pidbir-za-vin" className="text-xs underline" style={{ color: ACCENT_BRIGHT }}>
          Перевірити за VIN
        </Link>
      )}
      <button type="button" onClick={startEditing} className="text-xs underline" style={{ color: MUTED }}>
        Інше авто
      </button>
    </div>
  );
}
