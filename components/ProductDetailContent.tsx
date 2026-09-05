// ============================================================
// Вміст сторінки товару — сам товар + "інші пропозиції" + OEM/аналоги.
// Не містить зовнішнього фону/відступів на весь екран — це навмисно,
// щоб той самий вміст можна було вставити і в звичайну сторінку
// (app/p/[id]/[[...slug]]/page.tsx, свій фон на весь екран), і в
// модальне вікно (app/@modal/(...)p/[id]/[[...slug]]/page.tsx, фон і
// рамку дає components/ProductModalShell.tsx) — без дублювання розмітки
// товару в двох місцях
//
// Стиль — той самий темний "Tech Premium", що і на Головній
// (components/StorefrontHome.tsx): BG/PAPER/BODY_FONT нижче навмисно
// лишились під ТИМИ Ж НАЗВАМИ (їх імпортують app/p/[id]/[[...slug]]/
// page.tsx та .../loading.tsx для фону сторінки навколо цього
// компонента) — змінились лише значення кольорів, тому обидва файли
// автоматично стали тёмными без окремого редагування
// ============================================================

import Link from 'next/link';
import { buildProductPath } from '@/lib/slug';
import { buildBreadcrumbJsonLd, buildSingleProductJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import type { CrossRefItem, ProductPageData, TecdocCompatibilityItem, TecdocCrossItem } from '@/lib/productDetail';
import AddToCartButton from '@/components/AddToCartButton';
import QuickOrderModal from '@/components/QuickOrderModal';
import ProductViewTracker from '@/components/ProductViewTracker';

export const BG = '#0B0F17';
export const PANEL_SOFT = '#1B2436';
export const BORDER_SOFT = 'rgba(255,255,255,0.1)';
export const ACCENT = '#60A5FA';
export const PAPER = '#F1F5F9';
export const SUCCESS_TEXT = '#34D399';
export const DISPLAY_FONT = 'var(--font-space-grotesk), "Space Grotesk", sans-serif';
export const BODY_FONT = 'var(--font-inter-tech), Inter, sans-serif';

// Токени, потрібні лише всередині цього файлу (зовні їх ніхто не
// імпортує, на відміну від сімки вище)
const MONO_FONT = 'var(--font-jetbrains-mono), "JetBrains Mono", ui-monospace, monospace';
const MUTED = '#94A3B8';
const FAINT = '#54607A';
const SURFACE_GLASS = 'rgba(20,27,41,0.6)';
const GOOD_SOFT = 'rgba(52,211,153,0.14)';
const HEAT = '#FF6B00';
const HEAT_SOFT = 'rgba(255,107,0,0.14)';

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

// Бейдж наявності — той самий візуальний язик, що і в таблиці
// результатів пошуку на Головній (components/StorefrontHome.tsx):
// зелене м'яке світіння для "в наявності", бурштинове для "під
// замовлення" — щоб покупець бачив однакову мову кольорів всюди на сайті
function StockBadge({ stock }: { stock: number }) {
  const inStock = stock > 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        fontFamily: BODY_FONT,
        background: inStock ? GOOD_SOFT : HEAT_SOFT,
        color: inStock ? SUCCESS_TEXT : HEAT,
        boxShadow: inStock ? '0 0 0 1px rgba(52,211,153,0.25)' : '0 0 0 1px rgba(255,107,0,0.28)',
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {inStock ? `В наявності: ${stock} шт` : 'Під замовлення'}
    </span>
  );
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
      {/* Аналитика (Google Analytics 4 + Meta Pixel) — событие
          "просмотр товара", см. components/ProductViewTracker.tsx.
          Ничего не рендерит, просто отправляет событие один раз при
          открытии страницы */}
      <ProductViewTracker
        id={product.id}
        name={displayName}
        brand={product.brand}
        price={product.retailPrice}
      />
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

      <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ fontFamily: BODY_FONT, color: FAINT }}>
        {breadcrumbItems.map((item, index) => (
          <span key={item.url}>
            {index > 0 && ' / '}
            {index < breadcrumbItems.length - 1 ? (
              <Link href={item.url.replace(SITE_URL, '')} className="transition-colors hover:text-[#60A5FA]" style={{ color: MUTED }}>
                {item.name}
              </Link>
            ) : (
              <span style={{ color: MUTED }}>{item.name}</span>
            )}
          </span>
        ))}
      </nav>

      <div className="mb-10 grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr]">
        {/* ==================== ФОТО ==================== */}
        <div
          className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl"
          style={{
            background: PANEL_SOFT,
            backgroundImage: product.imageUrl
              ? undefined
              : 'linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.04) 25%, transparent 25%)',
            backgroundSize: '12px 12px',
            border: `1px solid ${BORDER_SOFT}`,
          }}
        >
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={FAINT} strokeWidth="1.4">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 16l-5-5-4 4-2-2-7 7" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* ==================== ІНФОРМАЦІЯ ==================== */}
        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs" style={{ fontFamily: BODY_FONT }}>
            <span className="font-bold uppercase tracking-wide" style={{ color: ACCENT }}>
              {product.brand || 'Без бренду'}
            </span>
            <span
              className="rounded-md px-2 py-0.5 font-medium"
              style={{ fontFamily: MONO_FONT, color: ACCENT, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)' }}
            >
              {product.article}
            </span>
          </div>
          <h1
            className="mb-3 text-2xl md:text-3xl"
            style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff', textWrap: 'balance' }}
          >
            {displayName}
          </h1>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span
              style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: 30, color: '#fff', fontVariantNumeric: 'tabular-nums' }}
            >
              {formatMoney(product.retailPrice)} <span style={{ fontSize: 16, color: FAINT, fontFamily: BODY_FONT }}>грн</span>
            </span>
            <StockBadge stock={product.stock} />
          </div>

          {product.stock <= 0 && product.deliveryTime && (
            <p className="mb-4 text-sm" style={{ fontFamily: BODY_FONT, color: MUTED }}>
              Термін поставки: {product.deliveryTime}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
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
            <QuickOrderModal
              product={{
                id: product.id,
                article: product.article,
                brand: product.brand,
                name: product.name,
                retailPrice: product.retailPrice,
              }}
            />
          </div>
        </div>
      </div>

      {/* ==================== ІНШІ ПРОПОЗИЦІЇ НА ЦЮ Ж ДЕТАЛЬ ==================== */}
      {/* Той самий бренд+артикул зустрічається в декількох
          постачальників (перевірено на бойовій базі — це НЕ рідкість:
          4 745 таких пар) — чесно показуємо покупцю вибір, а не
          ховаємо його */}
      {otherOffers.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Ця ж деталь в інших постачальників
          </h2>
          <div className="flex flex-col gap-2">
            {otherOffers.map((offer) => (
              <Link
                key={offer.id}
                href={buildProductPath(offer.id, product)}
                className="flex items-center justify-between rounded-xl p-3.5 text-sm transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                style={{ fontFamily: BODY_FONT, background: SURFACE_GLASS, border: `1px solid ${BORDER_SOFT}`, color: PAPER }}
              >
                <span>{offer.supplierName}</span>
                <span className="flex items-center gap-3">
                  <StockBadge stock={offer.stock} />
                  <span style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, color: '#fff' }}>{formatMoney(offer.retailPrice)} грн</span>
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
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            OEM-номери та аналоги
          </h2>
          {crossRefs.oem.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ fontFamily: BODY_FONT, color: FAINT }}>
                Оригінальні номери (OEM)
              </h3>
              <CrossRefList items={crossRefs.oem} product={product} />
            </div>
          )}
          {crossRefs.aftermarket.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ fontFamily: BODY_FONT, color: FAINT }}>
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
          дають SEO-текст під запити на кшталт "0986424815 купити".
          Згорнуто в <details> (не видалено!) — весь список і далі
          лежить у HTML сторінки, тому пошуковики бачать його так само,
          як і раніше; звичайний покупець просто не бачить довгий
          список одразу, а розгортає його за бажанням */}
      {tecdocCrosses.length > 0 && (
        <section className="mb-10">
          <details className="group">
            <summary
              className="mb-3 flex cursor-pointer select-none items-center gap-2 text-lg font-semibold [&::-webkit-details-marker]:hidden"
              style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}
            >
              <span className="inline-block transition-transform duration-200 group-open:rotate-90" style={{ color: ACCENT }} aria-hidden="true">
                ▸
              </span>
              Аналоги та OEM-номери
              <span className="text-sm font-normal" style={{ fontFamily: BODY_FONT, color: FAINT }}>
                ({tecdocCrosses.length})
              </span>
            </summary>
            <TecdocCrossList items={tecdocCrosses} />
          </details>
        </section>
      )}

      {/* ==================== ЗАСТОСОВНІСТЬ ДО АВТО (TecDoc) ==================== */}
      {tecdocCompatibility.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Запчастина підходить для авто
          </h2>
          <div className="flex flex-wrap gap-2">
            {tecdocCompatibility.map((item, index) => (
              <CompatibilityBadge
                key={`${item.make}-${item.model}-${item.yearFrom ?? ''}-${item.yearTo ?? ''}-${item.engine}-${index}`}
                item={item}
              />
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
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
            style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
          >
            {item.brand} {item.partNumber}
            {item.stock !== null && item.stock > 0 ? ` · ${formatMoney(item.retailPrice || 0)} грн` : ''}
          </Link>
        ) : (
          <span
            key={`${item.brand}-${item.partNumber}`}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: FAINT }}
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
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
            style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
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
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: FAINT }}
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

// TecDoc записує кузов/покоління підкресленнями на кшталт
// "(_T22_)" — прибираємо їх для показу покупцю (лишається "(T22)"),
// самі дані в базі не чіпаємо
function cleanModelDisplay(model: string): string {
  return model.replace(/_/g, '').replace(/\s+/g, ' ').trim();
}

function CompatibilityBadge({ item }: { item: TecdocCompatibilityItem }) {
  const yearRange = formatYearRange(item.yearFrom, item.yearTo);
  const modelDisplay = item.model ? cleanModelDisplay(item.model) : '';
  const label = `Запчастини для ${item.make}${modelDisplay ? ' ' + modelDisplay : ''}`;
  // Дужки-примітка: рік і об'єм двигуна разом, напр. "(1997–2003, 1.6)"
  const note = [yearRange, item.engine ? `${item.engine} л` : ''].filter(Boolean).join(', ');

  return item.makeSlug ? (
    <Link
      href={`/marky/${item.makeSlug}`}
      className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
      style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
    >
      {label}
      {note ? ` (${note})` : ''}
    </Link>
  ) : (
    <span
      className="rounded-full px-3 py-1.5 text-xs font-medium"
      style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: FAINT }}
    >
      {label}
      {note ? ` (${note})` : ''}
    </span>
  );
}
