'use client';

// ============================================================
// Повна шапка для сторінки товару (app/p/[id]/...) — як на Головній
// (components/StorefrontHome.tsx): пошук за артикулом, телефон і години
// роботи, Telegram, кабінет, кошик з лічильником, меню на мобільному.
//
// Раніше сторінка товару мала лише легку шапку (components/SiteHeader.tsx:
// логотип + "Категорії"/"Марки авто") — покупець, що прийшов з Google
// прямо на товар, не бачив ні пошуку, ні кошика, ні телефону.
//
// Кошик живе в localStorage (той самий ключ, що й на Головній і в
// components/AddToCartButton.tsx). Лічильник оновлюється:
//   - при завантаженні сторінки;
//   - подією CART_UPDATED_EVENT, яку шле AddToCartButton після додавання;
//   - подією "storage" (кошик змінили в іншій вкладці).
// Клік по кошику — перехід на "/?cart=1" (Головна відкриє панель кошика),
// пошук — на "/?article=..." (Головна одразу виконає пошук за артикулом)
// ============================================================

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Send, ShoppingCart, User, Phone, Menu, X } from 'lucide-react';
import { DominatorLogo } from '@/components/SiteHeader';
import { isCustomerCabinetEnabled } from '@/lib/customerCabinet';
import {
  TECH_ACCENT,
  TECH_ACCENT_BRIGHT,
  TECH_BORDER,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
} from '@/lib/techTheme';

const CART_STORAGE_KEY = 'autokontur-cart';
export const CART_UPDATED_EVENT = 'autokontur:cart-updated';
const TELEGRAM_BOT_USERNAME = 'dominatorparts_orders_bot';

function readCartCount(): number {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    const cart: Array<{ quantity?: number }> = raw ? JSON.parse(raw) : [];
    return cart.reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  } catch {
    // localStorage недоступний / зіпсовані дані — показуємо порожній кошик
    return 0;
  }
}

interface SiteHeaderFullProps {
  shopName: string;
  phone: string;
  workingHours: string;
}

export default function SiteHeaderFull({ shopName, phone, workingHours }: SiteHeaderFullProps) {
  const router = useRouter();
  const [cartCount, setCartCount] = useState(0);
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const phoneHref = `tel:${phone.replace(/[^\d+]/g, '')}`;

  useEffect(() => {
    const update = () => setCartCount(readCartCount());
    update();
    window.addEventListener(CART_UPDATED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    router.push(`/?article=${encodeURIComponent(value)}`);
  };

  const searchForm = (className: string) => (
    <form onSubmit={handleSearch} className={className} role="search">
      <div
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER}` }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: TECH_FAINT }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Пошук за артикулом"
          aria-label="Пошук за артикулом"
          className="w-full bg-transparent text-sm outline-none placeholder:text-[#54607A]"
          style={{ fontFamily: TECH_BODY_FONT, color: TECH_INK }}
        />
      </div>
    </form>
  );

  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-xl"
      style={{ background: 'rgba(11,15,23,0.86)', borderBottom: `1px solid ${TECH_BORDER}` }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:gap-4 md:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <DominatorLogo />
          <span
            className="hidden sm:inline"
            style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em', color: TECH_INK }}
          >
            {shopName.toUpperCase()}
          </span>
        </Link>

        {/* Пошук — на десктопі в рядку шапки, на мобільному окремим рядком нижче */}
        {searchForm('hidden flex-1 md:flex max-w-md')}

        <div className="ml-auto flex items-center gap-1.5 md:gap-2">
          <a
            href={phoneHref}
            className="hidden items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs lg:flex"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
            title={workingHours}
          >
            <Phone className="h-3.5 w-3.5" style={{ color: TECH_ACCENT_BRIGHT }} />
            {phone}
          </a>
          <a
            href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-white/5 md:flex"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
            title="Написати нам у Telegram"
          >
            <Send className="h-3.5 w-3.5" style={{ color: TECH_ACCENT_BRIGHT }} />
            Telegram
          </a>
          <Link
            href="/category"
            className="hidden rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-white/5 xl:flex"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
          >
            Категорії
          </Link>
          <Link
            href="/marky"
            className="hidden rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-white/5 xl:flex"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
          >
            Марки авто
          </Link>
          {/* Скрыт, пока кабинет выключен (lib/customerCabinet.ts) */}
          {isCustomerCabinetEnabled() && (
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
              aria-label="Кабінет"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Кабінет</span>
            </Link>
          )}
          <Link
            href="/?cart=1"
            className="relative flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold"
            style={{ fontFamily: TECH_BODY_FONT, background: TECH_ACCENT, color: '#fff' }}
            aria-label={`Кошик${cartCount > 0 ? `: ${cartCount}` : ''}`}
          >
            <ShoppingCart className="h-4 w-4" />
            <span className="hidden sm:inline">Кошик</span>
            {cartCount > 0 && (
              <span
                className="absolute -right-2 -top-2 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-bold"
                style={{ background: '#fff', color: TECH_ACCENT }}
              >
                {cartCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Меню"
            className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-white/5 md:hidden"
            style={{ color: TECH_INK }}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Пошук на мобільному — завжди видимий другим рядком */}
      <div className="px-4 pb-3 md:hidden">{searchForm('flex')}</div>

      {menuOpen && (
        <nav className="flex flex-col gap-1 px-4 pb-4 md:hidden" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          {[
            { href: '/category', label: 'Категорії' },
            { href: '/marky', label: 'Марки авто' },
            { href: '/pidbir-za-vin', label: 'Підбір за VIN' },
            { href: '/delivery', label: 'Доставка і оплата' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
              style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
            >
              {item.label}
            </Link>
          ))}
          <a
            href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
          >
            <Send className="h-4 w-4" style={{ color: TECH_ACCENT_BRIGHT }} />
            Написати в Telegram
          </a>
          <a
            href={phoneHref}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ fontFamily: TECH_BODY_FONT, color: TECH_MUTED }}
          >
            <Phone className="h-4 w-4" style={{ color: TECH_ACCENT_BRIGHT }} />
            {phone} · {workingHours}
          </a>
        </nav>
      )}
    </header>
  );
}
