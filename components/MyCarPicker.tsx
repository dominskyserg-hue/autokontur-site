'use client';

// ============================================================
// Выбор "моє авто" (марка + модель) — общий для всех мест сайта:
//   - кнопка "Моє авто" в шапке (components/MyCarChip.tsx);
//   - блок "Підходить до вашого авто?" на карточке (components/FitCheck.tsx).
// Сохраняет выбор в браузере (lib/myCar.ts). Списки марок и моделей —
// тот же словарь, что и подбор по авто (GET /api/products/car-options),
// поэтому названия совпадают с применимостью товаров.
// ============================================================

import { useEffect, useState } from 'react';
import { saveMyCar, type MyCar } from '@/lib/myCar';

const INK = '#F1F5F9';
const MUTED = '#94A3B8';
const BORDER = 'rgba(255,255,255,0.1)';

interface MyCarPickerProps {
  // Текущее авто — им заполняются списки при открытии
  current: MyCar | null;
  // Закрыть выбор (после сохранения или по "Скасувати")
  onDone: () => void;
}

export default function MyCarPicker({ current, onDone }: MyCarPickerProps) {
  const [makeOptions, setMakeOptions] = useState<string[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [make, setMake] = useState(current?.make ?? '');
  const [model, setModel] = useState(current?.model ?? '');

  // Марки
  useEffect(() => {
    fetch('/api/products/car-options?field=make')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.options)) setMakeOptions(data.options as string[]);
      })
      .catch(() => {});
  }, []);

  // Модели выбранной марки
  useEffect(() => {
    setModelOptions([]);
    if (!make) return;
    fetch(`/api/products/car-options?${new URLSearchParams({ field: 'model', make }).toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data.options)) setModelOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [make]);

  const handleSave = () => {
    if (!make) return;
    saveMyCar({ make, model });
    onDone();
  };

  const selectClass = 'rounded-lg px-2.5 py-2 text-sm outline-none';
  const selectStyle = { background: '#1B2436', border: `1px solid ${BORDER}`, color: INK };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs" style={{ color: MUTED }}>
        Вкажіть ваше авто — покажемо, які деталі підходять
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={make}
          onChange={(e) => {
            setMake(e.target.value);
            setModel('');
          }}
          className={selectClass}
          style={selectStyle}
          aria-label="Марка"
        >
          <option value="">Марка</option>
          {/* Сохранённая марка — даже если её ещё нет в загруженном списке */}
          {make && !makeOptions.includes(make) && <option value={make}>{make}</option>}
          {makeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={!make}
          className={`${selectClass} disabled:opacity-40`}
          style={selectStyle}
          aria-label="Модель"
        >
          <option value="">Модель</option>
          {model && !modelOptions.includes(model) && <option value={model}>{model}</option>}
          {modelOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleSave}
          disabled={!make}
          className="rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-40"
          style={{ background: '#3B82F6', color: '#fff' }}
        >
          Зберегти
        </button>
        <button type="button" onClick={onDone} className="px-2 py-2 text-xs" style={{ color: MUTED }}>
          Скасувати
        </button>
        {current && (
          <button
            type="button"
            onClick={() => {
              saveMyCar(null);
              onDone();
            }}
            className="px-2 py-2 text-xs underline"
            style={{ color: MUTED }}
          >
            Забути авто
          </button>
        )}
      </div>
    </div>
  );
}
