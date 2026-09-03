'use client';

// ============================================================
// "Рамка" модального вікна товару — сам товар (ProductDetailContent)
// передається сюди як children. Використовується лише з
// app/@modal/(...)p/[id]/[[...slug]]/page.tsx (перехоплений маршрут) —
// на звичайній сторінці товару (app/p/[id]/[[...slug]]/page.tsx) цей
// компонент не рендериться, там просто фон на весь екран.
//
// router.back() (а не router.push('/')) — щоб закриття вікна
// повертало покупця саме туди, звідки він відкрив товар (каталог зі
// збереженими фільтрами/прокруткою), а не скидало його на початок
// ============================================================

import { useRouter } from 'next/navigation';
import { useEffect, useCallback } from 'react';

const PANEL = '#FFFFFF';
const BORDER = '#DDE2EA';
const MUTED = '#5C6678';

export default function ProductModalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = useCallback(() => router.back(), [router]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);

    // Забороняємо прокрутку каталогу під модальним вікном, поки воно
    // відкрите — інакше на мобільних можна випадково прокрутити фон
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-6 px-3 md:py-10">
      <div className="fixed inset-0" style={{ background: 'rgba(21, 16, 14, 0.72)' }} onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl rounded-md shadow-2xl"
        style={{ background: PANEL, border: `1px solid ${BORDER}` }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Закрити"
          className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full text-lg z-10"
          style={{ background: '#F5F6F9', color: MUTED, border: `1px solid ${BORDER}` }}
        >
          ✕
        </button>

        <div className="px-5 md:px-8 py-8">{children}</div>
      </div>
    </div>
  );
}
