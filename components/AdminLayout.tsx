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
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// Показывается, пока /api/site-settings ещё не ответил — то же
// значение по умолчанию, что и на витрине (components/StorefrontHome.tsx)
const DEFAULT_SHOP_NAME = 'AUTOKONTUR';

export type AdminSection =
  | 'suppliers'
  | 'products'
  | 'crossReferences'
  | 'searchSynonyms'
  | 'orders'
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
                        className="px-2 py-2 rounded-md text-sm font-medium"
                        style={{
                          background: isActive ? 'var(--accent-soft)' : 'transparent',
                          color: isActive ? 'var(--accent)' : 'var(--ink-muted)',
                        }}
                      >
                        {item.label}
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
