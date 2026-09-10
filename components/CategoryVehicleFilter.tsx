'use client';

// ============================================================
// Фільтр "Марка → Модель → Рік → Об'єм двигуна" на сторінках категорій
// (app/category/[slug]/page.tsx). НА ВІДМІНУ від components/
// VehicleFilterModal.tsx (модалка, стан живе лише в React, зникає при
// закритті) — тут вибір одразу пишеться в URL (?marka=...&model=...
// &year=...&engine=...) і РЕАЛЬНЕ фільтрування товарів робить сервер
// (app/category/[slug]/page.tsx), читаючи ці ж query-параметри при
// кожному запиті. Це навмисно: сторінка лишається SSR (є що
// індексувати Google, посилання можна скопіювати й переслати), а не
// перетворюється на SPA-фільтр, що працює лише в браузері.
//
// Каскадні списки — той самий /api/products/car-options, що й у
// VehicleFilterModal (одне й те саме джерело даних, tecdoc_compatibility
// + products, а не окрема система).
//
// Мобільна версія: розгортається зверху над списком товарів (не
// бічна колонка) — на вузькому екрані бічна колонка або ламає
// верстку, або займає половину екрану для форми, яку більшість
// покупців взагалі не чіпають
// ============================================================

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { CAR_MAKES, getCarMakeBySlug } from '@/lib/carMakes';
import { TECH_SURFACE_2, TECH_BORDER, TECH_ACCENT, TECH_ACCENT_BRIGHT, TECH_INK, TECH_MUTED, TECH_FAINT, TECH_BODY_FONT } from '@/lib/techTheme';

export interface CategoryVehicleFilterValue {
  makeSlug: string;
  model: string;
  year: string;
  engine: string;
}

interface CategoryVehicleFilterProps {
  value: CategoryVehicleFilterValue;
}

export default function CategoryVehicleFilter({ value }: CategoryVehicleFilterProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Панель одразу розгорнута, якщо фільтр уже застосований (покупець
  // перейшов за посиланням із заповненими параметрами) — інакше
  // згорнута, щоб не займати місце над списком товарів
  const [expanded, setExpanded] = useState(Boolean(value.makeSlug));

  const selectedMake = value.makeSlug ? getCarMakeBySlug(value.makeSlug) : undefined;
  const makeName = selectedMake?.name ?? '';

  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [yearOptions, setYearOptions] = useState<string[]>([]);
  const [engineOptions, setEngineOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingYears, setLoadingYears] = useState(false);
  const [loadingEngines, setLoadingEngines] = useState(false);

  useEffect(() => {
    if (!makeName) {
      setModelOptions([]);
      return;
    }
    setLoadingModels(true);
    fetch(`/api/products/car-options?${new URLSearchParams({ field: 'model', make: makeName })}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.options) setModelOptions(data.options as string[]);
      })
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, [makeName]);

  useEffect(() => {
    if (!makeName) {
      setYearOptions([]);
      return;
    }
    setLoadingYears(true);
    const params = new URLSearchParams({ field: 'year', make: makeName });
    if (value.model) params.set('model', value.model);
    fetch(`/api/products/car-options?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.options) setYearOptions(data.options as string[]);
      })
      .catch(() => {})
      .finally(() => setLoadingYears(false));
  }, [makeName, value.model]);

  useEffect(() => {
    if (!makeName || !value.year) {
      setEngineOptions([]);
      return;
    }
    setLoadingEngines(true);
    fetch(`/api/products/car-options?${new URLSearchParams({ field: 'engineVolume', make: makeName, year: value.year })}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.options) setEngineOptions(data.options as string[]);
      })
      .catch(() => {})
      .finally(() => setLoadingEngines(false));
  }, [makeName, value.year]);

  // Формує новий URL із поточними query-параметрами сторінки, змінює
  // лише передані поля (решта, окрім них, скидається — вибір моделі
  // без марки сенсу не має) і переходить туди. page навмисно
  // прибирається — новий фільтр має починатись із першої сторінки
  const navigate = (next: Partial<CategoryVehicleFilterValue>) => {
    const merged: CategoryVehicleFilterValue = {
      makeSlug: next.makeSlug !== undefined ? next.makeSlug : value.makeSlug,
      model: next.model !== undefined ? next.model : value.model,
      year: next.year !== undefined ? next.year : value.year,
      engine: next.engine !== undefined ? next.engine : value.engine,
    };
    // Зміна марки скидає все, що йде після неї; зміна моделі скидає
    // рік/двигун; зміна року скидає двигун — той самий каскад, що і в
    // самих випадаючих списках нижче
    if (next.makeSlug !== undefined) {
      merged.model = '';
      merged.year = '';
      merged.engine = '';
    } else if (next.model !== undefined) {
      merged.year = '';
      merged.engine = '';
    } else if (next.year !== undefined) {
      merged.engine = '';
    }

    const params = new URLSearchParams();
    if (merged.makeSlug) params.set('marka', merged.makeSlug);
    if (merged.model) params.set('model', merged.model);
    if (merged.year) params.set('year', merged.year);
    if (merged.engine) params.set('engine', merged.engine);

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const clearAll = () => navigate({ makeSlug: '', model: '', year: '', engine: '' });

  const activeCount = [value.makeSlug, value.model, value.year, value.engine].filter(Boolean).length;

  return (
    <div className="mb-6 rounded-xl overflow-hidden" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_INK }}>
          <SlidersHorizontal size={16} style={{ color: TECH_ACCENT_BRIGHT }} />
          Фільтр за автомобілем
          {activeCount > 0 && (
            <span
              className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
              style={{ background: TECH_ACCENT, color: '#fff' }}
            >
              {activeCount}
            </span>
          )}
        </span>
        <ChevronDown
          size={18}
          style={{ color: TECH_FAINT, transition: 'transform 0.15s ease', transform: expanded ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-4" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Марка"
              value={value.makeSlug}
              onChange={(v) => navigate({ makeSlug: v })}
              options={CAR_MAKES.map((m) => ({ value: m.slug, label: m.name }))}
              placeholder="Будь-яка"
            />
            <FilterSelect
              label="Модель"
              value={value.model}
              onChange={(v) => navigate({ model: v })}
              options={modelOptions.map((m) => ({ value: m, label: m }))}
              placeholder={!value.makeSlug ? 'Спершу марка' : loadingModels ? 'Завантаження…' : 'Будь-яка'}
              disabled={!value.makeSlug}
            />
            <FilterSelect
              label="Рік випуску"
              value={value.year}
              onChange={(v) => navigate({ year: v })}
              options={yearOptions.map((y) => ({ value: y, label: y }))}
              placeholder={!value.makeSlug ? 'Спершу марка' : loadingYears ? 'Завантаження…' : 'Будь-який'}
              disabled={!value.makeSlug}
            />
            <FilterSelect
              label="Об'єм двигуна"
              value={value.engine}
              onChange={(v) => navigate({ engine: v })}
              options={engineOptions.map((e) => ({ value: e, label: e }))}
              placeholder={!value.year ? 'Спершу рік' : loadingEngines ? 'Завантаження…' : 'Будь-який'}
              disabled={!value.year}
            />
          </div>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="mt-3 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
              style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
            >
              <X size={13} />
              Скинути фільтр
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium" style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}>
        {label}
      </label>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ fontFamily: TECH_BODY_FONT, border: `1px solid ${TECH_BORDER}`, background: 'rgba(255,255,255,0.04)', color: value ? TECH_INK : TECH_FAINT }}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} style={{ color: '#000' }}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
