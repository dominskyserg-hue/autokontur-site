// ============================================================
// Індекс усіх категорій — /category
//
// Потрібен з двох причин:
//   1. SEO: внутрішнє посилання з Головної сюди і звідси на кожну
//      категорію — Google знаходить нові сторінки саме по посиланнях,
//      а не тільки через sitemap.
//   2. Зручність: покупець, який не знає точного артикула, може
//      просто обрати категорію деталі.
// ============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { CATEGORIES } from '@/lib/categories';

export const metadata: Metadata = {
  title: 'Категорії автозапчастин — DominatorParts',
  description:
    'Гальмівні колодки та диски, амортизатори, сайлентблоки, фільтри, свічки та інші деталі для Toyota, Ford, Volkswagen, Audi, Skoda з доставкою по Україні.',
};

// Світла палітра "Workshop" — узгоджена з components/StorefrontHome.tsx
const BG = '#FAF7F2';
const BORDER_SOFT = '#E3DAC9';
const RED = '#E5231C';
const YELLOW = '#B45309';
const PAPER = '#1C1917';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

export default function CategoryIndexPage() {
  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          / <span>Категорії</span>
        </nav>

        <h1
          className="text-3xl md:text-4xl mb-6"
          style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
        >
          Категорії автозапчастин
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="block p-4 rounded-md hover:shadow-sm transition-shadow"
              style={{ background: '#FFFFFF', border: `1px solid ${BORDER_SOFT}`, borderLeft: `3px solid ${RED}` }}
            >
              <div className="text-lg mb-1" style={{ fontFamily: DISPLAY_FONT, color: PAPER }}>
                {c.name}
              </div>
              <div className="text-xs opacity-75">{c.intro.slice(0, 90)}…</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
