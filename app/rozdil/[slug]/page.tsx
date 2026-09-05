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
import { TECH_BG, TECH_SURFACE_2, TECH_BORDER, TECH_ACCENT_BRIGHT, TECH_INK, TECH_MUTED, TECH_FAINT, TECH_DISPLAY_FONT, TECH_BODY_FONT } from '@/lib/techTheme';

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
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          / <span>{department.name}</span>
        </nav>

        <h1
          className="mb-3 text-3xl md:text-4xl"
          style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff' }}
        >
          {department.name}
        </h1>
        <p className="mb-8 max-w-2xl text-sm" style={{ color: TECH_MUTED }}>
          Оберіть категорію, щоб побачити товари в наявності — або скористайтесь пошуком за артикулом чи VIN
          на Головній, якщо потрібної деталі немає в списку нижче.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/category/${category.slug}`}
              className="block rounded-xl p-5 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
              style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
            >
              <div className="mb-1.5 text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                {category.name}
              </div>
              <p className="text-xs leading-relaxed" style={{ color: TECH_MUTED }}>
                {category.intro}
              </p>
            </Link>
          ))}
        </div>

        <div className="mt-8 pt-8" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <Link href="/" className="text-sm underline" style={{ color: TECH_ACCENT_BRIGHT }}>
            ← На головну
          </Link>
        </div>
      </div>
    </div>
  );
}
