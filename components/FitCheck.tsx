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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Car, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { carMatches, myCarLabel, readMyCar, saveMyCar, MY_CAR_UPDATED_EVENT, type MyCar } from '@/lib/myCar';

const INK = '#F1F5F9';
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
  // undefined — ещё не прочитали из браузера (первый рендер на сервере)
  const [car, setCar] = useState<MyCar | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [makeOptions, setMakeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [draftMake, setDraftMake] = useState('');
  const [draftModel, setDraftModel] = useState('');

  // Читаем "моє авто" и следим за изменениями (выбор в другом блоке)
  useEffect(() => {
    const sync = () => setCar(readMyCar());
    sync();
    window.addEventListener(MY_CAR_UPDATED_EVENT, sync);
    return () => window.removeEventListener(MY_CAR_UPDATED_EVENT, sync);
  }, []);

  // Марки — только когда покупатель открыл выбор авто
  useEffect(() => {
    if (!editing || makeOptions.length > 0) return;
    fetch('/api/products/car-options?field=make')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.options)) setMakeOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [editing, makeOptions.length]);

  // Модели выбранной марки
  useEffect(() => {
    setModelOptions([]);
    if (!draftMake) return;
    fetch(`/api/products/car-options?${new URLSearchParams({ field: 'model', make: draftMake }).toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.options)) setModelOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [draftMake]);

  const startEditing = () => {
    setDraftMake(car?.make ?? '');
    setDraftModel(car?.model ?? '');
    setEditing(true);
  };

  const handleSave = () => {
    if (!draftMake) return;
    saveMyCar({ make: draftMake, model: draftModel });
    setEditing(false);
  };

  // Пока не прочитали браузер — ничего не рисуем (без "мигания")
  if (car === undefined) return null;

  const selectClass = 'rounded-lg px-2.5 py-2 text-sm outline-none';
  const selectStyle = { background: '#1B2436', border: `1px solid ${BORDER}`, color: INK };

  if (editing) {
    return (
      <div className="mb-4 rounded-xl p-3" style={{ border: `1px solid ${BORDER}` }}>
        <p className="mb-2 text-xs" style={{ color: MUTED }}>
          Вкажіть ваше авто — на кожному товарі покажемо, чи він підходить
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={draftMake} onChange={(e) => { setDraftMake(e.target.value); setDraftModel(''); }} className={selectClass} style={selectStyle} aria-label="Марка">
            <option value="">Марка</option>
            {makeOptions.map((make) => (
              <option key={make} value={make}>
                {make}
              </option>
            ))}
          </select>
          <select value={draftModel} onChange={(e) => setDraftModel(e.target.value)} disabled={!draftMake} className={`${selectClass} disabled:opacity-40`} style={selectStyle} aria-label="Модель">
            <option value="">Модель</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleSave} disabled={!draftMake} className="rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-40" style={{ background: '#3B82F6', color: '#fff' }}>
            Зберегти
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-2 py-2 text-xs" style={{ color: MUTED }}>
            Скасувати
          </button>
          {car && (
            <button type="button" onClick={() => { saveMyCar(null); setEditing(false); }} className="px-2 py-2 text-xs underline" style={{ color: MUTED }}>
              Забути авто
            </button>
          )}
        </div>
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
