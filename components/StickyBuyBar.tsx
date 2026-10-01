'use client';

// ============================================================
// Липкая полоса "Купити" внизу экрана на ТЕЛЕФОНЕ (страница товара).
//
// Большинство покупателей приходят из Google с телефона: пока они
// листают характеристики, аналоги и отзывы, кнопки покупки уезжают
// далеко вверх. Эта полоса появляется, как только основной блок покупки
// (components/ProductBuyBox.tsx, помечен data-buy-box) ушёл с экрана, и
// показывает цену, выбор количества, "У кошик" и "1 клік". На компьютере
// (md и шире) не показывается.
//
// position: sticky (а не fixed) — так полоса работает одинаково и на
// обычной странице товара, и внутри всплывающего окна товара
// (components/ProductModalShell.tsx), где прокручивается само окно
// ============================================================

import { useEffect, useRef, useState } from 'react';
import ProductBuyBox from '@/components/ProductBuyBox';

interface StickyBuyBarProps {
  product: {
    id: string;
    article: string;
    brand: string | null;
    name: string | null;
    retailPrice: number;
    stock: number;
  };
}

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

export default function StickyBuyBar({ product }: StickyBuyBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // Видна ли полоса: только когда основной блок покупки ушёл с экрана
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Ищем основной блок покупки в ЭТОЙ ЖЕ карточке товара (а не первый
    // на странице: под окном товара может быть открыта другая карточка)
    const root = barRef.current?.closest('[data-product-root]');
    const buyBox = root?.querySelector('[data-buy-box]');
    if (!buyBox) return;

    const observer = new IntersectionObserver(([entry]) => {
      // Показываем, только если блок ушёл ВВЕРХ (покупатель листает ниже)
      setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(buyBox);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={barRef}
      className="sticky bottom-0 z-30 -mx-4 mt-6 px-3 py-2.5 transition-opacity md:hidden"
      style={{
        background: 'rgba(11,15,23,0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        // Пока полоса не нужна — она прозрачная и не ловит нажатия
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
      aria-hidden={!visible}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-base font-semibold" style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(product.retailPrice)} <span className="text-xs font-normal" style={{ color: '#94A3B8' }}>грн</span>
        </span>
        <ProductBuyBox compact product={product} />
      </div>
    </div>
  );
}
