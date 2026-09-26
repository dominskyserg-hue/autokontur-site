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

// +1 шт. товара в корзину (если уже есть — увеличиваем количество).
// true — записали, false — localStorage недоступен
export function addToCart(product: CartProductInput): boolean {
  try {
    const cart = readCart();
    const existing = cart.find((item) => item.id === product.id);
    const nextCart: CartItem[] = existing
      ? cart.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
      : [
          ...cart,
          {
            id: product.id,
            article: product.article,
            brand: product.brand,
            name: product.name || product.article,
            price: product.retailPrice,
            quantity: 1,
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
