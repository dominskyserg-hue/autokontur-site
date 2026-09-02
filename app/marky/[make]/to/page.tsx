// ============================================================
// "Регламент ТО для марки" — /marky/[make]/to
//
// Ідея підглянута в конкурента (cardon.com.ua): замість того, щоб
// показувати покупцю ВСІ 3000+ товарів марки одним потоком (як робить
// /marky/[make]), тут — по одній секції на кожну категорію планового
// ТО (олива, фільтри, свічки, ремінь ГРМ, гальма), з кількома
// прикладами товарів і посиланням "показати всі" на відповідну
// категорію, вже відфільтровану під цю марку (/category/[slug]?marka=).
//
// Технічно це НЕ нова таблиця й не нові дані — просто перетин двох
// вже наявних фільтрів (lib/categories.ts + lib/carMakes.ts) через
// lib/productFilters.ts
// ============================================================

import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { CategoryDef, getToCategories } from '@/lib/categories';
import { CarMakeDef, getCarMakeBySlug } from '@/lib/carMakes';
import { buildCategoryAndMakeWhereClause } from '@/lib/productFilters';

export const runtime = 'nodejs';
// Захист від спроби зібрати сторінку заздалегідь під час білда на
// Vercel (де немає доступу до бази) — див. app/marky/page.tsx
export const dynamic = 'force-dynamic';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

const PREVIEW_SIZE = 4;

interface ToProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  deliveryTime: string | null;
}

interface ToSection {
  category: CategoryDef;
  products: ToProduct[];
  total: number;
}

const loadToSections = cache(async function loadToSections(makeSlug: string): Promise<ToSection[]> {
  const make = getCarMakeBySlug(makeSlug);
  if (!make) return [];

  const categories = getToCategories();

  return Promise.all(
    categories.map(async (category): Promise<ToSection> => {
      const { clause, params } = buildCategoryAndMakeWhereClause(category, make, 1);

      const [productsResult, countResult] = await Promise.all([
        pool.query(
          `
          SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.stock, s.delivery_time
          FROM products p
          JOIN suppliers s ON s.id = p.supplier_id
          WHERE ${clause}
          ORDER BY (p.stock > 0) DESC, p.name ASC NULLS LAST
          LIMIT $${params.length + 1}
          `,
          [...params, PREVIEW_SIZE]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`,
          params
        ),
      ]);

      const products: ToProduct[] = productsResult.rows.map((row) => ({
        id: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        retailPrice: parseFloat(row.retail_price),
        stock: row.stock,
        deliveryTime: row.delivery_time,
      }));

      return { category, products, total: countResult.rows[0]?.total ?? 0 };
    })
  );
});

type PageParams = { make: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { make: slug } = await params;
  const make = getCarMakeBySlug(slug);
  if (!make) return {};

  const sections = await loadToSections(slug);
  const totalAcrossAll = sections.reduce((sum, s) => sum + s.total, 0);

  return {
    title: `ТО для ${make.name} — фільтри, оливи, свічки, гальма | DominatorParts`,
    description: `Регламент планового ТО для ${make.name}: оливний, повітряний і салонний фільтри, свічки запалювання, ремінь ГРМ, гальмівні колодки та диски. Доставка по Україні.`,
    robots: totalAcrossAll === 0 ? { index: false, follow: true } : undefined,
  };
}

const BG = '#F5F6F9';
const PANEL_SOFT = '#EAEDF2';
const BORDER_SOFT = '#DDE2EA';
const RED = '#1D5FD6';
const YELLOW = '#1D5FD6';
const PAPER = '#12192A';
const SUCCESS_TEXT = '#15803D';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

function formatMoney(value: number): string {
  return value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function MakeToPage({ params }: { params: Promise<PageParams> }) {
  const { make: slug } = await params;
  const make = getCarMakeBySlug(slug);
  if (!make) notFound();

  const sections = await loadToSections(slug);

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          /{' '}
          <Link href="/marky" className="underline">
            Марки авто
          </Link>{' '}
          /{' '}
          <Link href={`/marky/${slug}`} className="underline">
            {make.name}
          </Link>{' '}
          / <span>ТО</span>
        </nav>

        <header className="mb-8">
          <h1
            className="text-3xl md:text-4xl mb-3"
            style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
          >
            Регламент ТО для {make.name}
          </h1>
          <p className="text-sm max-w-2xl" style={{ color: PAPER, opacity: 0.85 }}>
            Що зазвичай перевіряють і міняють на плановому ТО: оливні рідини й фільтри, свічки запалювання,
            ремінь ГРМ, а також гальмівні колодки й диски (їх перевіряють щоразу, міняють — за зносом).
            Нижче — по кілька варіантів з наявності під {make.name}, повний список — за посиланням
            "показати всі".
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {sections.map(({ category, products, total }) => (
            <section key={category.slug}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-xl" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
                  {category.name}
                </h2>
                {total > 0 && (
                  <Link
                    href={`/category/${category.slug}?marka=${slug}`}
                    className="text-xs font-semibold uppercase tracking-wide underline shrink-0"
                    style={{ color: RED }}
                  >
                    Показати всі {total.toLocaleString('uk-UA')} →
                  </Link>
                )}
              </div>

              {products.length === 0 ? (
                <p className="text-sm p-4 rounded-md" style={{ background: PANEL_SOFT, opacity: 0.8 }}>
                  Поки немає в наявності для {make.name}.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {products.map((product) => (
                    <Link
                      key={product.id}
                      href={`/?article=${encodeURIComponent(product.article)}`}
                      className="block p-4 rounded-md transition-colors hover:opacity-90 hover:shadow-sm"
                      style={{ background: '#FFFFFF', border: `1px solid ${BORDER_SOFT}` }}
                    >
                      <div className="text-xs uppercase mb-1" style={{ color: YELLOW, opacity: 0.9 }}>
                        {product.brand || 'Без бренду'} · {product.article}
                      </div>
                      <div className="text-sm mb-2 line-clamp-2" style={{ color: PAPER }}>
                        {product.name || category.name}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-semibold" style={{ fontFamily: DISPLAY_FONT }}>
                          {formatMoney(product.retailPrice)} грн
                        </span>
                        <span
                          className="text-[11px] px-1.5 py-0.5 rounded"
                          style={{
                            background: product.stock > 0 ? '#DCFCE7' : PANEL_SOFT,
                            color: product.stock > 0 ? SUCCESS_TEXT : PAPER,
                          }}
                        >
                          {product.stock > 0 ? 'В наявності' : 'Під замовлення'}
                        </span>
                      </div>
                      {product.stock <= 0 && product.deliveryTime && (
                        <div className="text-[11px] mt-1" style={{ color: PAPER, opacity: 0.7 }}>
                          Термін поставки: {product.deliveryTime}
                        </div>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="pt-8 mt-8" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
          <Link href={`/marky/${slug}`} className="text-sm underline" style={{ color: RED }}>
            ← Усі запчастини для {make.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
