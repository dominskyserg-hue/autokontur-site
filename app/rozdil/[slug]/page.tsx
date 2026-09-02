// ============================================================
// Хаб-сторінка "розділу" авто — /rozdil/[slug]
//
// Розділ (lib/departments.ts) — це широка група на кшталт "Двигун
// в зборі" чи "Гальма і ходова частина", яка сама по собі не має
// товарів: вона лише збирає під одним заголовком декілька вже
// існуючих вузьких категорій (lib/categories.ts) і посилається на
// їхні сторінки /category/[slug]. Тому ця сторінка НЕ звертається
// до бази даних — просто показує список категорій розділу
// ============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDepartmentBySlug } from '@/lib/departments';
import { getCategoryBySlug } from '@/lib/categories';

// Світла палітра "Workshop" — узгоджена з components/StorefrontHome.tsx
const BG = '#F5F6F9';
const BORDER_SOFT = '#DDE2EA';
const RED = '#1D5FD6';
const YELLOW = '#1D5FD6';
const PAPER = '#12192A';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

type PageParams = { slug: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { slug } = await params;
  const department = getDepartmentBySlug(slug);
  if (!department || department.categorySlugs.length === 0) return {};

  return {
    title: `${department.name} — запчастини з доставкою | DominatorParts`,
    description: `${department.name}: підбирайте потрібну категорію запчастин за артикулом або маркою авто. Доставка по всій Україні.`,
  };
}

export default async function DepartmentPage({ params }: { params: Promise<PageParams> }) {
  const { slug } = await params;
  const department = getDepartmentBySlug(slug);

  // Розділи без жодної категорії (поки що) на цю сторінку не ведуть —
  // на головній вони відкривають підбір за VIN замість посилання сюди
  if (!department || department.categorySlugs.length === 0) notFound();

  const categories = department.categorySlugs
    .map((s) => getCategoryBySlug(s))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          / <span>{department.name}</span>
        </nav>

        <h1
          className="text-3xl md:text-4xl mb-3"
          style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
        >
          {department.name}
        </h1>
        <p className="text-sm max-w-2xl mb-8" style={{ opacity: 0.85 }}>
          Оберіть категорію, щоб побачити товари в наявності — або скористайтесь пошуком за артикулом чи VIN
          на Головній, якщо потрібної деталі немає в списку нижче.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="block p-5 rounded-md hover:shadow-sm transition-shadow"
              style={{ background: '#FFFFFF', border: `1px solid ${BORDER_SOFT}`, borderLeft: `3px solid ${RED}` }}
            >
              <div className="text-lg mb-1.5" style={{ fontFamily: DISPLAY_FONT, color: PAPER }}>
                {category.name}
              </div>
              <p className="text-xs leading-relaxed" style={{ opacity: 0.75 }}>
                {category.intro}
              </p>
            </Link>
          ))}
        </div>

        <div className="pt-8 mt-8" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
          <Link href="/" className="text-sm underline" style={{ color: RED }}>
            ← На головну
          </Link>
        </div>
      </div>
    </div>
  );
}
