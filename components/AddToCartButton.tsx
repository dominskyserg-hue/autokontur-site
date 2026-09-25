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
import { useRouter } from 'next/navigation';
import { trackAddToCart } from '@/lib/analytics';

const CART_STORAGE_KEY = 'autokontur-cart';

// Подія, якою ця кнопка каже вже змонтованій Головній (components/
// StorefrontHome.tsx) відкрити панель кошика НАПРЯМУ, без навігації —
// точна назва події має збігатись в обох файлах
const OPEN_CART_EVENT = 'autokontur:open-cart';

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
  const router = useRouter();

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
      // Лічильник кошика в шапці сторінки товару (components/SiteHeaderFull.tsx,
      // CART_UPDATED_EVENT) — оновлюється одразу, без перезавантаження
      window.dispatchEvent(new Event('autokontur:cart-updated'));

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

  // Ця кнопка рендериться у ТРЬОХ різних місцях, і "перейти в кошик"
  // мусить поводитись по-різному в кожному:
  //   1. Окрема сторінка товару (app/p/[id]/...) — Головної на екрані
  //      взагалі нема, потрібна СПРАВЖНЯ навігація на "/?cart=1"
  //   2. Модальне вікно товару НАД Головною (app/@modal/(.)p/...,
  //      покупець клікнув картку прямо на "/") — Головна вже
  //      змонтована ПІД модальним вікном (той самий React-інстанс,
  //      той самий стан), а просте посилання на "/?cart=1" тут нічого
  //      б не закрило: шлях лишається тим самим "/", міняється лише
  //      query-рядок, а Next.js не перемонтовує паралельний слот
  //      @modal заради самої лише зміни query — модальне вікно
  //      лишалось би висіти поверх уже відкритого кошика (саме це і
  //      трапилось на бойовому сайті: покупець побачив "зависання").
  //      Тут відкриваємо кошик ПОДІЄЮ напряму (Головна вже живе на
  //      сторінці) і просто закриваємо модалку router.back()
  //   3. Модальне вікно товару НАД категорією/маркою — там Головної
  //      взагалі нема на екрані, тому, як і у випадку 1, потрібна
  //      справжня навігація на "/?cart=1"
  const goToCart = () => {
    // window.location.pathname тут НЕ підказка: коли товар відкрито в
    // модалці, Next.js (intercepting routes) міняє адресний рядок на
    // адресу товару ("/p/...") незалежно від того, що насправді під
    // модалкою — перевіряємо тому прапорець, який сама Головна
    // виставляє собі при монтуванні (components/StorefrontHome.tsx)
    const isHomeMountedUnderneath = window.__storefrontHomeMounted === true;
    const isInModal = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;

    // Безпечно диспетчерити завжди: якщо Головна не змонтована,
    // слухача просто немає, і подія нікуди не потрапляє
    window.dispatchEvent(new Event(OPEN_CART_EVENT));

    // Модалку, якщо вона є, ЗАВЖДИ закриваємо саме router.back() —
    // тим самим способом, що й components/ProductModalShell.tsx.
    // Спроба замінити це на router.push('/?cart=1') виявилась
    // ненадійною: коли модалка відкрита НЕ над Головною (над
    // категорією/маркою), програмна навігація на новий шлях іноді не
    // скидає паралельний слот @modal, і модалка лишається висіти
    // поверх нової сторінки — той самий "зависає" ефект, який ми й
    // виправляємо
    if (isInModal) {
      router.back();
    }

    if (!isHomeMountedUnderneath) {
      // Головної на екрані нема (окрема сторінка товару — case 1, або
      // модалка була над категорією/маркою — case 3) — після
      // закриття модалки (якщо вона була) усе одно потрібна справжня
      // навігація на Головну з кошиком. setTimeout — дати
      // router.back() встигнути застосуватись, перш ніж push піде
      // поверх нього
      if (isInModal) {
        window.setTimeout(() => router.push('/?cart=1'), 60);
      } else {
        router.push('/?cart=1');
      }
    }
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
