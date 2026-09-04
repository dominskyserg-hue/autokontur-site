'use client';

// ============================================================
// Кнопка "Додати в кошик" для окремої сторінки товару
// (app/p/[id]/[[...slug]]/page.tsx — Server Component, тому кошик,
// що живе в localStorage, винесено в цей маленький клієнтський
// компонент).
//
// ВАЖЛИВО: ключ localStorage і форма запису товару в кошику — ТОЧНО
// ті самі, що й у components/StorefrontHome.tsx (CART_STORAGE_KEY,
// addToCart()). Це навмисно: покупець, що додав товар звідси, а потім
// перейшов на Головну, повинен побачити той самий кошик, а не два
// різних. Дублювання цих кількох рядків тут дешевше, ніж тягнути сюди
// весь StorefrontHome заради однієї функції.
// ============================================================

import { useState } from 'react';
import Link from 'next/link';
import { trackAddToCart } from '@/lib/analytics';

const CART_STORAGE_KEY = 'autokontur-cart';

interface CartItem {
  id: string;
  article: string;
  brand: string | null;
  name: string;
  price: number;
  quantity: number;
  stock: number;
}

interface AddToCartButtonProps {
  product: {
    id: string;
    article: string;
    brand: string | null;
    name: string | null;
    retailPrice: number;
    stock: number;
  };
}

export default function AddToCartButton({ product }: AddToCartButtonProps) {
  const [added, setAdded] = useState(false);

  const handleAdd = () => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const cart: CartItem[] = raw ? JSON.parse(raw) : [];

      const existing = cart.find((item) => item.id === product.id);
      const nextCart = existing
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

      // Аналитика (Google Analytics 4 + Meta Pixel) — событие
      // "добавление в корзину", см. lib/analytics.ts
      trackAddToCart({
        id: product.id,
        name: product.name || product.article,
        brand: product.brand,
        price: product.retailPrice,
      });

      setAdded(true);
    } catch {
      // localStorage недоступний (приватний режим тощо) — не критично,
      // просто кнопка не покаже підтвердження
    }
  };

  if (added) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span style={{ color: '#15803D' }}>✓ Додано в кошик</span>
        <Link href="/" className="underline font-semibold" style={{ color: '#1D5FD6' }}>
          Перейти в кошик →
        </Link>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="px-6 py-3 text-sm font-bold uppercase tracking-wide rounded-md"
      style={{ background: '#1D5FD6', color: '#FFFFFF' }}
    >
      Додати в кошик
    </button>
  );
}
