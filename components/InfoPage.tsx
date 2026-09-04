// ============================================================
// Спільна розмітка для трьох статичних сторінок (Про нас, Доставка,
// Контакти) — Server Component (без 'use client': тут немає
// інтерактивності, тільки текст із бази). Контент редагується в
// адмінці (components/SitePagesManager.tsx)
// ============================================================

import Link from 'next/link';
import { loadSitePage, SitePageSlug } from '@/lib/sitePages';

// Ті самі кольори бренду, що й на вітрині (components/StorefrontHome.tsx) —
// раніше тут була стара червоно-жовта палітра, яка не збігалася з рештою
// сайту (там уже давно синій акцент)
const BG = '#F5F6F9';
const ACCENT = '#1D5FD6';
const PAPER = '#12192A';
const MUTED = '#5C6678';
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
          className="text-6xl md:text-7xl mb-6"
          style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: ACCENT }}
        >
          {title}
        </h1>

        {paragraphs.length === 0 ? (
          <p className="text-xl" style={{ color: MUTED }}>
            Сторінка ще наповнюється. Якщо у вас є питання просто зараз — скористайтесь{' '}
            <Link href="/" className="underline" style={{ color: ACCENT }}>
              пошуком або підбором за VIN на Головній
            </Link>
            .
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-xl leading-relaxed">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
