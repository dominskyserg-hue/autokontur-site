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
import { Send, Truck, Banknote, RotateCcw, ScanSearch } from 'lucide-react';
import { TELEGRAM_BOT_USERNAME } from '@/lib/telegramNotify';
import { buildProductPath } from '@/lib/slug';
import { buildFaqJsonLd, buildSingleProductJsonLd, jsonLdScript } from '@/lib/structuredData';
import { SITE_URL } from '@/lib/siteConfig';
import { findAnyNarrowPageForVehicle } from '@/lib/categories';
import { buildSeoProductDescription, buildSeoProductName, resolveFaqItems, type CrossRefItem, type ProductPageData, type SimilarProduct, type TecdocCompatibilityItem, type TecdocCrossItem } from '@/lib/productDetail';
import AddToCartButton from '@/components/AddToCartButton';
import FavoriteButton from '@/components/FavoriteButton';
import QuickOrderModal from '@/components/QuickOrderModal';
import ProductViewTracker from '@/components/ProductViewTracker';
import ProductGallery, { type GalleryPhoto } from '@/components/ProductGallery';
import { getCategoryIcon } from '@/lib/categoryIcons';
import Breadcrumbs from '@/components/Breadcrumbs';

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

// Формула alt з інструкції SEO-доробки: "БРЕНД АРТИКУЛ — що на фото".
// Для головного фото "що на фото" — це назва товару (вона й так
// найкраще описує загальний вигляд), для додаткових фото з галереї —
// підпис, який ввів адмін (label), або запасний варіант за номером
// фото, якщо підпис ще не заповнили — так alt ніколи не повторюється
// на двох різних фото одного товару
function buildGalleryPhotos(product: ProductPageData['product'], images: ProductPageData['images'], displayName: string): GalleryPhoto[] {
  const brandArticle = [product.brand, product.article].filter(Boolean).join(' ');
  const prefix = brandArticle ? `${brandArticle} — ` : '';

  const photos: GalleryPhoto[] = [];
  if (product.imageUrl) {
    photos.push({ url: product.imageUrl, alt: `${prefix}${displayName}` });
  }
  images.forEach((image, index) => {
    photos.push({ url: image.url, alt: `${prefix}${image.label?.trim() || `додаткове фото ${index + 1}`}` });
  });

  return photos;
}

export default function ProductDetailContent({
  product,
  images,
  otherOffers,
  crossRefs,
  tecdocCrosses,
  tecdocCompatibility,
  breadcrumbItems,
  seoOverride,
  pairPartPath,
  supplierCatalogName,
  category,
  similarProducts,
}: ProductPageData) {
  const displayName = buildSeoProductName(product);
  const galleryPhotos = buildGalleryPhotos(product, images, displayName);

  // Той самий canonical URL, що й <link rel="canonical"> у
  // generateMetadata (app/p/[id]/[[...slug]]/page.tsx) — рахується з
  // СИРИХ product.brand/name/article (buildProductPath), а НЕ з
  // displayName. Раніше тут передавали в JSON-LD name: displayName і
  // давали Product.url/Offer.url пересчитатись ЗАНОВО з цього
  // displayName — для товарів з довгим SEO-заголовком (категорія чи
  // override.h1) це давало ІНШИЙ слаг, ніж справжній canonical (баг:
  // артикул у слазі задвоювався). Тепер url передається явно —
  // productJsonLd (lib/structuredData.ts) більше нічого не пересчитує
  const canonicalUrl = `${SITE_URL}${buildProductPath(product.id, product)}`;

  const faqItems = resolveFaqItems(seoOverride?.faq);

  // OEM/крос-номери для рядка характеристик — лише куровані адміном
  // (cross_reference_members), не більше 6; повний масовий список TecDoc —
  // окремим блоком "Аналоги" нижче
  const oemNumbers = [...crossRefs.oem, ...crossRefs.aftermarket]
    .slice(0, 6)
    .map((item) => `${item.brand} ${item.partNumber}`)
    .join(', ');

  // Рядки блоку "Характеристики" (рішення власника): бренд, артикул,
  // категорія, стан, OEM/крос-номери; далі ручні (seoOverride.specs) і
  // "Назва в каталозі постачальника" (лише якщо відрізняється від H1)
  const specRows: Array<{ label: string; value: string; href?: string }> = [
    { label: 'Бренд', value: product.brand || 'Без бренду' },
    { label: 'Артикул', value: product.article },
    ...(category ? [{ label: 'Категорія', value: category.name, href: `/category/${category.slug}` }] : []),
    { label: 'Стан', value: 'Новий' },
    ...(oemNumbers ? [{ label: 'OEM / крос-номери', value: oemNumbers }] : []),
    ...(seoOverride?.specs ?? []),
    ...(supplierCatalogName ? [{ label: 'Назва в каталозі постачальника', value: supplierCatalogName }] : []),
  ];

  // Даних про сумісність немає ні з TecDoc, ні з ручного оверрайду —
  // замість порожнього місця пропонуємо перевірити сумісність за VIN
  const hasCompatibility = tecdocCompatibility.length > 0 || Boolean(seoOverride?.applicability?.length);

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
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            buildSingleProductJsonLd({
              ...product,
              name: displayName,
              description: buildSeoProductDescription(product),
              url: canonicalUrl,
            })
          ),
        }}
      />
      {/* FAQPage — лише якщо в товару є FAQ через SEO-оверрайд
          (data/seo-overrides.ts). items тут — ТОЧНО ті самі, що
          рендеряться нижче видимим акордеоном (секція "Часті
          запитання") — Google звіряє розмітку з видимим текстом */}
      {faqItems && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: jsonLdScript(buildFaqJsonLd(faqItems)) }}
        />
      )}

      {/* Хлібні крихти + JSON-LD BreadcrumbList з одного масиву (components/Breadcrumbs.tsx) */}
      <Breadcrumbs items={breadcrumbItems} />

      <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr] md:gap-8">
        {/* ==================== ФОТО ==================== */}
        {/* Без фото — компактна заглушка з іконкою категорії (≤180px на
            мобільному, квадрат 300px на десктопі), див. ProductGallery */}
        <ProductGallery photos={galleryPhotos} categorySlug={category?.slug} categoryName={category?.name} />

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

          {/* "Термін поставки" тут — це термін, за який постачальник
              відвантажує товар ПІСЛЯ того, як ми зробимо в нього
              замовлення (напр. "сьогодні" = постачальник відправляє
              в той самий день) — а НЕ термін, за який товар потрапить
              до покупця. Раніше напис був просто "Термін поставки:
              {X}" одразу під бейджем "Під замовлення" — це читалось
              як суперечність ("під замовлення" + "сьогодні" поруч).
              Уточнене формулювання прибирає цю двозначність */}
          {product.stock <= 0 && product.deliveryTime && (
            <p className="mb-4 text-sm" style={{ fontFamily: BODY_FONT, color: MUTED }}>
              Очікуваний термін відвантаження постачальником: {product.deliveryTime}
            </p>
          )}

          {/* ==================== ДОСТАВКА / ОПЛАТА / ПОВЕРНЕННЯ ==================== */}
          {/* Реальні умови з /delivery і /returns (site_pages у базі) —
              текст, а не вигадані обіцянки: замовлення в наявності
              відправляються в день оформлення, оплата післяплатою при
              отриманні, 14 днів на повернення товару належної якості
              за Законом України "Про захист прав споживачів" (та сама
              цифра, що і в hasMerchantReturnPolicy, lib/structuredData.ts) */}
          <div
            className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
            style={{ fontFamily: BODY_FONT, color: MUTED }}
          >
            {product.stock > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" style={{ color: ACCENT }} />
                Відправка сьогодні
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Banknote className="h-3.5 w-3.5" style={{ color: ACCENT }} />
              Оплата при отриманні
            </span>
            <span className="inline-flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" style={{ color: ACCENT }} />
              14 днів на повернення
            </span>
          </div>

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
            <FavoriteButton productId={product.id} />
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

          {/* ==================== ПИТАННЯ ПРО ТОВАР У TELEGRAM ==================== */}
          {/* Відкриває чат із ботом @dominatorparts_orders_bot без
              "/start" — будь-яке повідомлення звідти потрапляє
              менеджеру (окрема тема на покупця в закритій групі
              підтримки, app/api/telegram/webhook/route.ts), той самий
              механізм, що і кнопка "Telegram" у шапці Головної */}
          <a
            href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: MUTED }}
          >
            <Send className="h-4 w-4" style={{ color: ACCENT }} />
            Є питання? Напишіть нам у Telegram
          </a>
        </div>
      </div>

      {/* ==================== ОПИС (ручний SEO-оверрайд) ==================== */}
      {/* Розгорнутий опис товару — ЛИШЕ якщо для артикула є запис у
          data/seo-overrides.ts (override.longDescription). Автоматично
          такий текст не генерується: сторінка не знає, наприклад, що
          конкретний кронштейн — саме для радара Side Assist, а не
          якоїсь іншої деталі, вигадувати це небезпечно */}
      {seoOverride?.longDescription && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Опис
          </h2>
          <p className="max-w-3xl text-sm leading-relaxed" style={{ fontFamily: BODY_FONT, color: MUTED }}>
            {seoOverride.longDescription}
          </p>
        </section>
      )}

      {/* ==================== ХАРАКТЕРИСТИКИ ==================== */}
      {specRows.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Характеристики
          </h2>
          <div className="max-w-2xl overflow-hidden rounded-xl" style={{ border: `1px solid ${BORDER_SOFT}` }}>
            <table className="w-full text-sm" style={{ fontFamily: BODY_FONT }}>
              <tbody>
                {specRows.map((spec, index) => (
                  <tr key={spec.label} style={index > 0 ? { borderTop: `1px solid ${BORDER_SOFT}` } : undefined}>
                    <td className="w-1/3 px-4 py-2.5 align-top" style={{ color: FAINT }}>
                      {spec.label}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: PAPER, fontFamily: spec.label === 'Артикул' ? MONO_FONT : undefined }}>
                      {spec.href ? (
                        <Link href={spec.href} className="underline decoration-dotted underline-offset-2" style={{ color: ACCENT }}>
                          {spec.value}
                        </Link>
                      ) : (
                        spec.value
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Парна деталь (напр. лівий/правий варіант) — якщо
              pairPartPath знайдено в каталозі (lib/productDetail.ts,
              loadPairPartPath), показуємо посиланням, інакше просто
              текстом без посилання */}
          {seoOverride?.pairPart && (
            <p className="mt-3 max-w-2xl text-sm" style={{ fontFamily: BODY_FONT, color: MUTED }}>
              {pairPartPath ? (
                <Link href={pairPartPath} className="font-medium" style={{ color: ACCENT }}>
                  {seoOverride.pairPart.note}
                </Link>
              ) : (
                seoOverride.pairPart.note
              )}
            </p>
          )}
        </section>
      )}

      {/* ==================== СУМІСНІСТЬ (ручний SEO-оверрайд) ==================== */}
      {/* НЕ те саме, що секція "Запчастина підходить для авто" нижче —
          та будується автоматично з офіційного дампа TecDoc
          (tecdoc_compatibility), а ця — ручний список конкретних
          моделей з SEO-оверрайду, коли автоматичних даних по товару
          взагалі немає (як у цього кронштейна — car_make/car_model
          порожні, TecDoc-записів теж нема) */}
      {seoOverride?.applicability && seoOverride.applicability.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Підходить для
          </h2>
          <div className="flex flex-wrap gap-2">
            {seoOverride.applicability.map((item) =>
              item.makeSlug ? (
                <Link
                  key={item.label}
                  href={`/marky/${item.makeSlug}`}
                  className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
                  style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: ACCENT }}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  className="rounded-full px-3 py-1.5 text-xs font-medium"
                  style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: FAINT }}
                >
                  {item.label}
                </span>
              )
            )}
          </div>
        </section>
      )}

      {/* ==================== ІНШІ ПРОПОЗИЦІЇ НА ЦЮ Ж ДЕТАЛЬ ==================== */}
      {/* Той самий бренд+артикул зустрічається в декількох
          постачальників (перевірено на бойовій базі — це НЕ рідкість:
          4 745 таких пар) — чесно показуємо покупцю вибір, а не
          ховаємо його */}
      {otherOffers.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Інші пропозиції на цю деталь
          </h2>
          <div className="flex flex-col gap-2">
            {/* Название поставщика покупателю НЕ показываем (аудит
                безопасности) — только номер предложения, наличие и цену */}
            {otherOffers.map((offer, index) => (
              <Link
                key={offer.id}
                href={buildProductPath(offer.id, product)}
                className="flex items-center justify-between rounded-xl p-3.5 text-sm transition-colors hover:bg-[rgba(59,130,246,0.07)]"
                style={{ fontFamily: BODY_FONT, background: SURFACE_GLASS, border: `1px solid ${BORDER_SOFT}`, color: PAPER }}
              >
                <span>Пропозиція {index + 2}</span>
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
          {/* Короткий список (≤ 6) розгорнутий одразу — ховати нічого */}
          <details className="group" open={tecdocCrosses.length <= 6}>
            <summary
              className="mb-3 flex cursor-pointer select-none items-center gap-2 text-lg font-semibold [&::-webkit-details-marker]:hidden"
              style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}
            >
              <span className="inline-block transition-transform duration-200 group-open:rotate-90" style={{ color: ACCENT }} aria-hidden="true">
                ▸
              </span>
              Аналоги
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

      {/* ==================== ПЕРЕВІРИТИ СУМІСНІСТЬ ЗА VIN ==================== */}
      {/* Даних про сумісність немає — замість порожнечі пропонуємо
          перевірити за VIN: менеджер у Telegram або форма підбору */}
      {!hasCompatibility && (
        <section className="mb-10 rounded-2xl p-5" style={{ background: SURFACE_GLASS, border: `1px solid ${BORDER_SOFT}` }}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            <ScanSearch className="h-5 w-5" style={{ color: ACCENT }} />
            Перевірити сумісність за VIN
          </h2>
          <p className="mb-4 max-w-2xl text-sm" style={{ fontFamily: BODY_FONT, color: MUTED }}>
            Для цієї деталі немає даних про сумісність у каталозі. Надішліть VIN-код авто — менеджер перевірить, чи підходить
            вона саме вашій машині.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
              style={{ fontFamily: BODY_FONT, background: 'rgba(59,130,246,0.15)', color: ACCENT, border: '1px solid rgba(59,130,246,0.35)' }}
            >
              <Send className="h-4 w-4" />
              Надіслати VIN у Telegram
            </a>
            <Link
              href="/pidbir-za-vin"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
              style={{ fontFamily: BODY_FONT, border: `1px solid ${BORDER_SOFT}`, color: MUTED }}
            >
              Підбір за VIN на сайті →
            </Link>
          </div>
        </section>
      )}

      {/* ==================== СХОЖІ ТОВАРИ ==================== */}
      {similarProducts.length > 0 && category && (
        <section className="mb-10">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
              Схожі товари
            </h2>
            <Link href={`/category/${category.slug}`} className="text-sm" style={{ fontFamily: BODY_FONT, color: ACCENT }}>
              Усі: {category.name} →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {similarProducts.map((item) => (
              <SimilarProductCard key={item.id} item={item} categorySlug={category.slug} />
            ))}
          </div>
        </section>
      )}

      {/* ==================== ДОСТАВКА І ОПЛАТА ==================== */}
      {/* Ті самі реальні умови, що й під кнопками (з /delivery і /returns) */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
          Доставка і оплата
        </h2>
        <ul className="flex max-w-2xl flex-col gap-2.5 text-sm" style={{ fontFamily: BODY_FONT, color: MUTED }}>
          <li className="flex items-start gap-2.5">
            <Truck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT }} />
            <span>
              Доставка Новою Поштою по всій Україні. Товари в наявності відправляємо в день замовлення.{' '}
              <Link href="/delivery" className="underline" style={{ color: ACCENT }}>
                Детальніше
              </Link>
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT }} />
            <span>Оплата при отриманні у відділенні — перевіряєте деталь, потім платите.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT }} />
            <span>
              14 днів на повернення товару належної якості.{' '}
              <Link href="/returns" className="underline" style={{ color: ACCENT }}>
                Умови повернення
              </Link>
            </span>
          </li>
        </ul>
      </section>

      {/* ==================== ЧАСТІ ЗАПИТАННЯ (ручний SEO-оверрайд) ==================== */}
      {/* faqItems — той самий результат resolveFaqItems(), що й у
          FAQPage JSON-LD вище — видимий текст і розмітка мають
          збігатися */}
      {faqItems && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: '#fff' }}>
            Часті запитання
          </h2>
          <div className="flex flex-col gap-2">
            {faqItems.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl px-4 py-3"
                style={{ background: SURFACE_GLASS, border: `1px solid ${BORDER_SOFT}` }}
              >
                <summary
                  className="flex cursor-pointer select-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"
                  style={{ fontFamily: BODY_FONT, color: PAPER }}
                >
                  {item.question}
                  <span className="shrink-0 transition-transform duration-200 group-open:rotate-45" style={{ color: ACCENT }} aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed" style={{ fontFamily: BODY_FONT, color: MUTED }}>
                  {item.answer}
                </p>
                {item.link && (
                  <a
                    href={item.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm font-medium underline"
                    style={{ fontFamily: BODY_FONT, color: ACCENT }}
                  >
                    {item.link.label} →
                  </a>
                )}
              </details>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// Картка в "Схожі товари": фото (або іконка категорії), бренд · артикул,
// назва як у H1 товару, ціна
function SimilarProductCard({ item, categorySlug }: { item: SimilarProduct; categorySlug: string }) {
  const Icon = getCategoryIcon(categorySlug);
  const name = buildSeoProductName({ name: item.name, brand: item.brand, article: item.article });
  return (
    <Link
      href={buildProductPath(item.id, item)}
      className="flex flex-col rounded-xl p-3 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
      style={{ background: SURFACE_GLASS, border: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mb-2.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg" style={{ background: PANEL_SOFT }}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-10 w-10" strokeWidth={1.3} style={{ color: FAINT }} aria-hidden="true" />
        )}
      </div>
      <div className="mb-1 truncate text-[11px] font-bold uppercase tracking-wide" style={{ fontFamily: BODY_FONT, color: ACCENT }}>
        {item.brand || 'Без бренду'} <span style={{ fontFamily: MONO_FONT, color: MUTED, fontWeight: 500 }}>{item.article}</span>
      </div>
      <div className="mb-2 line-clamp-2 text-xs" style={{ fontFamily: BODY_FONT, color: PAPER }}>
        {name}
      </div>
      <div className="mt-auto" style={{ fontFamily: DISPLAY_FONT, fontWeight: 600, fontSize: 16, color: '#fff' }}>
        {formatMoney(item.retailPrice)} грн
      </div>
    </Link>
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

  // Застосовність визначена не напряму з дампа TecDoc для цього
  // бренду/артикула, а через крос-номер іншого виробника (schema.sql,
  // розділ 27) — видима позначка "· аналог" ЗАВЖДИ поруч із текстом
  // (не лише в title при наведенні — на телефоні навести нема як), а
  // пунктирна рамка додатково відрізняє такий бейдж від звичайного
  const isCrossReference = Boolean(item.sourceNote);
  const badgeStyle = {
    fontFamily: BODY_FONT,
    border: `1px ${isCrossReference ? 'dashed' : 'solid'} ${BORDER_SOFT}`,
  };
  const title = isCrossReference ? `Визначено ${item.sourceNote} — не офіційний каталог виробника` : undefined;

  const content = (
    <>
      {label}
      {note ? ` (${note})` : ''}
      {isCrossReference ? ' · аналог' : ''}
    </>
  );

  // Спершу пробуємо знайти вже готову посадкову сторінку САМЕ ЦІЄЇ
  // моделі (напр. "/category/mazda-6-gg-halmivni-kolodky") — раніше
  // бейдж ЗАВЖДИ вів на загальну сторінку марки ("/marky/mazda"),
  // однаково для всіх моделей цієї марки в списку застосовності, що
  // виглядало як однакове посилання, повторене багато разів. Якщо
  // готової сторінки під цю модель ще нема — лишається старий
  // фолбек на сторінку марки; якщо марка взагалі некурована — просто
  // текст без посилання
  // Пріоритет: хаб моделі (усі запчастини цього покоління, lib/modelHubs.ts)
  // -> вузька сторінка "модель + деталь" -> сторінка марки
  const narrowPage = item.model ? findAnyNarrowPageForVehicle(item.makeRaw, item.model) : undefined;
  const href = item.hubPath ?? (narrowPage ? `/category/${narrowPage.slug}` : item.makeSlug ? `/marky/${item.makeSlug}` : null);

  return href ? (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
      style={{ ...badgeStyle, color: ACCENT }}
      title={title}
    >
      {content}
    </Link>
  ) : (
    <span
      className="rounded-full px-3 py-1.5 text-xs font-medium"
      style={{ ...badgeStyle, color: FAINT }}
      title={title}
    >
      {content}
    </span>
  );
}
