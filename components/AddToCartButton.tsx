'use client';

// ============================================================
// Кнопка "Додати в кошик" для окремої сторінки товару
// (app/p/[id]/[[...slug]]/page.tsx — Server Component, тому кошик,
// що живе в localStorage, винесено в цей маленький клієнтський
// компонент).
//
// Логика корзины (localStorage, событие обновления шапки, открытие
// корзины) — общая с кнопкой "Купити" в карточках списков, в lib/cart.ts
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trackAddToCart } from '@/lib/analytics';
import { addToCart, openCart } from '@/lib/cart';

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
  const router = useRouter();

  const handleAdd = () => {
    if (!addToCart(product)) return;

    trackAddToCart({
      id: product.id,
      name: product.name || product.article,
      brand: product.brand,
      price: product.retailPrice,
    });

    setAdded(true);
  };

  const goToCart = () => {
    openCart((href) => router.push(href), () => router.back());
  };

  if (added) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span style={{ color: '#34D399' }}>✓ Додано в кошик</span>
        <button
          type="button"
          onClick={goToCart}
          className="font-semibold underline"
          style={{ color: '#60A5FA', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          Перейти в кошик →
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      className="rounded-xl px-6 py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg"
      style={{ background: 'linear-gradient(90deg, #3B82F6, #1D4ED8)', color: '#FFFFFF', boxShadow: '0 0 0 1px rgba(59,130,246,0.4), 0 0 24px 2px rgba(59,130,246,0.35)' }}
    >
      Додати в кошик
    </button>
  );
}
