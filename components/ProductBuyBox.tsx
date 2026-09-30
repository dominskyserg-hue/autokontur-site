'use client';

// ============================================================
// Блок покупки на карточке товара: выбор количества + "Додати в кошик"
// + "Купити в 1 клік". Используется в components/ProductDetailContent.tsx
// — и для основного товара, и в каждой строке таблицы "Інші пропозиції"
// (compact — маленький вариант для таблицы).
//
// Количество нельзя выбрать больше, чем есть у поставщика (остаток
// products.stock). Если товар "під замовлення" (остаток 0) — до 99 шт,
// точное количество уточнит менеджер. Правило одно для всего сайта:
// maxQuantityFor в lib/cart.ts (так же ограничена и корзина).
// ============================================================

import { useState } from 'react';
import type { ReactNode } from 'react';
import AddToCartButton from '@/components/AddToCartButton';
import QuickOrderModal from '@/components/QuickOrderModal';
import { maxQuantityFor } from '@/lib/cart';

interface ProductBuyBoxProps {
  product: {
    id: string;
    article: string;
    brand: string | null;
    name: string | null;
    retailPrice: number;
    stock: number;
  };
  // Маленький вариант для строки таблицы пропозицій
  compact?: boolean;
  // Дополнительные кнопки рядом (например, "Обране" на основном товаре)
  children?: ReactNode;
}

export default function ProductBuyBox({ product, compact = false, children }: ProductBuyBoxProps) {
  const [quantity, setQuantity] = useState(1);
  const maxQuantity = maxQuantityFor(product.stock);

  // Кнопки "−" / "+" и ручной ввод — всегда в пределах 1..maxQuantity
  const changeQuantity = (next: number) => {
    if (!Number.isFinite(next)) return;
    setQuantity(Math.min(maxQuantity, Math.max(1, Math.round(next))));
  };

  const buttonSize = compact ? 'h-7 w-7 text-sm rounded-md' : 'h-11 w-10 text-lg rounded-xl';
  const inputSize = compact ? 'h-7 w-10 text-xs rounded-md' : 'h-11 w-14 text-sm rounded-xl';

  const stepper = (
    <div className="flex items-center gap-1" title={product.stock > 0 ? `В наявності: ${product.stock} шт` : 'Під замовлення'}>
      <button
        type="button"
        onClick={() => changeQuantity(quantity - 1)}
        disabled={quantity <= 1}
        aria-label="Зменшити кількість"
        className={`flex items-center justify-center font-semibold disabled:opacity-30 ${buttonSize}`}
        style={{ background: 'rgba(255,255,255,0.06)', color: '#F1F5F9' }}
      >
        −
      </button>
      <input
        type="number"
        min={1}
        max={maxQuantity}
        inputMode="numeric"
        aria-label="Кількість"
        value={quantity}
        onChange={(e) => changeQuantity(parseInt(e.target.value, 10))}
        className={`text-center outline-none ${inputSize}`}
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)', color: '#F1F5F9' }}
      />
      <button
        type="button"
        onClick={() => changeQuantity(quantity + 1)}
        disabled={quantity >= maxQuantity}
        aria-label="Збільшити кількість"
        className={`flex items-center justify-center font-semibold disabled:opacity-30 ${buttonSize}`}
        style={{ background: 'rgba(255,255,255,0.06)', color: '#F1F5F9' }}
      >
        +
      </button>
    </div>
  );

  return (
    <div className={compact ? 'flex flex-nowrap items-center justify-end gap-2' : 'flex flex-col gap-2'}>
      <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-3'}>
        {stepper}
        <AddToCartButton compact={compact} product={product} quantity={quantity} />
        {children}
        <QuickOrderModal compact={compact} product={product} initialQuantity={quantity} />
      </div>
      {/* Подсказка про остаток — только в большом варианте */}
      {!compact && product.stock > 0 && quantity >= maxQuantity && (
        <p className="text-xs" style={{ color: '#94A3B8' }}>
          Це весь наявний залишок ({product.stock} шт)
        </p>
      )}
    </div>
  );
}
