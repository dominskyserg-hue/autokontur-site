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
import { getCarMakeBySlug } from '@/lib/carMakes';
import { buildCategoryAndMakeWhereClause } from '@/lib/productFilters';
import { buildBreadcrumbJsonLd, buildProductListJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import {
  TECH_BG,
  TECH_SURFACE_2,
  TECH_BORDER,
  TECH_ACCENT_BRIGHT,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_HEAT,
  TECH_HEAT_SOFT,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
  TECH_MONO_FONT,
} from '@/lib/techTheme';

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

// Копійки покупцю не показуємо — тільки цілі гривні, округлені ВГОРУ
function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

function StockBadge({ stock }: { stock: number }) {
  const inStock = stock > 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        fontFamily: TECH_BODY_FONT,
        background: inStock ? TECH_GOOD_SOFT : TECH_HEAT_SOFT,
        color: inStock ? TECH_GOOD : TECH_HEAT,
      }}
    >
      {inStock ? 'В наявності' : 'Під замовлення'}
    </span>
  );
}

export default async function MakeToPage({ params }: { params: Promise<PageParams> }) {
  const { make: slug } = await params;
  const make = getCarMakeBySlug(slug);
  if (!make) notFound();

  const sections = await loadToSections(slug);

  // Товари розбиті по секціях (одна на категорію ТО) — для ItemList
  // збираємо їх в один список, де б той самий товар не потрапив
  // двічі, якщо раптом підпаде під дві категорії одразу
  const uniqueProducts = Array.from(
    new Map(sections.flatMap((s) => s.products).map((p) => [p.id, p])).values()
  );

  // Порядок ТОЧНО повторює видиму <nav> нижче — Google звіряє одне з
  // іншим
  const breadcrumbItems = [
    { name: 'Головна', url: SITE_URL },
    { name: 'Марки авто', url: `${SITE_URL}/marky` },
    { name: make.name, url: `${SITE_URL}/marky/${slug}` },
    { name: 'ТО', url: `${SITE_URL}/marky/${slug}/to` },
  ];

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      {uniqueProducts.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: jsonLdScript(buildProductListJsonLd(uniqueProducts)) }}
        />
      )}
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          /{' '}
          <Link href="/marky" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Марки авто
          </Link>{' '}
          /{' '}
          <Link href={`/marky/${slug}`} className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            {make.name}
          </Link>{' '}
          / <span>ТО</span>
        </nav>

        <header className="mb-8">
          <h1
            className="mb-3 text-3xl md:text-4xl"
            style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
          >
            Регламент ТО для {make.name}
          </h1>
          <p className="max-w-2xl text-sm" style={{ color: TECH_MUTED }}>
            Що зазвичай перевіряють і міняють на плановому ТО: оливні рідини й фільтри, свічки запалювання,
            ремінь ГРМ, а також гальмівні колодки й диски (їх перевіряють щоразу, міняють — за зносом).
            Нижче — по кілька варіантів з наявності під {make.name}, повний список — за посиланням
            "показати всі".
          </p>
        </header>

        <div className="flex flex-col gap-10">
          {sections.map(({ category, products, total }) => (
            <section key={category.slug}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xl" style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, color: '#fff' }}>
                  {category.name}
                </h2>
                {total > 0 && (
                  <Link
                    href={`/category/${category.slug}?marka=${slug}`}
                    className="shrink-0 text-xs font-semibold uppercase tracking-wide underline"
                    style={{ color: TECH_ACCENT_BRIGHT }}
                  >
                    Показати всі {total.toLocaleString('uk-UA')} →
                  </Link>
                )}
              </div>

              {products.length === 0 ? (
                <p className="rounded-xl p-4 text-sm" style={{ background: TECH_SURFACE_2, color: TECH_FAINT }}>
                  Поки немає в наявності для {make.name}.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {products.map((product) => (
                    <Link
                      key={product.id}
                      href={buildProductPath(product.id, product)}
                      className="block rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                      style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[11px]" style={{ fontFamily: TECH_BODY_FONT }}>
                        <span className="font-bold uppercase tracking-wide" style={{ color: TECH_ACCENT_BRIGHT }}>
                          {product.brand || 'Без бренду'}
                        </span>
                        <span style={{ color: TECH_FAINT }}>·</span>
                        <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_MUTED }}>{product.article}</span>
                      </div>
                      <div className="mb-2 line-clamp-2 text-sm" style={{ color: TECH_INK }}>
                        {product.name || category.name}
                      </div>
                      <div className="flex items-center justify-between">
                        <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 16, color: '#fff' }}>
                          {formatMoney(product.retailPrice)} грн
                        </span>
                        <StockBadge stock={product.stock} />
                      </div>
                      {product.stock <= 0 && product.deliveryTime && (
                        <div className="mt-1 text-[11px]" style={{ color: TECH_FAINT }}>
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

        <div className="mt-8 pt-8" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <Link href={`/marky/${slug}`} className="text-sm underline" style={{ color: TECH_ACCENT_BRIGHT }}>
            ← Усі запчастини для {make.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
