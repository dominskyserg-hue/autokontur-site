// ============================================================
// SEO-сторінка марки авто — /marky/[make]
//
// Дзеркальна структура до app/category/[slug]/page.tsx (той же
// Server Component, той же трюк з cache() для дедуплікації запиту
// між generateMetadata і самою сторінкою), але фільтр — по реальному
// полю products.car_make замість пошуку слів у назві. Курований
// список марок і те, як саме кожна записана в базі, — у
// lib/carMakes.ts
// ============================================================

import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { CAR_MAKES, getCarMakeBySlug, buildMakeWhereClause } from '@/lib/carMakes';
import { getModelLandingsForMake } from '@/lib/categories';
import { hubPath } from '@/lib/modelHubs';
import { loadVisibleHubs } from '@/lib/modelHubData';
import { getCustomerPricingRule, computeCustomerPrice } from '@/lib/customerPricing';
import { CUSTOMER_PHONE_COOKIE } from '@/lib/customerPhoneCookie';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import { buildBreadcrumbJsonLd, buildProductListJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import {
  TECH_BG,
  TECH_SURFACE,
  TECH_SURFACE_2,
  TECH_BORDER,
  TECH_ACCENT,
  TECH_ACCENT_DIM,
  TECH_ACCENT_BRIGHT,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_HEAT,
  TECH_HEAT_SOFT,
  TECH_GLOW,
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

interface MakeProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  deliveryTime: string | null;
  imageUrl: string | null;
}

// Той самий вибір сортування, що й на app/category/[slug]/page.tsx
export type MakeSort = 'popular' | 'price_asc' | 'price_desc';

function makeOrderByClause(sort: MakeSort): string {
  if (sort === 'price_asc') return 'ORDER BY (p.stock > 0) DESC, p.retail_price ASC';
  if (sort === 'price_desc') return 'ORDER BY (p.stock > 0) DESC, p.retail_price DESC';
  // Той самий тайбрейк, що й у app/category/[slug]/page.tsx — ціна за
  // зростанням: p.name ASC піднімав нагору товари з назвою на "(", а
  // p.stock DESC виявився ще гіршим (одного з постачальників значення
  // stock величезне саме у найдорожчих товарів, і "популярне" ставало
  // "найдорожче" — див. детальний коментар у app/category/[slug]/page.tsx)
  return 'ORDER BY (p.image_url IS NOT NULL) DESC, (p.stock > 0) DESC, p.retail_price ASC';
}

const loadMakeProducts = cache(async function loadMakeProducts(
  slug: string,
  page: number,
  sort: MakeSort
): Promise<{ products: MakeProduct[]; total: number }> {
  const make = getCarMakeBySlug(slug);
  if (!make) return { products: [], total: 0 };

  const { clause, param } = buildMakeWhereClause(make, 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Персональна ціна покупця — див. коментар біля того ж коду в
  // app/category/[slug]/page.tsx
  const cookieStore = await cookies();
  const [productsResult, countResult, customerPricingRule] = await Promise.all([
    pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.stock, p.image_url, s.delivery_time
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${clause}
      ${makeOrderByClause(sort)}
      LIMIT $2 OFFSET $3
      `,
      [param, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`, [param]),
    getCustomerPricingRule(pool, cookieStore.get(CUSTOMER_PHONE_COOKIE)?.value),
  ]);

  const products: MakeProduct[] = productsResult.rows.map((row) => ({
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: computeCustomerPrice(parseFloat(row.cost_price), parseFloat(row.retail_price), customerPricingRule),
    stock: row.stock,
    deliveryTime: row.delivery_time,
    imageUrl: row.image_url,
  }));

  return { products, total: countResult.rows[0]?.total ?? 0 };
});

type PageParams = { make: string };
type PageSearchParams = { page?: string; sort?: string };

function parseSort(value: string | undefined): MakeSort {
  return value === 'price_asc' || value === 'price_desc' ? value : 'popular';
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { make: slug } = await params;
  const { page: pageParam } = await searchParams;
  const make = getCarMakeBySlug(slug);
  if (!make) return {};

  const { total } = await loadMakeProducts(slug, 1, 'popular');

  // Той самий фікс, що й у app/category/[slug]/page.tsx: без номера
  // сторінки в title/description і без canonical усі сторінки пагінації
  // однієї марки (?page=2, ?page=3...) мали ІДЕНТИЧНІ title/description
  // і жодного canonical — Google бачив їх як дублі
  const pageNumber = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const pageSuffix = pageNumber > 1 ? ` — сторінка ${pageNumber}` : '';
  const canonicalPath = pageNumber > 1 ? `${SITE_URL}/marky/${slug}?page=${pageNumber}` : `${SITE_URL}/marky/${slug}`;

  return {
    // pageSuffix встромляється ПЕРЕД "— DominatorParts", а не після:
    // назва магазину має лишатись у самому кінці title
    title: `Запчастини ${make.name} купити з доставкою${pageSuffix} — DominatorParts`,
    description: `Автозапчастини ${make.name} в наявності: оригінал та перевірені аналоги. Пошук за артикулом, швидка доставка по всій Україні.${pageSuffix}`,
    robots: total === 0 ? { index: false, follow: true } : undefined,
    alternates: { canonical: canonicalPath },
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

export default async function CarMakePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { make: slug } = await params;
  const { page: pageParam, sort: sortParam } = await searchParams;
  const sort = parseSort(sortParam);

  const make = getCarMakeBySlug(slug);
  if (!make) notFound();

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const { products, total } = await loadMakeProducts(slug, page, sort);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sortHref = (targetSort: MakeSort) => `/marky/${slug}${targetSort !== 'popular' ? `?sort=${targetSort}` : ''}`;
  // Пагінація зберігає поточне сортування
  const pageHref = (targetPage: number) => {
    const q = new URLSearchParams();
    if (sort !== 'popular') q.set('sort', sort);
    q.set('page', String(targetPage));
    return `/marky/${slug}?${q.toString()}`;
  };

  // Моделі цієї марки, для яких уже є готові посадкові сторінки
  // (lib/categories.ts) — раніше з /marky/[make] на них не було
  // жодного посилання, Google міг знайти їх лише через sitemap
  // Спершу хаби моделей (усі запчастини покоління, lib/modelHubs.ts) —
  // лише видимі (>= 30 товарів); далі моделі, для яких хабу ще немає, —
  // як раніше, на першу вузьку сторінку "модель + деталь"
  const hubs = (await loadVisibleHubs()).filter((hub) => hub.makeSlug === slug);
  const coveredGroups = new Set(hubs.flatMap((hub) => hub.modelGroups));
  const modelLinks = [
    ...hubs.map((hub) => ({ key: `hub-${hub.slug}`, href: hubPath(hub), label: `${make.name} ${hub.label}` })),
    ...getModelLandingsForMake(make.dbValues)
      .filter((landing) => !coveredGroups.has(landing.modelGroup))
      .map((landing) => ({ key: landing.modelGroup, href: `/category/${landing.slug}`, label: landing.modelLabel })),
  ];

  // Порядок ТОЧНО повторює видиму <nav> нижче — Google звіряє одне з
  // іншим
  const breadcrumbItems = [
    { name: 'Головна', url: SITE_URL },
    { name: 'Марки авто', url: `${SITE_URL}/marky` },
    { name: make.name, url: `${SITE_URL}/marky/${slug}` },
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
      <SiteHeaderServer />
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          /{' '}
          <Link href="/marky" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Марки авто
          </Link>{' '}
          / <span>{make.name}</span>
        </nav>

        <header className="mb-6">
          <h1
            className="mb-3 text-3xl md:text-4xl"
            style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
          >
            Запчастини {make.name} — купити з доставкою по Україні
          </h1>
          <p className="max-w-2xl text-sm" style={{ color: TECH_MUTED }}>
            {total > 0
              ? `У каталозі понад ${total.toLocaleString('uk-UA')} запчастин для ${make.name}: оригінал та перевірені аналоги. Знайдіть потрібну деталь за артикулом або підберіть за моделлю й роком авто.`
              : `Зараз у каталозі немає в наявності запчастин ${make.name} — скористайтесь підбором за VIN на Головній, і ми підберемо деталь під замовлення.`}
          </p>
          <Link
            href={`/marky/${slug}/to`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-semibold transition-shadow hover:shadow-glow-lg"
            style={{ fontFamily: TECH_BODY_FONT, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
          >
            Що потрібно на ТО для {make.name} →
          </Link>
        </header>

        {/* ==================== МОДЕЛІ МАРКИ ==================== */}
        {/* Посилання на вже готові посадкові сторінки конкретних
            моделей (lib/categories.ts, getModelLandingsForMake) —
            раніше з цієї сторінки на них не було жодного посилання,
            і Google міг знайти їх лише через sitemap, а не через
            внутрішню навігацію сайту */}
        {modelLinks.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
              Моделі {make.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {modelLinks.map((model) => (
                <Link
                  key={model.key}
                  href={model.href}
                  className="rounded-full px-3.5 py-2 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                  style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_ACCENT_BRIGHT, background: TECH_SURFACE_2 }}
                >
                  {model.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ==================== СОРТУВАННЯ ==================== */}
        {products.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 text-xs" style={{ color: TECH_FAINT }}>
            <span>Сортування:</span>
            {(
              [
                ['popular', 'За популярністю'],
                ['price_asc', 'Дешевші спершу'],
                ['price_desc', 'Дорожчі спершу'],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                href={sortHref(value)}
                className="rounded-full px-3 py-1.5 font-medium transition-colors"
                style={
                  sort === value
                    ? { background: TECH_ACCENT_BRIGHT, color: '#0B0F17' }
                    : { border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }
                }
              >
                {label}
              </Link>
            ))}
          </div>
        )}

        {products.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-sm"
            style={{ background: TECH_SURFACE, border: `1px dashed ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            Немає товарів {make.name} у наявності просто зараз. Скористайтесь{' '}
            <Link href="/" className="font-medium underline" style={{ color: TECH_ACCENT_BRIGHT }}>
              підбором за VIN на Головній
            </Link>{' '}
            — ми підберемо деталь під замовлення.
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <Link
                  key={product.id}
                  href={buildProductPath(product.id, product)}
                  className="flex items-start gap-3 rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                  style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                >
                  {/* items-start обов'язковий: без нього flex-рядок за
                      замовчуванням розтягує квадратний бокс з фото до
                      висоти текстового блоку поруч (align-items: stretch),
                      через що фото ставало прямокутним замість квадрата */}
                  {/* Мініатюра — той самий фікс, що і в app/category/[slug]/
                      page.tsx: без неї фото товару вантажилось "з нуля"
                      лише в момент відкриття модального вікна картки.
                      loading="lazy" не заважає першому рендеру сторінки */}
                  <div
                    className="flex aspect-square w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                    style={{
                      background: TECH_SURFACE,
                      backgroundImage: product.imageUrl
                        ? undefined
                        : 'linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%)',
                      backgroundSize: '8px 8px',
                      border: `1px solid ${TECH_BORDER}`,
                    }}
                  >
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.imageUrl}
                        alt={product.name || product.article}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TECH_FAINT} strokeWidth="1.5">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <circle cx="8.5" cy="10" r="1.5" />
                        <path d="M21 16l-5-5-4 4-2-2-7 7" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5 text-xs" style={{ fontFamily: TECH_BODY_FONT }}>
                      <span className="font-bold uppercase tracking-wide" style={{ color: TECH_ACCENT_BRIGHT }}>
                        {product.brand || 'Без бренду'}
                      </span>
                      <span style={{ color: TECH_FAINT }}>·</span>
                      <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_MUTED }}>{product.article}</span>
                    </div>
                    <div className="mb-2 text-sm" style={{ color: TECH_INK }}>
                      {product.name || `Деталь для ${make.name}`}
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
                  </div>
                </Link>
              ))}
            </div>

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

        <div className="pt-6" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
            Інші марки
          </h2>
          <div className="flex flex-wrap gap-2">
            {CAR_MAKES.filter((m) => m.slug !== slug).map((m) => (
              <Link
                key={m.slug}
                href={`/marky/${m.slug}`}
                className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
              >
                {m.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
