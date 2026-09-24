// ============================================================
// Schema.org JSON-LD для карток товарів (Product/Offer) і хлібних
// крихт (BreadcrumbList) — спільний код для SEO-сторінок, які
// показують реальний список товарів із бази: app/category/[slug],
// app/marky/[make], app/marky/[make]/to. Це чиста трансформація вже
// завантажених даних у JSON-LD, без побічних ефектів і без запитів
// до бази — тому, на відміну від пулу з'єднань (навмисно дубльованого
// в кожному роуті під serverless), тут звичайний спільний імпорт.
//
// Product.url/Offer.url ведуть на справжню сторінку товару
// (app/p/[id]/[[...slug]]/page.tsx, lib/slug.ts) — там же
// buildSingleProductJsonLd() використовується для розмітки ОДНОГО
// товару, а buildProductListJsonLd() тут, нижче, — для ItemList на
// сторінках-каталогах (категорія, марка). Обидва варіанти офіційно
// документовані Google, кожен для свого типу сторінки.
// ============================================================

import { SITE_URL } from './siteConfig';
import { buildProductPath } from './slug';

export interface SchemaProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  // Необов'язкові — заповнені лише там, де реально є в даних (сторінка
  // одного товару має і фото, і meta_description; списки категорій/
  // марок мають лише фото, без опису для кожного товару). Google не
  // вимагає ці поля обов'язково, але рекомендує додавати, якщо вони
  // реально є — вигадувати їх, коли даних нема, ми НЕ будемо
  imageUrl?: string | null;
  description?: string | null;
  // Явний canonical URL товару — якщо переданий, використовується
  // ЗАМІСТЬ автоматичного пересчёту через buildProductPath(id, {brand,
  // name, article}). Потрібен сторінці ОДНОГО товару
  // (components/ProductDetailContent.tsx): там у name підставляється
  // ВІДОБРАЖУВАНЕ SEO-назва (з префіксом категорії або з H1 з
  // SEO-оверрайду), яка НЕ збігається зі слагом справжнього canonical —
  // без цього поля Product.url/Offer.url розходились би з
  // <link rel="canonical"> (був саме такий баг: слаг з JSON-LD
  // задвоював артикул). Списки категорій/марок (buildProductListJsonLd)
  // це поле не передають — там name і так сирий, розбіжності нема
  url?: string;
}

// Дуже поширений випадок саме в автозапчастинах (особливо стартери й
// генератори) — товар не новий, а відновлений/реставрований. Якщо це
// видно з назви товару (яку заповнює постачальник у прайсі), чесно
// позначаємо itemCondition — інакше Google Merchant може порахувати
// це вводом покупця в оману й понизити довіру до всього фіда
const REFURBISHED_PATTERN = /реставрац|відновлен|восстановлен|б\/у/i;

function productUrl(product: SchemaProduct): string {
  return product.url ?? `${SITE_URL}${buildProductPath(product.id, product)}`;
}

// priceValidUntil — Google рекомендує вказувати цю дату для Offer,
// інакше через якийсь час позначає ціну як "застарілу". Прайси
// поставщиків перезаливаються нерегулярно, тому беремо із запасом
// на місяць вперед від моменту рендеру сторінки
function priceValidUntil(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

// Експортована — сторінка одного товару (app/p/[id]/[[...slug]]) бере
// цю саму функцію напряму, без обгортки в ItemList/ListItem
// Умови повернення — РЕАЛЬНИЙ текст із сторінки /returns (site_pages
// у базі, components/InfoPage.tsx): 14 днів на повернення товару
// належної якості згідно Закону України "Про захист прав споживачів".
// Винесено сюди єдиним джерелом, а не продубльовано в кожному виклику —
// якщо термін повернення колись зміниться, правити лише тут
const RETURN_POLICY = {
  '@type': 'MerchantReturnPolicy',
  applicableCountry: 'UA',
  returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
  merchantReturnDays: 14,
  returnMethod: 'https://schema.org/ReturnByMail',
  // Товар належної якості (не бракований) покупець повертає за свій
  // рахунок — так само, як і в самому тексті /returns.
  // ReturnFeesCustomerResponsibility (а не ReturnShippingFees) — бо
  // ReturnShippingFees за специфікацією Google означає конкретну
  // фіксовану суму витрат на повернення (тоді обов'язкове ще й поле
  // returnShippingFeesAmount), якої в нас немає — покупець просто сам
  // оплачує повернення без наперед відомої суми
  returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
} as const;

export function productJsonLd(product: SchemaProduct) {
  const displayName =
    product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ') || product.article;

  const url = productUrl(product);

  return {
    '@type': 'Product',
    sku: product.article,
    // mpn (Manufacturer Part Number) — для автозапчастин це той самий
    // артикул, що й sku вище: у цьому каталозі немає окремого
    // "внутрішнього" номера, відмінного від номера виробника
    mpn: product.article,
    name: displayName,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(product.imageUrl ? { image: product.imageUrl } : {}),
    ...(product.description ? { description: product.description } : {}),
    url,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'UAH',
      // Math.ceil — ТА САМА ціна, що бачить покупець (formatMoney()
      // у видимій частині сторінки теж округлює вгору й ховає копійки).
      // Ціна в мікророзмітці має ЗБІГАТИСЯ з видимою — інакше Google
      // Rich Results Test і Merchant Center позначать це як помилку
      // "невідповідність ціни"
      price: Math.ceil(product.retailPrice),
      availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/BackOrder',
      itemCondition: REFURBISHED_PATTERN.test(product.name || '')
        ? 'https://schema.org/RefurbishedCondition'
        : 'https://schema.org/NewCondition',
      priceValidUntil: priceValidUntil(),
      hasMerchantReturnPolicy: RETURN_POLICY,
    },
  };
}

// Розмітка ОДНОГО товару — для сторінки app/p/[id]/[[...slug]], на
// відміну від buildProductListJsonLd() нижче (для сторінок-каталогів)
export function buildSingleProductJsonLd(product: SchemaProduct) {
  return {
    '@context': 'https://schema.org',
    ...productJsonLd(product),
  };
}

// Google офіційно підтримує ItemList саме для сторінок-каталогів
// (категорія, підбірка за маркою тощо) — на відміну від одиничного
// Product, тут очікується список, а не "ця сторінка присвячена
// одному товару"
export function buildProductListJsonLd(products: SchemaProduct[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: productJsonLd(product),
    })),
  };
}

// Organization + WebSite (з SearchAction) — обидва рекомендовані Google
// саме на Головній (а не на кожній сторінці): показують пошуковику,
// хто власник сайту (для Knowledge Panel/логотипу в видачі) і що на
// сайті є свій пошук (може дати "sitelinks search box" прямо в
// результатах пошуку Google). Раніше на сайті не було жодного з них
export function buildOrganizationJsonLd(phone: string | null) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'DominatorParts',
    url: SITE_URL,
    logo: `${SITE_URL}/apple-touch-icon.png`,
    ...(phone
      ? {
          contactPoint: {
            '@type': 'ContactPoint',
            telephone: phone,
            contactType: 'customer service',
            areaServed: 'UA',
            availableLanguage: ['uk', 'ru'],
          },
        }
      : {}),
  };
}

// target — той самий "/?article=..." deep-link, який вже вміє
// відкривати StorefrontHome.tsx (виконує пошук одразу при завантаженні
// сторінки, див. коментар біля useEffect з window.location.search) —
// окремої server-rendered сторінки результатів пошуку на сайті нема,
// тому для sitelinks search box використовуємо саме цей робочий
// deep-link, а не вигадану адресу
export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'DominatorParts',
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/?article={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

// items — у ТОМУ Ж порядку, що й видимі хлібні крихти на сторінці
// (Google звіряє видиму розмітку зі структурованими даними, так само
// як і з FAQPage в app/page.tsx)
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Розмітка FAQPage — для товарів, у яких є FAQ через SEO-оверрайд
// (data/seo-overrides.ts, components/ProductDetailContent.tsx). Той
// самий принцип, що й для FaqStructuredData на Головній (app/page.tsx):
// items мають ТОЧНО збігатися з видимим текстом на сторінці, інакше
// Google може проігнорувати розмітку
export function buildFaqJsonLd(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

// Назви товарів приходять з прайс-листів постачальників — це НЕ
// довірений вхід (будь-який поставщик міг вписати туди що завгодно).
// Екрануємо "<" перед вставкою в <script>, інакше назва товару на
// кшталт 'Прокладка</script><script>alert(1)</script>' зламала б
// розмітку сторінки власним XSS через чужий прайс-лист
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
