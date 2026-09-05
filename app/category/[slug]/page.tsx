// ============================================================
// SEO-сторінка категорії деталей — /category/[slug]
//
// На відміну від Головної (components/StorefrontHome.tsx, client
// component з пошуком через fetch), ця сторінка — звичайний Server
// Component: рендериться на сервері з готовим HTML і мета-тегами під
// конкретний запит ("гальмівні колодки купити" тощо), тому Google
// має що індексувати — раніше під ці запити взагалі не було сторінки.
//
// Категорія товару НЕ зберігається в базі окремим полем — вона
// визначається на льоту пошуком ключових слів у products.name (див.
// lib/categories.ts). Це свідомий компроміс: без міграції бази і
// без ручної розмітки тисяч товарів з прайсів постачальників.
//
// runtime = 'nodejs', бо використовується бібліотека "pg" (як і в
// усіх API-роутах проекту) — вона не працює в Edge Runtime
// ============================================================

import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { CATEGORIES, getCategoryBySlug } from '@/lib/categories';
import { getCarMakeBySlug } from '@/lib/carMakes';
import { buildCategoryAndMakeWhereClause } from '@/lib/productFilters';
import { buildBreadcrumbJsonLd, buildProductListJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import {
  TECH_BG,
  TECH_SURFACE,
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

const PAGE_SIZE = 24;

interface CategoryProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  deliveryTime: string | null;
}

// cache() від React дедуплікує виклик У МЕЖАХ ОДНОГО HTTP-запиту —
// generateMetadata() і сам компонент сторінки викликають цю функцію
// з однаковими аргументами, але SQL-запит реально піде в базу лише
// один раз
const loadCategoryProducts = cache(async function loadCategoryProducts(
  slug: string,
  page: number,
  makeSlug: string | null
): Promise<{ products: CategoryProduct[]; total: number }> {
  const category = getCategoryBySlug(slug);
  if (!category) return { products: [], total: 0 };

  const make = makeSlug ? getCarMakeBySlug(makeSlug) ?? null : null;
  const { clause, params } = buildCategoryAndMakeWhereClause(category, make, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [productsResult, countResult] = await Promise.all([
    pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.stock, s.delivery_time
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${clause}
      ORDER BY (p.stock > 0) DESC, p.name ASC NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`, params),
  ]);

  const products: CategoryProduct[] = productsResult.rows.map((row) => ({
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    deliveryTime: row.delivery_time,
  }));

  return { products, total: countResult.rows[0]?.total ?? 0 };
});

// Next.js 15: params і searchParams — Promise
type PageParams = { slug: string };
type PageSearchParams = { page?: string; marka?: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { marka } = await searchParams;
  const category = getCategoryBySlug(slug);
  if (!category) return {};

  const make = marka ? getCarMakeBySlug(marka) : undefined;
  const { total } = await loadCategoryProducts(slug, 1, marka ?? null);

  return {
    title: make ? `${category.name} ${make.name} купити — DominatorParts` : category.metaTitle,
    description: make
      ? `${category.name} для ${make.name} в наявності: оригінал та перевірені аналоги. Доставка по всій Україні.`
      : category.metaDescription,
    // Порожня категорія (поки що немає жодного відповідного товару в
    // каталозі) навмисно не індексується — сторінка без товарів
    // виглядає для Google як "тонкий" неякісний контент і може
    // зашкодити довірі до решти сайту. Як тільки товари з'являться,
    // noindex зникне сам собою при наступному обході
    robots: total === 0 ? { index: false, follow: true } : undefined,
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
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        fontFamily: TECH_BODY_FONT,
        background: inStock ? TECH_GOOD_SOFT : TECH_HEAT_SOFT,
        color: inStock ? TECH_GOOD : TECH_HEAT,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {inStock ? 'В наявності' : 'Під замовлення'}
    </span>
  );
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { slug } = await params;
  const { page: pageParam, marka } = await searchParams;

  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const make = marka ? getCarMakeBySlug(marka) : undefined;
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const { products, total } = await loadCategoryProducts(slug, page, marka ?? null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Пагінація має зберігати ?marka= при переході між сторінками —
  // інакше фільтр по марці скидався б на другій сторінці результатів
  const pageHref = (targetPage: number) =>
    `/category/${slug}?page=${targetPage}${make ? `&marka=${make.slug}` : ''}`;

  // ==================== SCHEMA.ORG (JSON-LD) ====================
  // Порядок хлібних крихт ТОЧНО повторює видиму <nav> нижче — Google
  // звіряє одне з іншим
  const breadcrumbItems = [
    { name: 'Головна', url: SITE_URL },
    { name: 'Категорії', url: `${SITE_URL}/category` },
    { name: category.name, url: `${SITE_URL}/category/${slug}` },
    ...(make ? [{ name: make.name, url: `${SITE_URL}/marky/${make.slug}` }] : []),
  ];

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      {products.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: jsonLdScript(buildProductListJsonLd(products)) }}
        />
      )}
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        {/* ==================== ХЛІБНІ КРИХТИ ==================== */}
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          /{' '}
          <Link href="/category" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Категорії
          </Link>{' '}
          / <span>{category.name}</span>
          {make && (
            <>
              {' '}
              /{' '}
              <Link href={`/marky/${make.slug}`} className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
                {make.name}
              </Link>
            </>
          )}
        </nav>

        {/* ==================== ЗАГОЛОВОК ==================== */}
        <header className="mb-6">
          <h1
            className="mb-3 text-3xl md:text-4xl"
            style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
          >
            {make ? `${category.name} ${make.name}` : category.h1}
          </h1>
          <p className="max-w-2xl text-sm" style={{ color: TECH_MUTED }}>
            {category.intro}
          </p>
          {make && (
            <p className="mt-2 text-xs" style={{ color: TECH_FAINT }}>
              Фільтр за маркою: <strong style={{ color: TECH_INK }}>{make.name}</strong> ·{' '}
              <Link href={`/category/${slug}`} className="underline" style={{ color: TECH_ACCENT_BRIGHT }}>
                показати всі марки
              </Link>
            </p>
          )}
        </header>

        {/* ==================== СПИСОК ТОВАРІВ ==================== */}
        {products.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-sm"
            style={{ background: TECH_SURFACE, border: `1px dashed ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            {make
              ? `Зараз немає товарів "${category.name}" для ${make.name} у наявності. `
              : 'Зараз у цій категорії немає товарів у наявності. '}
            Скористайтесь пошуком за артикулом або підбором за VIN на{' '}
            <Link href="/" className="font-medium underline" style={{ color: TECH_ACCENT_BRIGHT }}>
              Головній сторінці
            </Link>{' '}
            — можливо, потрібна деталь просто ще не завантажена в каталог, і ми зможемо підібрати її під
            замовлення.
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <Link
                  key={product.id}
                  href={buildProductPath(product.id, product)}
                  className="block rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                  style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs" style={{ fontFamily: TECH_BODY_FONT }}>
                    <span className="font-bold uppercase tracking-wide" style={{ color: TECH_ACCENT_BRIGHT }}>
                      {product.brand || 'Без бренду'}
                    </span>
                    <span style={{ color: TECH_FAINT }}>·</span>
                    <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_MUTED }}>{product.article}</span>
                  </div>
                  <div className="mb-2 text-sm" style={{ color: TECH_INK }}>
                    {product.name || category.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 18, color: '#fff' }}>
                      {formatMoney(product.retailPrice)} грн
                    </span>
                    <StockBadge stock={product.stock} />
                  </div>
                  {product.stock <= 0 && product.deliveryTime && (
                    <div className="mt-1.5 text-xs" style={{ color: TECH_FAINT }}>
                      Термін поставки: {product.deliveryTime}
                    </div>
                  )}
                </Link>
              ))}
            </div>

            {/* ==================== ПАГІНАЦІЯ ==================== */}
            {totalPages > 1 && (
              <div className="mb-8 flex items-center gap-3 text-sm">
                {page > 1 && (
                  <Link href={pageHref(page - 1)} className="underline" style={{ color: TECH_ACCENT_BRIGHT }}>
                    ← Попередня
                  </Link>
                )}
                <span style={{ color: TECH_FAINT }}>
                  Сторінка {page} з {totalPages}
                </span>
                {page < totalPages && (
                  <Link href={pageHref(page + 1)} className="underline" style={{ color: TECH_ACCENT_BRIGHT }}>
                    Наступна →
                  </Link>
                )}
              </div>
            )}
          </>
        )}

        {/* ==================== ІНШІ КАТЕГОРІЇ (внутрішні посилання) ==================== */}
        <div className="pt-6" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
            Інші категорії
          </h2>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c.slug !== slug).map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
