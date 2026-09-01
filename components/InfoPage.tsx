// ============================================================
// Спільна розмітка для трьох статичних сторінок (Про нас, Доставка,
// Контакти) — Server Component (без 'use client': тут немає
// інтерактивності, тільки текст із бази). Контент редагується в
// адмінці (components/SitePagesManager.tsx)
// ============================================================

import Link from 'next/link';
import { loadSitePage, SitePageSlug } from '@/lib/sitePages';

const BG = '#FAF7F2';
const RED = '#E5231C';
const YELLOW = '#B45309';
const PAPER = '#1C1917';
const MUTED = '#6B6560';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

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
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-3xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          / <span>{title}</span>
        </nav>

        <h1
          className="text-3xl md:text-4xl mb-6"
          style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
        >
          {title}
        </h1>

        {paragraphs.length === 0 ? (
          <p className="text-sm" style={{ color: MUTED }}>
            Сторінка ще наповнюється. Якщо у вас є питання просто зараз — скористайтесь{' '}
            <Link href="/" className="underline" style={{ color: RED }}>
              пошуком або підбором за VIN на Головній
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm leading-relaxed">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
