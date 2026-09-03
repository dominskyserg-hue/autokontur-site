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
}

// Дуже поширений випадок саме в автозапчастинах (особливо стартери й
// генератори) — товар не новий, а відновлений/реставрований. Якщо це
// видно з назви товару (яку заповнює постачальник у прайсі), чесно
// позначаємо itemCondition — інакше Google Merchant може порахувати
// це вводом покупця в оману й понизити довіру до всього фіда
const REFURBISHED_PATTERN = /реставрац|відновлен|восстановлен|б\/у/i;

function productUrl(product: SchemaProduct): string {
  return `${SITE_URL}${buildProductPath(product.id, product)}`;
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
export function productJsonLd(product: SchemaProduct) {
  const displayName =
    product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ') || product.article;

  const url = productUrl(product);

  return {
    '@type': 'Product',
    sku: product.article,
    name: displayName,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
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

// Назви товарів приходять з прайс-листів постачальників — це НЕ
// довірений вхід (будь-який поставщик міг вписати туди що завгодно).
// Екрануємо "<" перед вставкою в <script>, інакше назва товару на
// кшталт 'Прокладка</script><script>alert(1)</script>' зламала б
// розмітку сторінки власним XSS через чужий прайс-лист
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
