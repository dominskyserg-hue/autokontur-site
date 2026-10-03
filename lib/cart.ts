// ============================================================
// Корзина покупателя в браузере — общая логика для всех кнопок
// "в кошик" вне Головной: страница товара (components/AddToCartButton.tsx)
// и кнопка "Купити" в карточках списков (components/CardBuyButton.tsx).
//
// Корзина живёт в localStorage (CART_STORAGE_KEY) — тот же ключ, что
// у Головной (components/StorefrontHome.tsx) и у счётчика в шапке
// (components/SiteHeaderFull.tsx). После каждого изменения шлём событие
// CART_UPDATED_EVENT — шапка и кнопки в карточках сразу обновляются.
//
// Только для браузера ('use client'-компоненты): на сервере localStorage нет
// ============================================================

export const CART_STORAGE_KEY = 'autokontur-cart';
export const CART_UPDATED_EVENT = 'autokontur:cart-updated';
// Открыть панель корзины на Головной, если она уже смонтирована под
// модальным окном товара (см. обработчик в components/StorefrontHome.tsx)
export const OPEN_CART_EVENT = 'autokontur:open-cart';

export interface CartItem {
  id: string;
  article: string;
  brand: string | null;
  name: string;
  price: number;
  quantity: number;
  stock: number;
}

export interface CartProductInput {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
}

// Больше этого количества одной позиции через сайт не заказать —
// защита от случайного "999" (крупный опт менеджер оформит сам)
export const MAX_CART_QUANTITY = 99;

// Сколько штук покупатель может выбрать: если товар есть у поставщика —
// не больше его остатка; если "під замовлення" (остаток 0) — до
// MAX_CART_QUANTITY, количество уточнит менеджер
export function maxQuantityFor(stock: number): number {
  return stock > 0 ? Math.min(stock, MAX_CART_QUANTITY) : MAX_CART_QUANTITY;
}

export function readCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    // Повреждённые данные или localStorage недоступен — пустая корзина
    return [];
  }
}

export function isInCart(productId: string): boolean {
  return readCart().some((item) => item.id === productId);
}

// quantity шт. товара в корзину (по умолчанию 1; если товар уже есть —
// увеличиваем количество). Итог не больше maxQuantityFor(остаток).
// true — записали, false — localStorage недоступен
export function addToCart(product: CartProductInput, quantity = 1): boolean {
  try {
    const cart = readCart();
    const existing = cart.find((item) => item.id === product.id);
    const limit = maxQuantityFor(product.stock);
    const nextCart: CartItem[] = existing
      ? cart.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(limit, item.quantity + quantity) } : item
        )
      : [
          ...cart,
          {
            id: product.id,
            article: product.article,
            brand: product.brand,
            name: product.name || product.article,
            price: product.retailPrice,
            quantity: Math.min(limit, Math.max(1, quantity)),
            stock: product.stock,
          },
        ];
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
    return true;
  } catch {
    return false;
  }
}

// Открыть корзину. Сама панель корзины есть только на Головной, поэтому:
//   - если Головная уже на экране (товар открыт модальным окном поверх
//     неё) — открываем событием, без перехода;
//   - иначе — переход на "/?cart=1" (Головная откроет корзину сама).
// push — router.push из next/navigation; back — router.back
export function openCart(push: (href: string) => void, back: () => void): void {
  const isHomeMountedUnderneath = window.__storefrontHomeMounted === true;
  const isInModal = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

  window.dispatchEvent(new Event(OPEN_CART_EVENT));

  if (isInModal) back();

  if (!isHomeMountedUnderneath) {
    if (isInModal) {
      window.setTimeout(() => push('/?cart=1'), 60);
    } else {
      push('/?cart=1');
    }
  }
}
