'use client';

// Захоплює атрибуцію першого візиту (UTM-мітки, gclid, зовнішній
// referrer) — уся логіка в lib/attribution.ts, цей компонент лише
// один раз викликає її одразу після монтаження. Підключений
// глобально в app/layout.tsx (поруч з VinRequestButton), тому
// відпрацьовує на КОЖНІЙ сторінці сайту, а не тільки на Головній —
// покупець може вперше потрапити на сайт одразу на сторінку
// конкретного товару чи категорії, а не обов'язково на Головну
import { useEffect } from 'react';
import { captureAttributionOnce } from '@/lib/attribution';

export default function AttributionCapture() {
  useEffect(() => {
    captureAttributionOnce();
  }, []);

  // Нічого не рендерить — уся робота відбувається всередині useEffect
  return null;
}
