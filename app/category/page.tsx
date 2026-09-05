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
import { TECH_BG, TECH_SURFACE_2, TECH_BORDER, TECH_INK, TECH_MUTED, TECH_FAINT, TECH_DISPLAY_FONT, TECH_BODY_FONT } from '@/lib/techTheme';

export const metadata: Metadata = {
  title: 'Категорії автозапчастин — DominatorParts',
  description:
    'Гальмівні колодки та диски, амортизатори, сайлентблоки, фільтри, свічки та інші деталі для Toyota, Ford, Volkswagen, Audi, Skoda з доставкою по Україні.',
};

export default function CategoryIndexPage() {
  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          / <span>Категорії</span>
        </nav>

        <h1
          className="mb-6 text-3xl md:text-4xl"
          style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff' }}
        >
          Категорії автозапчастин
        </h1>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/category/${c.slug}`}
              className="block rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
              style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
            >
              <div className="mb-1 text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                {c.name}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: TECH_MUTED }}>
                {c.intro.slice(0, 90)}…
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
