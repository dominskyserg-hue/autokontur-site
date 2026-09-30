'use client';

// ============================================================
// Раскрывающийся блок "Інші пропозиції на цю деталь" на странице товара
// (components/ProductDetailContent.tsx).
//
// Свёрнутым показывает одну строку ("Пропозицій: 3 · від 259 грн"), по
// нажатию выпадает таблица всех предложений: склад, деталь, артикул,
// срок доставки, количество, цена и кнопки "У кошик" / "1 клік".
//
// Сам компонент только открывает/закрывает блок — содержимое (summary —
// то, что видно всегда, children — то, что внутри) собирает серверный
// ProductDetailContent, поэтому здесь нет никаких данных о товаре
// ============================================================

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface OfferAccordionProps {
  // Строка, видимая всегда: "Пропозиція 2", наличие, цена
  summary: ReactNode;
  // Раскрывающаяся часть: подробности и кнопки заказа
  children: ReactNode;
  background: string;
  border: string;
  color: string;
  fontFamily: string;
}

export default function OfferAccordion({ summary, children, background, border, color, fontFamily }: OfferAccordionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl text-sm" style={{ fontFamily, background, border: `1px solid ${border}`, color }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        // aria-expanded — чтобы экранные дикторы понимали, открыт ли блок
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl p-3.5 text-left transition-colors hover:bg-[rgba(59,130,246,0.07)]"
      >
        {summary}
        <ChevronDown
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none', opacity: 0.7 }}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1" style={{ borderTop: `1px solid ${border}` }}>
          {children}
        </div>
      )}
    </div>
  );
}
