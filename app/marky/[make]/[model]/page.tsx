// ============================================================
// ХАБ МОДЕЛІ АВТО — /marky/[make]/[model], напр. /marky/toyota/camry-xv40
//
// Опис хабів — вручну в lib/modelHubs.ts (точні записи TecDoc, текст),
// дані — lib/modelHubData.ts (лише TecDoc-сумісність). Сторінка:
//   - H1 "Запчастини {Марка} {Модель} ({роки})" + текст 2–3 речення
//   - блок категорій цієї моделі з кількістю товарів (спершу пріоритетні:
//     гальма, фільтри, підвіска...), посилання — на вузьку сторінку
//     "модель + деталь", якщо вона є, інакше на категорію з фільтром
//     марки/моделі
//   - сітка з 24 товарів (в наявності з фото -> в наявності -> з фото)
//   - хлібні крихти + BreadcrumbList, canonical на себе
// Хаб із < MIN_HUB_PRODUCTS товарів — 404 (тонкий контент)
// ============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { getCarMakeBySlug } from '@/lib/carMakes';
import { getHub, getHubsForMake, hubPath, findNarrowCategoryForHub, MIN_HUB_PRODUCTS, type ModelHubDef } from '@/lib/modelHubs';
import { loadHubData, loadVisibleHubs } from '@/lib/modelHubData';
import { buildSeoProductName } from '@/lib/productDetail';
import { getCustomerPricingRule, computeCustomerPrice } from '@/lib/customerPricing';
import { getCustomerSessionPhone } from '@/lib/customerAuth';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import { buildProductListJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import CardBuyButton from '@/components/CardBuyButton';
import Breadcrumbs from '@/components/Breadcrumbs';
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
// Той самий захист від збирання сторінки під час білда (без доступу до
// бази), що й у app/marky/[make]/page.tsx
export const dynamic = 'force-dynamic';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

type PageParams = { make: string; model: string };

function resolveHub(makeSlug: string, modelSlug: string) {
  const make = getCarMakeBySlug(makeSlug);
  const hub = getHub(makeSlug, modelSlug);
  if (!make || !hub) return null;
  return { make, hub };
}

function yearsLabel(hub: ModelHubDef): string {
  return `${hub.yearFrom}–${hub.yearTo}`;
}

// "Mazda 6 GG (Atenza)" — друга назва з TecDoc у дужках, якщо є
function fullNameWithAlt(makeName: string, hub: ModelHubDef): string {
  return `${makeName} ${hub.label}${hub.altNames ? ` (${hub.altNames})` : ''}`;
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { make: makeSlug, model: modelSlug } = await params;
  const resolved = resolveHub(makeSlug, modelSlug);
  if (!resolved) return {};
  const { make, hub } = resolved;
  const data = await loadHubData(hub);
  if (data.total < MIN_HUB_PRODUCTS) return {};

  const topCategories = data.categories
    .slice(0, 3)
    .map((item) => (item.category.itemName ?? item.category.name).toLowerCase())
    .join(', ');

  return {
    title: `Запчастини ${make.name} ${hub.label} ${yearsLabel(hub)} — купити | DominatorParts`,
    description: `${data.total} ${partsWord(data.total)} для ${fullNameWithAlt(make.name, hub)} ${yearsLabel(hub)}${topCategories ? `: ${topCategories} та інше` : ''}. Сумісність за TecDoc, доставка по Україні.`,
    alternates: { canonical: `${SITE_URL}${hubPath(hub)}` },
  };
}

// 1 запчастина, 2–4 запчастини, 5+ запчастин (11–14 — теж "запчастин")
function partsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'запчастина';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'запчастини';
  return 'запчастин';
}

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

export default async function ModelHubPage({ params }: { params: Promise<PageParams> }) {
  const { make: makeSlug, model: modelSlug } = await params;
  const resolved = resolveHub(makeSlug, modelSlug);
  if (!resolved) notFound();
  const { make, hub } = resolved;

  const [data, customerPricingRule, visibleHubs] = await Promise.all([
    loadHubData(hub),
    getCustomerPricingRule(pool, await getCustomerSessionPhone()),
    loadVisibleHubs(),
  ]);
  if (data.total < MIN_HUB_PRODUCTS) notFound();

  // Персональна ціна покупця — так само, як на сторінках категорій/марок
  const products = data.products.map((product) => ({
    ...product,
    retailPrice: computeCustomerPrice(product.costPrice, product.retailPrice, customerPricingRule),
  }));

  const otherHubs = getHubsForMake(makeSlug).filter(
    (other) => other.slug !== hub.slug && visibleHubs.some((visible) => visible.makeSlug === other.makeSlug && visible.slug === other.slug)
  );

  const title = `${make.name} ${hub.label}`;
  const breadcrumbItems = [
    { name: 'Головна', url: SITE_URL },
    // Хаб моделі: Головна › Марка › Модель (без проміжного "Марки авто")
    { name: make.name, url: `${SITE_URL}/marky/${make.slug}` },
    { name: hub.label, url: `${SITE_URL}${hubPath(hub)}` },
  ];

  // Посилання категорії: вузька сторінка "модель + деталь", якщо є;
  // інакше категорія з фільтром марки й основного кузова (та сторінка
  // сама має noindex + canonical на чисту категорію, тож дубля немає)
  const categoryHref = (broadSlug: string): string => {
    const narrow = findNarrowCategoryForHub(hub, broadSlug);
    if (narrow) return `/category/${narrow.slug}`;
    const query = new URLSearchParams({ marka: make.slug, model: hub.tecdocModels[0] });
    return `/category/${broadSlug}?${query.toString()}`;
  };

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      {products.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: jsonLdScript(
              buildProductListJsonLd(products.map((product) => ({ ...product, name: buildSeoProductName(product) })))
            ),
          }}
        />
      )}
      <SiteHeaderServer />
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        {/* Хлібні крихти + JSON-LD BreadcrumbList з одного масиву (components/Breadcrumbs.tsx) */}
        <Breadcrumbs items={breadcrumbItems} />

        <header className="mb-7">
          <h1
            className="mb-3 text-3xl md:text-4xl"
            style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
          >
            Запчастини {title} ({yearsLabel(hub)})
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed" style={{ color: TECH_MUTED }}>
            {hub.intro}
          </p>
          <p className="mt-2 text-xs" style={{ color: TECH_FAINT }}>
            У каталозі {data.total.toLocaleString('uk-UA')} {partsWord(data.total)} для {fullNameWithAlt(make.name, hub)}.
          </p>
        </header>

        {/* ==================== КАТЕГОРІЇ МОДЕЛІ ==================== */}
        {data.categories.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
              Категорії запчастин для {title}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.categories.map(({ category, count }) => (
                <Link
                  key={category.slug}
                  href={categoryHref(category.slug)}
                  className="flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                  style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}`, color: TECH_INK }}
                >
                  <span>{category.name}</span>
                  <span className="text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                    {count}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ==================== ТОВАРИ МОДЕЛІ ==================== */}
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
            Популярні запчастини для {title}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Link
                key={product.id}
                href={buildProductPath(product.id, product)}
                className="flex items-start gap-3 rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
              >
                <div
                  className="flex aspect-square w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: TECH_SURFACE, border: `1px solid ${TECH_BORDER}` }}
                >
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt={buildSeoProductName(product)} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={TECH_FAINT} strokeWidth="1.5">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="8.5" cy="10" r="1.5" />
                      <path d="M21 16l-5-5-4 4-2-2-7 7" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-1.5 text-xs">
                    <span className="font-bold uppercase tracking-wide" style={{ color: TECH_ACCENT_BRIGHT }}>
                      {product.brand || 'Без бренду'}
                    </span>
                    <span style={{ color: TECH_FAINT }}>·</span>
                    <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_MUTED }}>{product.article}</span>
                  </div>
                  <div className="mb-2 text-sm" style={{ color: TECH_INK }}>
                    {buildSeoProductName(product)}
                  </div>
                  {product.stock > 0 && (
                    <div className="mb-1.5">
                      <StockBadge stock={product.stock} />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 18, color: '#fff' }}>
                      {formatMoney(product.retailPrice)} грн
                    </span>
                    {/* Кнопка "Купити" (components/CardBuyButton.tsx): добавляет в корзину,
                        не уводя со страницы; без наличия — серый "Під замовлення" */}
                    <CardBuyButton
                      product={{
                        id: product.id,
                        article: product.article,
                        brand: product.brand,
                        name: buildSeoProductName(product),
                        retailPrice: product.retailPrice,
                        stock: product.stock,
                      }}
                      listName={`Запчастини ${make.name} ${hub.label}`}
                    />
                  </div>
                  {product.stock <= 0 && product.deliveryTime && (
                    <div className="mt-1.5 text-xs" style={{ color: TECH_FAINT }}>
                      Термін поставки: {product.deliveryTime}
                    </div>
                  )}
                  {/* Сумісність за TecDoc: кожен товар хабу підходить саме
                      для цього покоління (lib/modelHubData.ts) */}
                  <div className="mt-2 text-xs font-medium" style={{ color: TECH_GOOD }}>
                    ✓ Підходить для {title}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {otherHubs.length > 0 && (
          <div className="pt-6" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
            <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
              Інші моделі {make.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {otherHubs.map((other) => (
                <Link
                  key={other.slug}
                  href={hubPath(other)}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                  style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
                >
                  {make.name} {other.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
