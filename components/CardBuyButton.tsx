'use client';

// ============================================================
// Кнопка "Купити" в карточке товара в списках: категории, марки авто,
// ТО марки, хабы моделей, результаты поиска на Головной.
//
// Поведение:
//   - нажатие добавляет 1 шт. в корзину и НЕ уводит со страницы;
//   - 2 секунды кнопка зелёная "✓ Додано", счётчик в шапке обновляется
//     (событие CART_UPDATED_EVENT из lib/cart.ts);
//   - товар уже в корзине — "У кошику ✓", нажатие открывает корзину;
//   - нет в наличии — кнопки нет, серый текст "Під замовлення";
//   - карточка вокруг — ссылка на товар, поэтому у кнопки
//     preventDefault + stopPropagation: клик по кнопке не открывает товар.
// Аналитика — то же add_to_cart, что со страницы товара, плюс
// item_list_name = listName (название категории/страницы).
//
// Два режима:
//   - обычный (страницы категорий, марок, хабов) — корзина в localStorage
//     через lib/cart.ts, как у кнопки на странице товара;
//   - "управляемый" (Головная): у Головной корзина в своём React-состоянии,
//     поэтому она передаёт inCart / onAdd / onOpenCart, а кнопка только
//     рисует состояния — иначе состояние Головной и localStorage разошлись бы.
// compact — только иконка (узкие строки таблицы результатов поиска и
// карточки в 4 колонки). На мобильном списки идут в одну колонку, и
// "Купити" с иконкой помещается рядом с ценой. Высота и ширина кнопки —
// не меньше 44 px (удобно попасть пальцем)
// ============================================================

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShoppingCart } from 'lucide-react';
import { addToCart, CART_STORAGE_KEY, CART_UPDATED_EVENT, isInCart, openCart, type CartProductInput } from '@/lib/cart';
import { trackAddToCart } from '@/lib/analytics';

const JUST_ADDED_MS = 2000;

// Цвета — как у активной кнопки сортировки "За популярністю"
const BUY_BG = '#60A5FA';
const BUY_TEXT = '#0B0F17';
const ADDED_BG = '#34D399';
const IN_CART_BORDER = 'rgba(52,211,153,0.55)';
const IN_CART_TEXT = '#34D399';
const MUTED = '#94A3B8';

interface CardBuyButtonProps {
  product: CartProductInput;
  // Название списка для GA4 (item_list_name), например "Масляні фільтри"
  listName: string;
  compact?: boolean;
  // Дополнительные классы (например, w-full для кнопки на всю ширину карточки)
  className?: string;
  // Управляемый режим (Головная) — см. комментарий вверху
  inCart?: boolean;
  onAdd?: () => void;
  onOpenCart?: () => void;
}

export default function CardBuyButton({ product, listName, compact = false, className = '', inCart, onAdd, onOpenCart }: CardBuyButtonProps) {
  const router = useRouter();
  const controlled = onAdd !== undefined;
  const [storedInCart, setStoredInCart] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  // Обычный режим: есть ли товар в корзине — читаем localStorage при
  // появлении и при каждом изменении корзины (в т.ч. в другой вкладке)
  useEffect(() => {
    if (controlled) return;
    const sync = () => setStoredInCart(isInCart(product.id));
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === CART_STORAGE_KEY) sync();
    };
    window.addEventListener(CART_UPDATED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, [controlled, product.id]);

  useEffect(() => {
    if (!justAdded) return;
    const timer = window.setTimeout(() => setJustAdded(false), JUST_ADDED_MS);
    return () => window.clearTimeout(timer);
  }, [justAdded]);

  if (product.stock <= 0) {
    // В компактных строках (таблица поиска) "Під замовлення" уже написано
    // в соседней колонке — оставляем пустое место той же ширины, чтобы
    // колонки не "прыгали"
    if (compact) return <span className="inline-block min-w-[44px] shrink-0" aria-hidden="true" />;
    return (
      <span className="shrink-0 whitespace-nowrap text-xs" style={{ color: MUTED }}>
        Під замовлення
      </span>
    );
  }

  const alreadyInCart = controlled ? Boolean(inCart) : storedInCart;
  const label = `${product.brand ? `${product.brand} ` : ''}${product.article}`;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Карточка вокруг — ссылка на товар: не даём клику до неё дойти
    event.preventDefault();
    event.stopPropagation();

    if (alreadyInCart && !justAdded) {
      if (onOpenCart) onOpenCart();
      else openCart((href) => router.push(href), () => router.back());
      return;
    }

    if (controlled) {
      onAdd?.();
    } else {
      if (!addToCart(product)) return;
      setStoredInCart(true);
    }

    trackAddToCart(
      { id: product.id, name: product.name || product.article, brand: product.brand, price: product.retailPrice },
      listName
    );
    setJustAdded(true);
  };

  const state: 'added' | 'in_cart' | 'buy' = justAdded ? 'added' : alreadyInCart ? 'in_cart' : 'buy';
  const text = state === 'added' ? '✓ Додано' : state === 'in_cart' ? 'У кошику ✓' : 'Купити';
  const style =
    state === 'added'
      ? { background: ADDED_BG, color: BUY_TEXT }
      : state === 'in_cart'
        ? { background: 'transparent', color: IN_CART_TEXT, border: `1px solid ${IN_CART_BORDER}` }
        : { background: BUY_BG, color: BUY_TEXT };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={state === 'in_cart' ? `${label} у кошику — відкрити кошик` : `Додати ${label} в кошик`}
      title={state === 'in_cart' ? 'Відкрити кошик' : 'Додати в кошик'}
      className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110 ${
        compact ? 'px-2.5' : 'px-3'
      } ${className}`}
      style={style}
    >
      {state === 'buy' ? (
        <ShoppingCart className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Check className="h-4 w-4" aria-hidden="true" />
      )}
      {/* Галочку рисует иконка, поэтому в тексте её не дублируем.
          compact — только иконка (узкие карточки/строки) */}
      {!compact && <span className="whitespace-nowrap">{text.replace(/^✓ | ✓$/g, '')}</span>}
    </button>
  );
}
