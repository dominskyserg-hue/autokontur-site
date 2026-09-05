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

const PANEL = '#1B2436';
const BORDER = 'rgba(255,255,255,0.14)';
const MUTED = '#94A3B8';

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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-3 py-6 md:py-10">
      <div className="fixed inset-0 backdrop-blur-sm" style={{ background: 'rgba(11,15,23,0.78)' }} onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl rounded-2xl"
        style={{ background: PANEL, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${BORDER}`, boxShadow: '0 0 0 1px rgba(59,130,246,0.5), 0 0 44px 6px rgba(59,130,246,0.28)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Закрити"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-lg transition-colors hover:bg-white/5"
          style={{ background: 'rgba(255,255,255,0.05)', color: MUTED, border: `1px solid ${BORDER}` }}
        >
          ✕
        </button>

        <div className="px-5 py-8 md:px-8">{children}</div>
      </div>
    </div>
  );
}
