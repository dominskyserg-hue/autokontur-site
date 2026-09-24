// ============================================================
// Легка шапка сайту — ЛИШЕ для сторінок, які рендеряться БЕЗ повної
// шапки Головної (components/StorefrontHome.tsx, там повна шапка з
// пошуком і кошиком): окрема сторінка товару (app/p/...), сторінки
// категорій (app/category/...) і марок авто (app/marky/...). Усі
// вони можуть бути ПЕРШОЮ сторінкою, яку бачить покупець (посилання
// з Google, "Поділитись") — під низом немає вже змонтованої Головної
// з її шапкою, як буває в модальному вікні товару.
//
// ІСТОРІЯ: покупець писав, що товар з Google-пошуку "відкриває на
// весь екран, не красиво" — сторінка показувала лише хлібні крихти
// на порожньому тлі, без жодного логотипу чи посилання на сайт. Ця
// шапка дає такій сторінці той самий фірмовий вигляд, що і решті
// сайту, і робоче посилання на Головну. Потім те саме попросили і
// для категорій/марок — там була та сама відсутність шапки (хоча
// крихта "Головна" там і так вела на "/" правильно, на відміну від
// сторінки товару, де саме ця крихта була зламана — див. виправлення
// href у components/ProductDetailContent.tsx)
// ============================================================

import Link from 'next/link';
import { TECH_ACCENT_BRIGHT, TECH_DISPLAY_FONT, TECH_BODY_FONT, TECH_INK, TECH_MUTED } from '@/lib/techTheme';

export default function SiteHeader() {
  return (
    <header style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <svg viewBox="0 0 120 120" width="34" height="34" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="42" stroke={TECH_ACCENT_BRIGHT} strokeWidth="7" />
            <g fill={TECH_ACCENT_BRIGHT}>
              <rect x="54" y="4" width="12" height="18" />
              <rect x="54" y="98" width="12" height="18" />
              <rect x="4" y="54" width="18" height="12" />
              <rect x="98" y="54" width="18" height="12" />
              <rect x="54" y="4" width="12" height="18" transform="rotate(45 60 60)" />
              <rect x="54" y="4" width="12" height="18" transform="rotate(135 60 60)" />
              <rect x="54" y="4" width="12" height="18" transform="rotate(225 60 60)" />
              <rect x="54" y="4" width="12" height="18" transform="rotate(315 60 60)" />
            </g>
            <rect x="50" y="22" width="20" height="16" rx="2" fill={TECH_ACCENT_BRIGHT} />
            <g stroke={TECH_ACCENT_BRIGHT} strokeWidth="5" fill="none" strokeLinecap="round">
              <line x1="60" y1="38" x2="60" y2="50" />
              <path d="M52 50 L68 50 L52 58 L68 58 L52 66 L68 66 L52 74 L68 74" />
            </g>
            <circle cx="60" cy="84" r="4" fill={TECH_ACCENT_BRIGHT} />
          </svg>
          <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em', color: TECH_INK }}>
            DOMINATORPARTS
          </span>
        </Link>

        <nav className="flex items-center gap-4 text-xs" style={{ fontFamily: TECH_BODY_FONT }}>
          <Link href="/category" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Категорії
          </Link>
          <Link href="/marky" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Марки авто
          </Link>
        </nav>
      </div>
    </header>
  );
}
