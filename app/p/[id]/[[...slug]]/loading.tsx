// ============================================================
// Той самий сенс, що й app/@modal/(.)p/[id]/[[...slug]]/loading.tsx —
// поки ProductPage чекає на дані з бази, показуємо короткий спінер
// замість порожнього білого екрана
// ============================================================

import { BG, PAPER, BODY_FONT } from '@/components/ProductDetailContent';

export default function ProductPageLoading() {
  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8">
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div
            className="w-10 h-10 rounded-full animate-spin"
            style={{ border: '3px solid #EAEDF2', borderTopColor: '#1D5FD6' }}
            aria-hidden="true"
          />
          <p className="text-sm" style={{ color: '#5C6678' }}>
            Завантаження товару...
          </p>
        </div>
      </div>
    </div>
  );
}
