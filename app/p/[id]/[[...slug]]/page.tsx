// ============================================================
// Сторінка ОДНОГО товару — /p/[id]/[[...slug]]
//
// [id] — UUID товару (products.id) — ЄДИНЕ джерело правди для
// пошуку в базі. [[...slug]] — необов'язковий "хвіст" з ключовими
// словами (бренд+назва+артикул, lib/slug.ts) ЛИШЕ для краси URL і
// ключових слів у ньому — сторінка відкриється однаково і зовсім без
// нього, і зі старим/стороннім текстом там.
//
// ЧОМУ НЕ /product/[article] і НЕ /p/[brand]-[article]: перевірено
// прямим запитом до бойової бази — 7 709 різних article зустрічаються
// у товарів 2+ РІЗНИХ постачальників, а 4 745 пар (brand, article)
// теж дублюються. Тобто ні article, ні навіть (brand, article) не
// гарантують унікальність — тільки products.id.
//
// Якщо slug у адресному рядку не збігається з "правильним" (застарів
// після зміни назви товару, або його взагалі не було) — сторінка
// РОБИТЬ ПОСТІЙНИЙ РЕДИРЕКТ (308) на канонічну адресу. Так у Google
// завжди рівно ОДИН URL на товар, а не купа майже-дублів
// ============================================================

import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Pool } from 'pg';
import { buildProductPath, buildProductSlug } from '@/lib/slug';
import { buildBreadcrumbJsonLd, buildSingleProductJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { getCarMakeByDbValue } from '@/lib/carMakes';
import AddToCartButton from '@/components/AddToCartButton';

export const runtime = 'nodejs';
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProductDetail {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  imageUrl: string | null;
  metaDescription: string | null;
  carMake: string | null;
  supplierName: string;
  deliveryTime: string | null;
  updatedAt: string;
}

// Той самий товар, знайдений в іншого постачальника (буквально той
// самий бренд + артикул) — саме тому, що article/brand+article НЕ
// унікальні (див. коментар вгорі файлу), у покупця цілком може бути
// вибір з кількох пропозицій на ту саму деталь
interface OtherOffer {
  id: string;
  retailPrice: number;
  stock: number;
  supplierName: string;
}

interface CrossRefItem {
  brand: string;
  partNumber: string;
  productId: string | null;
  retailPrice: number | null;
  stock: number | null;
}

const loadProduct = cache(async function loadProduct(id: string): Promise<ProductDetail | null> {
  const result = await pool.query(
    `
    SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.stock, p.image_url,
           p.meta_description, p.car_make, p.updated_at,
           s.name AS supplier_name, s.delivery_time
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  return {
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    imageUrl: row.image_url,
    metaDescription: row.meta_description,
    carMake: row.car_make,
    supplierName: row.supplier_name,
    deliveryTime: row.delivery_time,
    updatedAt: row.updated_at,
  };
});

const loadOtherOffers = cache(async function loadOtherOffers(
  product: ProductDetail
): Promise<OtherOffer[]> {
  const result = await pool.query(
    `
    SELECT p2.id, p2.retail_price, p2.stock, s2.name AS supplier_name
    FROM products p2
    JOIN suppliers s2 ON s2.id = p2.supplier_id
    WHERE p2.article = $1
      AND ($2::text IS NULL OR p2.brand ILIKE $2)
      AND p2.id <> $3
    ORDER BY (p2.stock > 0) DESC, p2.retail_price ASC
    LIMIT 10
    `,
    [product.article, product.brand, product.id]
  );

  return result.rows.map((row) => ({
    id: row.id,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    supplierName: row.supplier_name,
  }));
});

// OEM/кросс-номери — та сама модель "груп взаємозамінності", що і в
// app/api/products/cross-lookup/route.ts (звідти й скопійована логіка
// вибірки, тут вона лише читає дані, без створення нових зв'язків)
const loadCrossReferences = cache(async function loadCrossReferences(
  product: ProductDetail
): Promise<{ oem: CrossRefItem[]; aftermarket: CrossRefItem[] }> {
  if (!product.brand) return { oem: [], aftermarket: [] };

  const groupsResult = await pool.query(
    `SELECT DISTINCT group_id FROM cross_reference_members WHERE part_number = $1 AND brand ILIKE $2`,
    [product.article, product.brand]
  );
  const groupIds = groupsResult.rows.map((row) => row.group_id as string);
  if (groupIds.length === 0) return { oem: [], aftermarket: [] };

  const membersResult = await pool.query(
    `
    SELECT m.brand, m.part_number, m.part_type, m.product_id, p3.retail_price, p3.stock
    FROM cross_reference_members m
    LEFT JOIN products p3 ON p3.id = m.product_id
    WHERE m.group_id = ANY($1::uuid[])
      AND NOT (m.part_number = $2 AND m.brand ILIKE $3)
    ORDER BY m.part_type, m.brand
    `,
    [groupIds, product.article, product.brand]
  );

  const oem: CrossRefItem[] = [];
  const aftermarket: CrossRefItem[] = [];
  const seen = new Set<string>();

  for (const row of membersResult.rows) {
    const key = `${row.brand}::${row.part_number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item: CrossRefItem = {
      brand: row.brand,
      partNumber: row.part_number,
      productId: row.product_id,
      retailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
      stock: row.stock,
    };

    if (row.part_type === 'oem') oem.push(item);
    else aftermarket.push(item);
  }

  return { oem, aftermarket };
});

type PageParams = { id: string; slug?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return {};

  const product = await loadProduct(id);
  if (!product) return {};

  const canonicalUrl = `${SITE_URL}${buildProductPath(id, product)}`;
  const displayName = product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ');
  const title = `${[product.brand, product.article].filter(Boolean).join(' ')}${
    product.name ? ' — ' + product.name : ''
  } купити | DominatorParts`;
  const description =
    product.metaDescription?.trim() ||
    `${displayName} — купити з доставкою по Україні. Артикул ${product.article}${
      product.brand ? `, бренд ${product.brand}` : ''
    }. ${product.stock > 0 ? 'В наявності' : `Під замовлення${product.deliveryTime ? ', ' + product.deliveryTime : ''}`}.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      images: product.imageUrl ? [{ url: product.imageUrl }] : undefined,
    },
  };
}

const BG = '#F5F6F9';
const PANEL_SOFT = '#EAEDF2';
const BORDER_SOFT = '#DDE2EA';
const ACCENT = '#1D5FD6';
const PAPER = '#12192A';
const SUCCESS_TEXT = '#15803D';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

export default async function ProductPage({ params }: { params: Promise<PageParams> }) {
  const { id, slug } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  const product = await loadProduct(id);
  if (!product) notFound();

  // Канонічний слаг ще раз перевіряється тут (не лише в generateMetadata)
  // — якщо адреса в браузері не збігається з ним, назавжди редиректимо
  // на правильну. Саме так у Google лишається ОДНА адреса на товар,
  // навіть якщо назву/бренд товару колись зміняли
  const canonicalSlug = buildProductSlug(product);
  const currentSlug = (slug || []).join('/');
  if (currentSlug !== canonicalSlug) {
    permanentRedirect(buildProductPath(id, product));
  }

  const [otherOffers, crossRefs] = await Promise.all([
    loadOtherOffers(product),
    loadCrossReferences(product),
  ]);

  const make = getCarMakeByDbValue(product.carMake);
  const displayName = product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ');

  const breadcrumbItems = [
    { name: 'Головна', url: SITE_URL },
    ...(make ? [{ name: make.name, url: `${SITE_URL}/marky/${make.slug}` }] : []),
    { name: `${product.brand ? product.brand + ' ' : ''}${product.article}`, url: `${SITE_URL}${buildProductPath(id, product)}` },
  ];

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildBreadcrumbJsonLd(breadcrumbItems)) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildSingleProductJsonLd(product)) }}
      />

      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          {breadcrumbItems.map((item, index) => (
            <span key={item.url}>
              {index > 0 && ' / '}
              {index < breadcrumbItems.length - 1 ? (
                <Link href={item.url.replace(SITE_URL, '')} className="underline">
                  {item.name}
                </Link>
              ) : (
                <span>{item.name}</span>
              )}
            </span>
          ))}
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-8 mb-10">
          {/* ==================== ФОТО ==================== */}
          <div
            className="w-full aspect-square flex items-center justify-center overflow-hidden rounded-md"
            style={{ background: PANEL_SOFT }}
          >
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageUrl} alt={displayName} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs" style={{ color: PAPER, opacity: 0.5 }}>
                Фото відсутнє
              </span>
            )}
          </div>

          {/* ==================== ІНФОРМАЦІЯ ==================== */}
          <div>
            <div className="text-xs uppercase tracking-wide mb-2" style={{ color: ACCENT }}>
              {product.brand || 'Без бренду'} · Артикул {product.article}
            </div>
            <h1 className="text-2xl md:text-3xl mb-3" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em' }}>
              {displayName}
            </h1>

            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl font-semibold" style={{ fontFamily: DISPLAY_FONT }}>
                {formatMoney(product.retailPrice)} грн
              </span>
              <span
                className="text-xs px-2 py-1 rounded font-medium"
                style={{
                  background: product.stock > 0 ? '#DCFCE7' : PANEL_SOFT,
                  color: product.stock > 0 ? SUCCESS_TEXT : PAPER,
                }}
              >
                {product.stock > 0 ? `В наявності: ${product.stock} шт` : 'Під замовлення'}
              </span>
            </div>

            {product.stock <= 0 && product.deliveryTime && (
              <p className="text-sm mb-4" style={{ opacity: 0.75 }}>
                Термін поставки: {product.deliveryTime}
              </p>
            )}

            <p className="text-xs mb-5" style={{ opacity: 0.6 }}>
              Постачальник: {product.supplierName}
            </p>

            <AddToCartButton
              product={{
                id: product.id,
                article: product.article,
                brand: product.brand,
                name: product.name,
                retailPrice: product.retailPrice,
                stock: product.stock,
              }}
            />
          </div>
        </div>

        {/* ==================== ІНШІ ПРОПОЗИЦІЇ НА ЦЮ Ж ДЕТАЛЬ ==================== */}
        {/* Той самий бренд+артикул зустрічається в декількох
            постачальників (перевірено на бойовій базі — це НЕ рідкість:
            4 745 таких пар) — чесно показуємо покупцю вибір, а не
            ховаємо його */}
        {otherOffers.length > 0 && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
              Ця ж деталь в інших постачальників
            </h2>
            <div className="flex flex-col gap-2">
              {otherOffers.map((offer) => (
                <Link
                  key={offer.id}
                  href={buildProductPath(offer.id, product)}
                  className="flex items-center justify-between p-3 rounded-md text-sm hover:shadow-sm transition-shadow"
                  style={{ background: '#FFFFFF', border: `1px solid ${BORDER_SOFT}` }}
                >
                  <span>{offer.supplierName}</span>
                  <span className="flex items-center gap-3">
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: offer.stock > 0 ? '#DCFCE7' : PANEL_SOFT,
                        color: offer.stock > 0 ? SUCCESS_TEXT : PAPER,
                      }}
                    >
                      {offer.stock > 0 ? 'В наявності' : 'Під замовлення'}
                    </span>
                    <span className="font-semibold">{formatMoney(offer.retailPrice)} грн</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ==================== OEM / КРОС-НОМЕРИ ==================== */}
        {/* Видимий текст з OEM-номерами — саме за такими запитами
            покупці шукають деталь у Google ("0986424815 купити"), а не
            завжди за назвою постачальника */}
        {(crossRefs.oem.length > 0 || crossRefs.aftermarket.length > 0) && (
          <section className="mb-10">
            <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
              OEM-номери та аналоги
            </h2>
            {crossRefs.oem.length > 0 && (
              <div className="mb-4">
                <h3 className="text-xs uppercase tracking-wide mb-2" style={{ opacity: 0.6 }}>
                  Оригінальні номери (OEM)
                </h3>
                <CrossRefList items={crossRefs.oem} product={product} />
              </div>
            )}
            {crossRefs.aftermarket.length > 0 && (
              <div>
                <h3 className="text-xs uppercase tracking-wide mb-2" style={{ opacity: 0.6 }}>
                  Аналоги інших виробників
                </h3>
                <CrossRefList items={crossRefs.aftermarket} product={product} />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function CrossRefList({ items, product }: { items: CrossRefItem[]; product: ProductDetail }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) =>
        item.productId ? (
          <Link
            key={`${item.brand}-${item.partNumber}`}
            href={buildProductPath(item.productId, product)}
            className="text-xs px-3 py-1.5 rounded-full underline"
            style={{ border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
          >
            {item.brand} {item.partNumber}
            {item.stock !== null && item.stock > 0 ? ` · ${formatMoney(item.retailPrice || 0)} грн` : ''}
          </Link>
        ) : (
          <span
            key={`${item.brand}-${item.partNumber}`}
            className="text-xs px-3 py-1.5 rounded-full"
            style={{ border: `1px solid ${BORDER_SOFT}`, opacity: 0.6 }}
          >
            {item.brand} {item.partNumber}
          </span>
        )
      )}
    </div>
  );
}
