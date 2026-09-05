// ============================================================
// Спільна розмітка для шести статичних сторінок (Про нас, Доставка,
// Контакти, Повернення, Оферта, Політика конфіденційності) — Server
// Component (без 'use client': тут немає інтерактивності, тільки
// текст із бази). Контент редагується в адмінці
// (components/SitePagesManager.tsx)
//
// Стиль — темний Tech Premium, той самий, що і на Головній
// (components/StorefrontHome.tsx) та картці товару
// (components/ProductDetailContent.tsx)
// ============================================================

import Link from 'next/link';
import { loadSitePage, SitePageSlug } from '@/lib/sitePages';
import {
  TECH_BG,
  TECH_SURFACE,
  TECH_BORDER,
  TECH_ACCENT_BRIGHT,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
} from '@/lib/techTheme';

export default async function InfoPage({
  slug,
  fallbackTitle,
}: {
  slug: SitePageSlug;
  fallbackTitle: string;
}) {
  const page = await loadSitePage(slug);
  const title = page?.title || fallbackTitle;

  // Абзаци розділені порожнім рядком у textarea адмінки — так само,
  // як звичайний текстовий редактор інтерпретує "новий абзац"
  const paragraphs = (page?.content || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <div className="mx-auto max-w-3xl px-5 py-14 md:px-8">
        <nav className="mb-6 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          / <span>{title}</span>
        </nav>

        <h1
          className="mb-8 text-4xl md:text-5xl"
          style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
        >
          {title}
        </h1>

        {paragraphs.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-base leading-relaxed"
            style={{ background: TECH_SURFACE, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            Сторінка ще наповнюється. Якщо у вас є питання просто зараз — скористайтесь{' '}
            <Link href="/" className="font-medium underline" style={{ color: TECH_ACCENT_BRIGHT }}>
              пошуком або підбором за VIN на Головній
            </Link>
            .
          </div>
        ) : (
          <div
            className="flex flex-col gap-4 rounded-2xl p-6 text-base leading-relaxed md:p-8"
            style={{ background: TECH_SURFACE, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
