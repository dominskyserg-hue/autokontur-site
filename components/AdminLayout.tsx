'use client';

// ============================================================
// Общий каркас админ-панели: тёмная тема + боковое меню слева +
// область контента справа. Используется всеми страницами админки —
// они живут под /admin/* (app/admin/page.tsx — "Поставщики",
// app/admin/settings/page.tsx — "Настройки" и т.д.), а корневой
// адрес "/" теперь отдан клиентской витрине магазина
// (components/StorefrontHome.tsx), чтобы меню и оформление были
// одинаковыми везде в самой админке.
//
// ВАЖНО про оформление: все CSS-переменные (--surface, --line,
// --accent...) объявлены здесь, на самом верхнем div. Дочерние
// компоненты (GlobalRatesWidget, формы на экране поставщиков)
// используют var(--...) и благодаря этому автоматически подхватывают
// тёмную тему — их самих для этого менять не нужно.
//
// Разделы меню "Товары", "Заказы", "Аналитика" пока показаны как
// неактивные (эти экраны ещё не реализованы) — кликнуть на них нельзя,
// это просто витрина того, что появится в проекте позже.
// ============================================================

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Показывается, пока /api/site-settings ещё не ответил — то же
// значение по умолчанию, что и на витрине (components/StorefrontHome.tsx)
const DEFAULT_SHOP_NAME = 'AUTOKONTUR';

// Как часто проверять, не появились ли новые заказы (мс). Это лёгкий
// запрос (status=new&pageSize=1 — берём только totalCount из
// пагинации, ни один заказ целиком не грузится), поэтому раз в 20
// секунд не создаёт заметной нагрузки
const NEW_ORDERS_POLL_INTERVAL_MS = 20_000;

// Короткий двухтональный сигнал через Web Audio API — без отдельного
// аудиофайла, чтобы не тащить в проект бинарный ассет ради одного
// звука. Играет только пока вкладка админки открыта в браузере — это
// осознанно дополнительный, а не единственный канал оповещения (см.
// sendTelegramMessage в lib/telegramNotify.ts — тот работает всегда,
// даже если админку никто не смотрит)
function playNewOrderChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    [880, 1320].forEach((freq, i) => {
      const start = now + i * 0.15;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
  } catch {
    // Web Audio недоступний (рідкісний старий браузер) — тиша замість
    // помилки, це не критично для роботи адмінки
  }
}

export type AdminSection =
  | 'suppliers'
  | 'products'
  | 'crossReferences'
  | 'searchSynonyms'
  | 'orders'
  | 'customerDiscounts'
  | 'vinRequests'
  | 'analytics'
  | 'settings';

interface NavItem {
  key: AdminSection | 'products' | 'orders' | 'analytics';
  label: string;
  href: string | null; // null — раздел ещё не реализован, ссылка неактивна
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'КАТАЛОГ',
    items: [
      { key: 'suppliers', label: 'Поставщики', href: '/admin' },
      { key: 'products', label: 'Товары', href: '/admin/products' },
      { key: 'crossReferences', label: 'Кроссы', href: '/admin/cross-references' },
      { key: 'searchSynonyms', label: 'Словник пошуку', href: '/admin/search-synonyms' },
    ],
  },
  {
    title: 'ПРОДАЖИ',
    items: [
      { key: 'orders', label: 'Заказы', href: '/admin/orders' },
      { key: 'customerDiscounts', label: 'Скидки клиентам', href: '/admin/customer-discounts' },
      { key: 'vinRequests', label: 'VIN-запросы', href: '/admin/vin-requests' },
      { key: 'analytics', label: 'Аналитика', href: '/admin/analytics' },
    ],
  },
  {
    title: 'СИСТЕМА',
    items: [{ key: 'settings', label: 'Настройки', href: '/admin/settings' }],
  },
];

// Токены оформления (CSS custom properties) — тёмная тема.
// "as CSSProperties" — потому что стандартный тип CSSProperties не
// знает заранее про произвольные "--имя-переменной"
const rootStyle = {
  '--bg': '#0B0F17',
  '--surface': '#131826',
  '--surface-2': '#1A2233',
  '--line': '#232B3D',
  '--ink': '#E7ECF3',
  '--ink-muted': '#8B96AB',
  '--ink-faint': '#5D687D',
  '--accent': '#5B6EF5',
  '--accent-hover': '#4756D6',
  '--accent-ink': '#FFFFFF',
  '--accent-soft': '#1B2142',
  '--bad': '#F2635F',
  '--bad-soft': '#3A1E22',
  '--good': '#3FBE8B',
  '--good-soft': '#12301F',
  '--warn': '#F2A65A',
  '--warn-soft': '#3A2A16',
  background: 'var(--bg)',
  color: 'var(--ink)',
} as CSSProperties;

export default function AdminLayout({
  active,
  children,
}: {
  active: AdminSection;
  children: ReactNode;
}) {
  // Название магазина настраивается на экране "Настройки"
  // (components/ContactSettingsForm.tsx) и хранится в той же таблице
  // site_settings, что читает и витрина — здесь просто подтягиваем
  // его же, чтобы шапка админки не расходилась с реальным названием
  const [shopName, setShopName] = useState(DEFAULT_SHOP_NAME);

  useEffect(() => {
    fetch('/api/site-settings')
      .then((response) => response.json())
      .then((data) => {
        if (data.settings?.shopName) setShopName(data.settings.shopName);
      })
      .catch(() => {
        // Не получилось — остаёмся с названием по умолчанию, это не
        // критично для работы самой админки
      });
  }, []);

  // ---- бейдж "новые заказы" в пункте меню + звук при появлении ----
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  // useRef, а не просто сравнение с предыдущим состоянием в замыкании:
  // нужно знать, был ли это ПЕРВЫЙ опрос за сессию — если да, звук не
  // играем (иначе он звучал бы при каждом открытии админки, если в ней
  // уже накопились необработанные заказы, а не только при НОВЫХ)
  const isFirstPollRef = useRef(true);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch('/api/orders?status=new&pageSize=1');
        const data = await response.json();
        if (cancelled || !data.success) return;

        const count = data.pagination?.totalCount ?? 0;
        setNewOrdersCount((previousCount) => {
          if (!isFirstPollRef.current && count > previousCount) {
            playNewOrderChime();
          }
          return count;
        });
        isFirstPollRef.current = false;
      } catch {
        // Сбой опроса — не критично, просто попробуем ещё раз через
        // обычный интервал, без отдельной обработки ошибки в UI
      }
    };

    poll();
    const intervalId = window.setInterval(poll, NEW_ORDERS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  // ВЫХОД — стирает cookie-сессию (см. app/api/admin/logout/route.ts),
  // затем полной перезагрузкой уходит на экран входа. Полная
  // перезагрузка (а не клиентская навигация) — чтобы middleware.ts
  // сразу увидел, что сессии больше нет, и не пришлось ждать лишний круг
  const handleLogout = async () => {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      window.location.href = '/admin/login';
    }
  };

  return (
    <div className="min-h-screen flex" style={rootStyle}>
      {/* ==================== БОКОВОЕ МЕНЮ ==================== */}
      <aside
        className="w-60 shrink-0 px-4 py-6 hidden md:flex md:flex-col gap-6"
        style={{ borderRight: '1px solid var(--line)' }}
      >
        <div className="flex items-center gap-2 px-2">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {shopName.charAt(0).toUpperCase()}
          </div>
          <span className="font-semibold tracking-wide text-sm">{shopName}</span>
        </div>

        <nav className="flex flex-col gap-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p
                className="px-2 mb-1.5 text-[11px] font-semibold tracking-wider"
                style={{ color: 'var(--ink-faint)' }}
              >
                {group.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = item.key === active;
                  const isEnabled = item.href !== null;

                  if (isEnabled) {
                    return (
                      <Link
                        key={item.key}
                        href={item.href as string}
                        className="flex items-center justify-between gap-2 px-2 py-2 rounded-md text-sm font-medium"
                        style={{
                          background: isActive ? 'var(--accent-soft)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
                        }}
                      >
                        <span>{item.label}</span>
                        {item.key === 'orders' && newOrdersCount > 0 && (
                          <span
                            className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
                            style={{ background: 'var(--bad)', color: '#fff' }}
                          >
                            {newOrdersCount}
                          </span>
                        )}
                      </Link>
                    );
                  }

                  return (
                    <span
                      key={item.key}
                      title="Этот раздел ещё не реализован"
                      className="px-2 py-2 rounded-md text-sm font-medium cursor-not-allowed"
                      style={{ color: 'var(--ink-faint)' }}
                    >
                      {item.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-auto px-2 py-2 rounded-md text-sm font-medium text-left"
          style={{ color: 'var(--ink-faint)' }}
        >
          Выйти
        </button>
      </aside>

      {/* ==================== ОБЛАСТЬ КОНТЕНТА ==================== */}
      <div className="flex-1 min-w-0 overflow-x-hidden">
        <div className="max-w-6xl mx-auto px-5 md:px-10 py-8">{children}</div>
      </div>
    </div>
  );
}
