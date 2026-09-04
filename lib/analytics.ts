// ============================================================
// Обёртки для событий электронной торговли Google Analytics 4 (gtag)
// и Meta Pixel (fbq).
//
// Зачем этот файл нужен: сами счётчики (скрипты gtag.js и fbq) один
// раз подключены в app/layout.tsx — они всегда есть на каждой
// странице сайта. А вот СОБЫТИЯ ("покупатель посмотрел товар",
// "покупатель добавил товар в корзину" и т.д.) нужно отправлять из
// разных мест в коде (карточка товара, корзина, форма заказа). Чтобы
// не дублировать в каждом таком месте одинаковый код вызова и gtag,
// и fbq (у них разный формат данных), здесь описаны функции-обёртки:
// вызывающий код один раз передаёт данные о товаре/заказе, а функция
// сама отправляет их обоими способами — в Google Analytics и в Meta
// Pixel одновременно.
//
// Если у покупателя стоит блокировщик рекламы (AdBlock и т.п.) —
// скрипты gtag/fbq могут не загрузиться вообще. Поэтому перед каждым
// вызовом проверяем "а функция вообще существует?" (typeof === 'function')
// — без этой проверки сайт выдавал бы ошибку в консоли браузера и мог
// бы сломать всю страницу целиком.
// ============================================================

// Расширяем стандартный тип Window — TypeScript по умолчанию не знает
// про window.gtag и window.fbq, потому что они создаются НЕ нашим кодом,
// а внешними скриптами Google/Meta (см. app/layout.tsx)
declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

// Местная валюта магазина — все суммы в событиях передаются в гривнах
const CURRENCY = 'UAH';

// Один товар в терминах событий электронной торговли — то общее, что
// нужно и для gtag, и для fbq. quantity по умолчанию 1 (для просмотра
// товара количество не имеет смысла, для корзины — передаём явно)
export interface AnalyticsItem {
  id: string;
  name: string;
  brand?: string | null;
  price: number;
  quantity?: number;
}

// ------------------------------------------------------------
// 1. ПРОСМОТР ТОВАРА — вызывается на странице конкретного товара
//    (view_item в GA4, ViewContent в Meta Pixel)
// ------------------------------------------------------------
export function trackViewItem(item: AnalyticsItem): void {
  if (typeof window === 'undefined') return;

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'view_item', {
      currency: CURRENCY,
      value: item.price,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          item_brand: item.brand || undefined,
          price: item.price,
          quantity: 1,
        },
      ],
    });
  }

  if (typeof window.fbq === 'function') {
    window.fbq('track', 'ViewContent', {
      content_ids: [item.id],
      content_name: item.name,
      content_type: 'product',
      value: item.price,
      currency: CURRENCY,
    });
  }
}

// ------------------------------------------------------------
// 2. ДОБАВЛЕНИЕ В КОРЗИНУ — вызывается в момент клика на кнопку
//    "Додати в кошик" (add_to_cart в GA4, AddToCart в Meta Pixel)
// ------------------------------------------------------------
export function trackAddToCart(item: AnalyticsItem): void {
  if (typeof window === 'undefined') return;

  const quantity = item.quantity ?? 1;
  const value = item.price * quantity;

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'add_to_cart', {
      currency: CURRENCY,
      value,
      items: [
        {
          item_id: item.id,
          item_name: item.name,
          item_brand: item.brand || undefined,
          price: item.price,
          quantity,
        },
      ],
    });
  }

  if (typeof window.fbq === 'function') {
    window.fbq('track', 'AddToCart', {
      content_ids: [item.id],
      content_name: item.name,
      content_type: 'product',
      value,
      currency: CURRENCY,
    });
  }
}

// ------------------------------------------------------------
// 3. НАЧАЛО ОФОРМЛЕНИЯ ЗАКАЗА — вызывается, когда покупатель нажал
//    "Оформити замовлення" в корзине, ПЕРЕД отправкой запроса на
//    сервер (begin_checkout в GA4, InitiateCheckout в Meta Pixel)
// ------------------------------------------------------------
export function trackBeginCheckout(items: AnalyticsItem[]): void {
  if (typeof window === 'undefined') return;

  const value = items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0);

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'begin_checkout', {
      currency: CURRENCY,
      value,
      items: items.map((item) => ({
        item_id: item.id,
        item_name: item.name,
        item_brand: item.brand || undefined,
        price: item.price,
        quantity: item.quantity ?? 1,
      })),
    });
  }

  if (typeof window.fbq === 'function') {
    window.fbq('track', 'InitiateCheckout', {
      content_ids: items.map((item) => item.id),
      content_type: 'product',
      value,
      currency: CURRENCY,
      num_items: items.reduce((sum, item) => sum + (item.quantity ?? 1), 0),
    });
  }
}

// ------------------------------------------------------------
// 4. ОФОРМЛЕННЫЙ ЗАКАЗ — вызывается СРАЗУ ПОСЛЕ того, как сервер
//    подтвердил успешное создание заказа (purchase в GA4, Purchase
//    в Meta Pixel). orderId — id заказа из ответа сервера, он же
//    transaction_id в GA4 — по нему потом можно свериться с базой
// ------------------------------------------------------------
export function trackPurchase(orderId: string, items: AnalyticsItem[]): void {
  if (typeof window === 'undefined') return;

  const value = items.reduce((sum, item) => sum + item.price * (item.quantity ?? 1), 0);

  if (typeof window.gtag === 'function') {
    window.gtag('event', 'purchase', {
      transaction_id: orderId,
      currency: CURRENCY,
      value,
      items: items.map((item) => ({
        item_id: item.id,
        item_name: item.name,
        item_brand: item.brand || undefined,
        price: item.price,
        quantity: item.quantity ?? 1,
      })),
    });
  }

  if (typeof window.fbq === 'function') {
    window.fbq('track', 'Purchase', {
      content_ids: items.map((item) => item.id),
      content_type: 'product',
      value,
      currency: CURRENCY,
    });
  }
}
