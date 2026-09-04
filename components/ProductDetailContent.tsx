// ============================================================
// Вміст сторінки товару — сам товар + "інші пропозиції" + OEM/аналоги.
// Не містить зовнішнього фону/відступів на весь екран — це навмисно,
// щоб той самий вміст можна було вставити і в звичайну сторінку
// (app/p/[id]/[[...slug]]/page.tsx, свій фон на весь екран), і в
// модальне вікно (app/@modal/(...)p/[id]/[[...slug]]/page.tsx, фон і
// рамку дає components/ProductModalShell.tsx) — без дублювання розмітки
// товару в двох місцях
// ============================================================

import Link from 'next/link';
import { buildProductPath } from '@/lib/slug';
import { buildBreadcrumbJsonLd, buildSingleProductJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import type { CrossRefItem, ProductPageData, TecdocCompatibilityItem, TecdocCrossItem } from '@/lib/productDetail';
import AddToCartButton from '@/components/AddToCartButton';

export const BG = '#F5F6F9';
export const PANEL_SOFT = '#EAEDF2';
export const BORDER_SOFT = '#DDE2EA';
export const ACCENT = '#1D5FD6';
export const PAPER = '#12192A';
export const SUCCESS_TEXT = '#15803D';
export const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
export const BODY_FONT = "'Barlow', sans-serif";

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

export default function ProductDetailContent({
  product,
  otherOffers,
  crossRefs,
  tecdocCrosses,
  tecdocCompatibility,
  breadcrumbItems,
}: ProductPageData) {
  const displayName = product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ');

  return (
    <>
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

      {/* ==================== АНАЛОГИ ТА OEM-НОМЕРИ (TecDoc) ==================== */}
      {/* На відміну від секції вище (курована адміном модель
          cross_reference_members), тут — масовий SEO-індекс з дампа
          TecDoc (scripts/tecdoc/, таблиця tecdoc_crosses): мільйони
          зв'язків без ручної перевірки кожного. Товари, яких немає в
          нашому каталозі, все одно показуються текстом — саме вони
          дають SEO-текст під запити на кшталт "0986424815 купити" */}
      {tecdocCrosses.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
            Аналоги та OEM-номери
          </h2>
          <TecdocCrossList items={tecdocCrosses} />
        </section>
      )}

      {/* ==================== ЗАСТОСОВНІСТЬ ДО АВТО (TecDoc) ==================== */}
      {tecdocCompatibility.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
            Запчастина підходить для авто
          </h2>
          <div className="flex flex-wrap gap-2">
            {tecdocCompatibility.map((item, index) => (
              <CompatibilityBadge key={`${item.make}-${item.yearFrom ?? ''}-${item.yearTo ?? ''}-${index}`} item={item} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function CrossRefList({ items, product }: { items: CrossRefItem[]; product: ProductPageData['product'] }) {
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

function TecdocCrossList({ items }: { items: TecdocCrossItem[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) =>
        item.productPath ? (
          <Link
            key={`${item.brand}-${item.article}`}
            href={item.productPath}
            className="text-xs px-3 py-1.5 rounded-full underline"
            style={{ border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
          >
            {item.brand} {item.article}
            {item.stock !== null && item.stock > 0 ? ` · ${formatMoney(item.retailPrice || 0)} грн` : ''}
          </Link>
        ) : (
          // Немає в наявності в нашому каталозі — просто текст. Це і є
          // той SEO-текст під запити на кшталт "OEM 0986424815 купити":
          // сторінка згадує номер, навіть коли товару зараз немає на складі
          <span
            key={`${item.brand}-${item.article}`}
            className="text-xs px-3 py-1.5 rounded-full"
            style={{ border: `1px solid ${BORDER_SOFT}`, opacity: 0.6 }}
            title={`OEM / Кросс-номер: ${item.brand} ${item.article}`}
          >
            OEM / Кросс-номер: {item.brand} {item.article}
          </span>
        )
      )}
    </div>
  );
}

// "1998–2003" / "з 1998" / "до 2003" / '' — компактний людський формат
// діапазону років. Порожній рядок (а не null), щоб просто конкатенувати
// в JSX без додаткових перевірок на виклику
function formatYearRange(yearFrom: number | null, yearTo: number | null): string {
  if (yearFrom && yearTo) return `${yearFrom}–${yearTo}`;
  if (yearFrom) return `з ${yearFrom}`;
  if (yearTo) return `до ${yearTo}`;
  return '';
}

function CompatibilityBadge({ item }: { item: TecdocCompatibilityItem }) {
  const yearRange = formatYearRange(item.yearFrom, item.yearTo);
  const label = `Запчастини для ${item.make}`;

  return item.makeSlug ? (
    <Link
      href={`/marky/${item.makeSlug}`}
      className="text-xs px-3 py-1.5 rounded-full underline"
      style={{ border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
    >
      {label}
      {yearRange ? ` (${yearRange})` : ''}
    </Link>
  ) : (
    <span
      className="text-xs px-3 py-1.5 rounded-full"
      style={{ border: `1px solid ${BORDER_SOFT}`, opacity: 0.6 }}
    >
      {label}
      {yearRange ? ` (${yearRange})` : ''}
    </span>
  );
}
