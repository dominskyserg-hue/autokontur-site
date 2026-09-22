'use client';

// ============================================================
// Поля "Місто" і "Відділення" для СТВОРЕННЯ ТТН у картці заказа
// (components/OrdersScreen.tsx) — з автопошуком через ті самі
// серверні роути, що і на вітрині (components/NovaPoshtaAddressFields.tsx):
//   GET /api/nova-poshta/cities?q=...
//   GET /api/nova-poshta/warehouses?cityRef=...&q=...
//
// Окремий компонент, а не переюзаний NovaPoshtaAddressFields, з двох
// причин: 1) той під світлу тему вітрини, тут потрібна темна тема
// адмінки; 2) головне — тут потрібні самі Ref'и міста/відділення
// (Нова Пошта створює ТТН саме по ним, текст їй не підходить), а
// NovaPoshtaAddressFields віддає назовні лише готовий текст
// ============================================================

import { useEffect, useState } from 'react';

interface CityOption {
  ref: string;
  name: string;
}

interface WarehouseOption {
  ref: string;
  description: string;
  isPostomat: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function AdminNovaPoshtaPicker({
  initialCityQuery = '',
  initialWarehouseQuery = '',
  onPick,
}: {
  initialCityQuery?: string;
  initialWarehouseQuery?: string;
  onPick: (value: { cityRef: string; cityName: string; warehouseRef: string; warehouseDescription: string }) => void;
}) {
  const [cityQuery, setCityQuery] = useState(initialCityQuery);
  const [cityRef, setCityRef] = useState('');
  const [cityName, setCityName] = useState('');
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);

  const [warehouseQuery, setWarehouseQuery] = useState(initialWarehouseQuery);
  const [warehouseRef, setWarehouseRef] = useState('');
  const [warehouseDescription, setWarehouseDescription] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  useEffect(() => {
    if (cityQuery.trim().length < 2) {
      setCityOptions([]);
      return;
    }
    setCityLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/nova-poshta/cities?q=${encodeURIComponent(cityQuery.trim())}`);
        const data = await response.json();
        setCityOptions(data.success ? data.cities : []);
      } catch {
        setCityOptions([]);
      } finally {
        setCityLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityQuery]);

  useEffect(() => {
    if (!cityRef) {
      setWarehouseOptions([]);
      return;
    }
    setWarehouseLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ cityRef, q: warehouseQuery.trim() });
        const response = await fetch(`/api/nova-poshta/warehouses?${params}`);
        const data = await response.json();
        setWarehouseOptions(data.success ? data.warehouses : []);
      } catch {
        setWarehouseOptions([]);
      } finally {
        setWarehouseLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cityRef, warehouseQuery]);

  function pickCity(option: CityOption) {
    setCityQuery(option.name);
    setCityName(option.name);
    setCityRef(option.ref);
    setCityOpen(false);
    setWarehouseRef('');
    setWarehouseDescription('');
    setWarehouseQuery('');
  }

  function pickWarehouse(option: WarehouseOption) {
    setWarehouseQuery(option.description);
    setWarehouseDescription(option.description);
    setWarehouseRef(option.ref);
    setWarehouseOpen(false);
    onPick({ cityRef, cityName, warehouseRef: option.ref, warehouseDescription: option.description });
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative">
        <input
          type="text"
          value={cityQuery}
          onChange={(e) => {
            setCityQuery(e.target.value);
            setCityRef('');
            setCityOpen(true);
          }}
          onFocus={() => setCityOpen(true)}
          onBlur={() => setTimeout(() => setCityOpen(false), 150)}
          placeholder="Місто"
          autoComplete="off"
          className="w-full px-3 py-2 text-sm rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        />
        {cityOpen && (cityLoading || cityOptions.length > 0) && (
          <div
            className="absolute z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-md p-1"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
          >
            {cityLoading && cityOptions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs" style={{ color: 'var(--ink-faint)' }}>
                Пошук...
              </p>
            ) : (
              cityOptions.map((option) => (
                <button
                  key={option.ref}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickCity(option)}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-xs"
                  style={{ color: 'var(--ink)' }}
                >
                  {option.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="relative">
        <input
          type="text"
          value={warehouseQuery}
          disabled={!cityRef}
          onChange={(e) => {
            setWarehouseQuery(e.target.value);
            setWarehouseOpen(true);
          }}
          onFocus={() => setWarehouseOpen(true)}
          onBlur={() => setTimeout(() => setWarehouseOpen(false), 150)}
          placeholder={cityRef ? 'Відділення' : 'Спочатку оберіть місто'}
          autoComplete="off"
          className="w-full px-3 py-2 text-sm rounded-md disabled:opacity-50"
          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
        />
        {warehouseOpen && cityRef && (warehouseLoading || warehouseOptions.length > 0) && (
          <div
            className="absolute z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-md p-1"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
          >
            {warehouseLoading && warehouseOptions.length === 0 ? (
              <p className="px-2 py-1.5 text-xs" style={{ color: 'var(--ink-faint)' }}>
                Пошук...
              </p>
            ) : (
              warehouseOptions.map((option) => (
                <button
                  key={option.ref}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickWarehouse(option)}
                  className="block w-full truncate rounded px-2 py-1.5 text-left text-xs"
                  style={{ color: 'var(--ink)' }}
                >
                  {option.description}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
