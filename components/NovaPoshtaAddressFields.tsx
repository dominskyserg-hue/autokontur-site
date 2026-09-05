'use client';

// ============================================================
// Поля "Місто" і "Відділення / поштомат" (або "Адреса кур'єру") у
// кошику — з РЕАЛЬНИМ автопошуком через офіційне API Нової Пошти
// (api.novaposhta.ua), а не вільним текстом навмання.
//
// Запити до Нової Пошти йдуть НЕ звідси напряму, а через два наших
// власних серверних роути:
//   GET /api/nova-poshta/cities?q=...       — пошук міста
//   GET /api/nova-poshta/warehouses?cityRef=...&q=...  — відділення
// (обидва в app/api/nova-poshta/) — так ключ API лишається тільки на
// сервері й ніколи не потрапляє в браузер покупця.
//
// Компонент самодостатній (сам зберігає стан пошуку/випадаючих
// списків) — той самий підхід, що і в components/QuickOrderModal.tsx
// та components/AddToCartButton.tsx: не роздувати CartDrawerProps
// ще десятком полів заради однієї функції. Назовні віддає лише
// готовий текст — city і novaPoshtaAddress лишаються звичайними
// рядками, як і раніше приймає POST /api/orders/create: якщо API
// Нової Пошти раптом недоступне, покупець все одно може ввести текст
// вручну, форма просто перестає підказувати варіанти.
//
// Кольорова палітра — та сама темна Tech Premium, що і в
// CartDrawer/VIN-модалці (components/StorefrontHome.tsx). Константи
// продубльовано тут навмисно (як і в QuickOrderModal.tsx) — дешевше
// повторити кілька hex-кодів, ніж тягнути сюди весь StorefrontHome
// ============================================================

import { useEffect, useRef, useState } from 'react';

const TECH_SURFACE_2 = '#1B2436';
const TECH_BORDER = 'rgba(255,255,255,0.08)';
const TECH_BORDER_2 = 'rgba(255,255,255,0.14)';
const TECH_ACCENT_BRIGHT = '#60A5FA';
const TECH_INK = '#F1F5F9';
const TECH_MUTED = '#94A3B8';
const TECH_FAINT = '#54607A';

function fieldStyle(hasError: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--font-inter-tech), Inter, sans-serif',
    background: 'rgba(255,255,255,0.04)',
    border: `1px solid ${hasError ? 'rgba(239,68,68,0.55)' : TECH_BORDER_2}`,
    color: TECH_INK,
  };
}

interface CityOption {
  ref: string;
  name: string;
}

interface WarehouseOption {
  ref: string;
  description: string;
  isPostomat: boolean;
}

interface NovaPoshtaAddressFieldsProps {
  deliveryMethod: 'branch' | 'courier';
  city: string;
  onCityChange: (value: string) => void;
  onCityBlur?: () => void;
  cityError?: string | null;
  address: string;
  onAddressChange: (value: string) => void;
  onAddressBlur?: () => void;
  addressError?: string | null;
  addressPlaceholder: string;
}

// Скільки мілісекунд чекати після останнього натискання клавіші,
// перш ніж реально відправити запит до Нової Пошти — щоб не бити по
// API на кожну літеру
const SEARCH_DEBOUNCE_MS = 300;

export default function NovaPoshtaAddressFields({
  deliveryMethod,
  city,
  onCityChange,
  onCityBlur,
  cityError,
  address,
  onAddressChange,
  onAddressBlur,
  addressError,
  addressPlaceholder,
}: NovaPoshtaAddressFieldsProps) {
  const [cityRef, setCityRef] = useState('');
  const [cityOptions, setCityOptions] = useState<CityOption[]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);

  const [warehouseQuery, setWarehouseQuery] = useState(address);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [warehouseLoading, setWarehouseLoading] = useState(false);

  // Поле "Адреса" — контрольоване ззовні (novaPoshtaAddress у
  // CartDrawer), а локальний warehouseQuery потрібен лише для того,
  // щоб покупець міг ввести НОВИЙ пошуковий текст, не змінюючи ще
  // саме обране значення, поки не клацне варіант зі списку
  useEffect(() => {
    setWarehouseQuery(address);
  }, [address]);

  // ---- пошук міста ----
  useEffect(() => {
    const query = city.trim();
    if (query.length < 2) {
      setCityOptions([]);
      setCityLoading(false);
      return;
    }
    setCityLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/nova-poshta/cities?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        setCityOptions(data.success ? data.cities : []);
      } catch {
        // Нова Пошта недоступна — мовчки лишаємо список пустим,
        // покупач і так може ввести назву міста вручну
        setCityOptions([]);
      } finally {
        setCityLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // ---- пошук відділень (тільки для способу "branch", і тільки
  // якщо місто вже реально обрано зі списку — cityRef не пустий) ----
  useEffect(() => {
    if (deliveryMethod !== 'branch' || !cityRef) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryMethod, cityRef, warehouseQuery]);

  const handlePickCity = (option: CityOption) => {
    onCityChange(option.name);
    setCityRef(option.ref);
    setCityOpen(false);
    // Місто змінилось — раніше обране відділення могло належати
    // іншому місту, тому скидаємо і його, щоб не відправити разом
    // "Харків" + "Відділення №3, Львів"
    onAddressChange('');
    setWarehouseQuery('');
  };

  const handlePickWarehouse = (option: WarehouseOption) => {
    onAddressChange(option.description);
    setWarehouseOpen(false);
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      {/* ---- Місто ---- */}
      <div className="relative">
        <input
          type="text"
          value={city}
          onChange={(e) => {
            onCityChange(e.target.value);
            setCityRef('');
            setCityOpen(true);
          }}
          onFocus={() => setCityOpen(true)}
          onBlur={() => {
            // Невеликий таймаут — інакше клік по варіанту списку не
            // встигає спрацювати до того, як onBlur сховає список
            setTimeout(() => setCityOpen(false), 150);
            onCityBlur?.();
          }}
          placeholder="Місто"
          autoComplete="off"
          className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
          style={fieldStyle(!!cityError)}
        />
        {cityError && (
          <p className="mt-1 text-xs" style={{ color: '#FCA5A5' }}>
            {cityError}
          </p>
        )}

        {cityOpen && (cityLoading || cityOptions.length > 0) && (
          <div
            className="absolute z-30 mt-1.5 max-h-52 w-full overflow-y-auto rounded-xl p-1.5"
            style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER_2}`, boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
          >
            {cityLoading && cityOptions.length === 0 ? (
              <p className="px-2.5 py-2 text-xs" style={{ color: TECH_FAINT }}>
                Пошук...
              </p>
            ) : (
              cityOptions.map((option) => (
                <button
                  key={option.ref}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handlePickCity(option)}
                  className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/5"
                  style={{ color: TECH_INK }}
                >
                  {option.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* ---- Відділення/поштомат (пошук за API) або довільна адреса
          кур'єру (просто текст — Нова Пошта не пропонує автопідказку
          для приватних адрес) ---- */}
      {deliveryMethod === 'branch' ? (
        <div className="relative">
          <input
            type="text"
            value={warehouseOpen ? warehouseQuery : address}
            disabled={!cityRef}
            onChange={(e) => {
              setWarehouseQuery(e.target.value);
              setWarehouseOpen(true);
            }}
            onFocus={() => {
              setWarehouseQuery('');
              setWarehouseOpen(true);
            }}
            onBlur={() => {
              setTimeout(() => setWarehouseOpen(false), 150);
              onAddressBlur?.();
            }}
            placeholder={cityRef ? addressPlaceholder : 'Спочатку оберіть місто'}
            autoComplete="off"
            className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A] disabled:opacity-50"
            style={fieldStyle(!!addressError)}
          />
          {addressError && (
            <p className="mt-1 text-xs" style={{ color: '#FCA5A5' }}>
              {addressError}
            </p>
          )}

          {warehouseOpen && cityRef && (warehouseLoading || warehouseOptions.length > 0) && (
            <div
              className="absolute z-30 mt-1.5 max-h-52 w-full overflow-y-auto rounded-xl p-1.5"
              style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER_2}`, boxShadow: '0 16px 40px rgba(0,0,0,0.45)' }}
            >
              {warehouseLoading && warehouseOptions.length === 0 ? (
                <p className="px-2.5 py-2 text-xs" style={{ color: TECH_FAINT }}>
                  Пошук...
                </p>
              ) : (
                warehouseOptions.map((option) => (
                  <button
                    key={option.ref}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handlePickWarehouse(option)}
                    className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs leading-snug transition-colors hover:bg-white/5"
                    style={{ color: TECH_INK }}
                  >
                    {option.isPostomat && (
                      <span
                        className="mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] font-bold"
                        style={{ color: TECH_ACCENT_BRIGHT, background: 'rgba(59,130,246,0.14)' }}
                      >
                        ПОШТОМАТ
                      </span>
                    )}
                    <span>{option.description}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      ) : (
        <div>
          <input
            type="text"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            onBlur={onAddressBlur}
            placeholder={addressPlaceholder}
            className="w-full rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[rgba(59,130,246,0.5)] placeholder:text-[#54607A]"
            style={fieldStyle(!!addressError)}
          />
          {addressError && (
            <p className="mt-1 text-xs" style={{ color: '#FCA5A5' }}>
              {addressError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
