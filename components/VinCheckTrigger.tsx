'use client';

// ============================================================
// "Перевірити сумісність за VIN" — открывает существующую форму заявки
// (components/VinRequestButton.tsx, она подключена на всех страницах в
// app/layout.tsx) с уже подставленным текстом: какую деталь или модель
// проверить. Две формы: маленькая ссылка (страница товара) и кнопка (блок
// "Можуть підходити" на хабе модели)
// ============================================================

import { ScanSearch } from 'lucide-react';
import { VIN_REQUEST_EVENT } from '@/lib/vinRequestEvent';
import { TECH_ACCENT, TECH_BODY_FONT, TECH_BORDER_2, TECH_INK } from '@/lib/techTheme';

interface Props {
  description: string;
  label: string;
  variant?: 'link' | 'button';
}

export default function VinCheckTrigger({ description, label, variant = 'link' }: Props) {
  const open = () => window.dispatchEvent(new CustomEvent(VIN_REQUEST_EVENT, { detail: { description } }));

  if (variant === 'button') {
    return (
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-white/5"
        style={{ fontFamily: TECH_BODY_FONT, border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
      >
        <ScanSearch className="h-4 w-4" style={{ color: TECH_ACCENT }} />
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="mt-3 inline-flex items-center gap-1.5 text-xs underline-offset-2 hover:underline"
      style={{ fontFamily: TECH_BODY_FONT, color: TECH_ACCENT }}
    >
      <ScanSearch className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
