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
import { cookies } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';
import { Pool } from 'pg';
import { CATEGORIES, getCategoryBySlug, findNarrowPageForVehicle } from '@/lib/categories';
import { getCustomerPricingMultiplier, applyPricingMultiplier } from '@/lib/customerPricing';
import { CUSTOMER_PHONE_COOKIE } from '@/lib/customerPhoneCookie';
import CategoryCrossLinks from '@/components/CategoryCrossLinks';
import CategoryVehicleFilter from '@/components/CategoryVehicleFilter';
import { getCarMakeBySlug } from '@/lib/carMakes';
import { buildCategoryAndMakeWhereClause } from '@/lib/productFilters';
import { buildVehicleWhereClause, hasVehicleFilter, type VehicleFilterParams } from '@/lib/vehicleFilter';
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
  // Скидка (%) от правила наценки поставщика (см. supplier_markup_rules
  // в schema.sql) — ЧИСТО для отображения: retailPrice уже посчитана
  // со скидкой, discountPercent нужен только чтобы показать зачёркнутую
  // "старую" цену и бейдж "-X%". 0 — скидки нет
  discountPercent: number;
  stock: number;
  deliveryTime: string | null;
  imageUrl: string | null;
}

// cache() від React дедуплікує виклик У МЕЖАХ ОДНОГО HTTP-запиту —
// generateMetadata() і сам компонент сторінки викликають цю функцію
// з однаковими аргументами, але SQL-запит реально піде в базу лише
// один раз
const loadCategoryProducts = cache(async function loadCategoryProducts(
  slug: string,
  page: number,
  makeSlug: string | null,
  vehicle: VehicleFilterParams
): Promise<{ products: CategoryProduct[]; total: number }> {
  const category = getCategoryBySlug(slug);
  if (!category) return { products: [], total: 0 };

  const make = makeSlug ? getCarMakeBySlug(makeSlug) ?? null : null;
  const { clause: categoryClause, params: categoryParams } = buildCategoryAndMakeWhereClause(category, make, 1);

  // Фільтр за моделлю/роком/двигуном (components/CategoryVehicleFilter.tsx)
  // — окрема умова ПОВЕРХ категорії+марки, той самий tecdoc_compatibility-
  // індекс, що й у вузьких SEO-сторінках і в основному пошуку
  // (lib/vehicleFilter.ts). Умова додається ЛИШЕ якщо задано модель/рік/
  // двигун — сам по собі ?marka= (без них) лишається старою, вже
  // існуючою поведінкою (buildCategoryAndMakeWhereClause вище й так її
  // враховує), без додаткової tecdoc-умови і без noindex нижче в
  // generateMetadata. Марку передаємо СЮДИ ЩЕ РАЗ, коли умова таки
  // будується (вона вже врахована окремо в categoryClause) — без
  // цього гілка EXISTS(tecdoc_compatibility) шукала б задану модель
  // серед УСІХ 600+ виробників у дампі TecDoc, а не лише в межах
  // обраної марки (рідкісний, але можливий збіг назви моделі)
  const hasModelYearEngineFilter = hasVehicleFilter({ model: vehicle.model, year: vehicle.year, engine: vehicle.engine });
  const vehicleResult = hasModelYearEngineFilter
    ? buildVehicleWhereClause(
        { make: make?.name, model: vehicle.model, year: vehicle.year, engine: vehicle.engine },
        categoryParams.length + 1
      )
    : null;

  const clause = vehicleResult ? `${categoryClause} AND ${vehicleResult.clause}` : categoryClause;
  const params = vehicleResult ? [...categoryParams, ...vehicleResult.params] : categoryParams;

  const offset = (page - 1) * PAGE_SIZE;

  // Персональна ціна покупця (customer_pricing_rules) — за cookie з
  // телефоном "залогіненого" в Особистому кабінеті покупця (див.
  // lib/customerPricing.ts). cookies() тут ЩЕ й гарантує, що Next.js
  // не віддасть цю сторінку зі статичного кешу одному покупцю з ціною
  // іншого — використання cookies()/headers() саме собою вимикає
  // статичну генерацію для сторінки, що її викликає
  const cookieStore = await cookies();
  const [productsResult, countResult, customerPricingMultiplier] = await Promise.all([
    pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.discount_percent, p.stock, p.image_url, s.delivery_time
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${clause}
      ORDER BY (p.image_url IS NOT NULL) DESC, (p.stock > 0) DESC, p.name ASC NULLS LAST
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`, params),
    getCustomerPricingMultiplier(pool, cookieStore.get(CUSTOMER_PHONE_COOKIE)?.value),
  ]);

  const products: CategoryProduct[] = productsResult.rows.map((row) => ({
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: applyPricingMultiplier(parseFloat(row.retail_price), customerPricingMultiplier),
    discountPercent: parseFloat(row.discount_percent),
    stock: row.stock,
    deliveryTime: row.delivery_time,
    imageUrl: row.image_url,
  }));

  return { products, total: countResult.rows[0]?.total ?? 0 };
});

// Next.js 15: params і searchParams — Promise
type PageParams = { slug: string };
// model/year/engine — новий фільтр (components/CategoryVehicleFilter.tsx),
// marka лишається як і була (курований slug марки, окремий від них)
type PageSearchParams = { page?: string; marka?: string; model?: string; year?: string; engine?: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { marka, model, year, engine } = await searchParams;
  const category = getCategoryBySlug(slug);
  if (!category) return {};

  const make = marka ? getCarMakeBySlug(marka) : undefined;
  const hasModelYearEngineFilter = hasVehicleFilter({ model, year, engine });
  const { total } = await loadCategoryProducts(slug, 1, marka ?? null, { model, year, engine });

  return {
    title: make ? `${category.name} ${make.name} купити — DominatorParts` : category.metaTitle,
    description: make
      ? `${category.name} для ${make.name} в наявності: оригінал та перевірені аналоги. Доставка по всій Україні.`
      : category.metaDescription,
    // Порожня категорія (поки що немає жодного відповідного товару в
    // каталозі) навмисно не індексується — сторінка без товарів
    // виглядає для Google як "тонкий" неякісний контент і може
    // зашкодити довірі до решти сайту. Як тільки товари з'являться,
    // noindex зникне сам собою при наступному обході.
    //
    // Фільтр за моделлю/роком/двигуном (hasModelYearEngineFilter) —
    // ОКРЕМА причина для noindex, незалежна від total: навіть якщо
    // товари є, кожна комбінація марка+модель+рік+двигун — це, по суті,
    // той самий список товарів категорії, лише вужче відфільтрований,
    // без власного унікального тексту. Плодити в індексі Google тисячі
    // таких слабких комбінацій — пряма шкода для SEO (canonical нижче
    // веде назад на "чисту" сторінку категорії, тому весь "вес" з
    // посилань на цю сторінку однаково дістається їй). Голий ?marka=
    // (без моделі/року/двигуна) під цю умову НЕ підпадає — то давніша,
    // уже проіндексована поведінка, яку свідомо не чіпаємо
    robots: total === 0 || hasModelYearEngineFilter ? { index: false, follow: true } : undefined,
    alternates: hasModelYearEngineFilter ? { canonical: `${SITE_URL}/category/${slug}` } : undefined,
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
  const { page: pageParam, marka, model, year, engine } = await searchParams;

  const category = getCategoryBySlug(slug);
  if (!category) notFound();

  const make = marka ? getCarMakeBySlug(marka) : undefined;

  // ==================== ДЕДУПЛІКАЦІЯ: РЕДИРЕКТ НА ГОТОВУ ВУЗЬКУ СТОРІНКУ ====================
  // Якщо для обраної в фільтрі комбінації марка+модель уже існує окрема
  // SEO-сторінка під ЦЮ Ж широку категорію (lib/categories.ts,
  // findNarrowPageForVehicle) — ведемо туди постійним редиректом, а не
  // показуємо ті самі товари вдруге за адресою з query-параметрами.
  // Перевіряється тільки за марка+модель (рік/двигун на дедуплікацію
  // не впливають — вузькі сторінки їх і так не враховують)
  if (make && model) {
    const narrowPage = findNarrowPageForVehicle(slug, make.name, model);
    if (narrowPage) {
      permanentRedirect(`/category/${narrowPage.slug}`);
    }
  }

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const { products, total } = await loadCategoryProducts(slug, page, marka ?? null, { model, year, engine });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasModelYearEngineFilter = hasVehicleFilter({ model, year, engine });

  // Пагінація має зберігати весь поточний фільтр (marka/model/year/
  // engine) при переході між сторінками — інакше він скидався б на
  // другій сторінці результатів
  const filterQuery = new URLSearchParams();
  if (make) filterQuery.set('marka', make.slug);
  if (model) filterQuery.set('model', model);
  if (year) filterQuery.set('year', year);
  if (engine) filterQuery.set('engine', engine);
  const pageHref = (targetPage: number) => {
    const q = new URLSearchParams(filterQuery);
    q.set('page', String(targetPage));
    return `/category/${slug}?${q.toString()}`;
  };

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

        {/* ==================== ФІЛЬТР ЗА АВТОМОБІЛЕМ ==================== */}
        <CategoryVehicleFilter value={{ makeSlug: marka ?? '', model: model ?? '', year: year ?? '', engine: engine ?? '' }} />

        {/* ==================== СПИСОК ТОВАРІВ ==================== */}
        {products.length === 0 ? (
          <div
            className="rounded-2xl p-6 text-sm"
            style={{ background: TECH_SURFACE, border: `1px dashed ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            {hasModelYearEngineFilter
              ? `Немає в наявності для цієї моделі${make ? ` (${make.name}${model ? ` ${model}` : ''})` : ''}. Спробуйте прибрати рік або об'єм двигуна у фільтрі вище — можливо, вони обрані занадто вузько. `
              : make
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
                  className="flex items-start gap-3 rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                  style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                >
                  {/* items-start обов'язковий: без нього flex-рядок за
                      замовчуванням розтягує квадратний бокс з фото
                      (align-items: stretch) до висоти текстового блоку
                      поруч — саме тому фото ставало прямокутним замість
                      компактного квадрата 64×64 */}
                  {/* Мініатюра фото — раніше в цих картках фото взагалі не
                      було (тільки текст), через що в модальному вікні
                      товару воно вантажилось "з нуля" в момент відкриття
                      і виглядало як зависла загрузка. Тепер саме
                      зображення першим завантажується вже тут, у списку
                      (loading="lazy" — не заважає першому рендеру
                      сторінки), і браузер бере його з кешу миттєво, коли
                      покупець відкриває картку товару */}
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
                      {product.name || category.name}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 18, color: '#fff' }}>
                          {formatMoney(product.retailPrice)} грн
                        </span>
                        {product.discountPercent > 0 && (
                          <>
                            <span className="text-xs line-through" style={{ color: TECH_FAINT }}>
                              {formatMoney(product.retailPrice / (1 - product.discountPercent / 100))} грн
                            </span>
                            <span
                              className="text-xs font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: TECH_HEAT_SOFT, color: TECH_HEAT }}
                            >
                              −{product.discountPercent}%
                            </span>
                          </>
                        )}
                      </div>
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

        {/* ==================== КРОС-ЛІНКИ (модель ↔ категорія) ==================== */}
        {/* Два різні напрямки — components/CategoryCrossLinks.tsx сам
            вирішує, чи є що показувати (повертає null, якщо порожньо).
            "model" — на вузькій сторінці ("Pajero II кульові опори")
            показує сусідні деталі під ТУ Ж машину; "variants" — на
            широкій ("Гальмівні колодки") показує вузькі варіанти під
            конкретні моделі. marka=... тут не враховуємо навмисно —
            і modelGroup/parentCategorySlug стосуються лише "чистого"
            slug категорії, не фільтра по марці в query-рядку */}
        {!make && <CategoryCrossLinks category={category} kind="model" />}
        {!make && <CategoryCrossLinks category={category} kind="variants" />}

        {/* ==================== ІНШІ КАТЕГОРІЇ (внутрішні посилання) ==================== */}
        <div className="pt-6" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
          <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
            Інші категорії
          </h2>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.filter((c) => c.slug !== slug && !c.hideFromIndex).map((c) => (
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
