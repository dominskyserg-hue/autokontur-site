'use client';

// ============================================================
// Крошечный клиентский компонент, который ничего не рисует на
// странице — только отправляет аналитическое событие "просмотр
// товара" (view_item в Google Analytics 4, ViewContent в Meta Pixel).
//
// Зачем отдельный компонент: страница товара
// (components/ProductDetailContent.tsx) — серверный компонент, а
// gtag()/fbq() могут выполняться только в браузере. Поэтому данные о
// товаре передаются сюда как обычные props с сервера, а сам вызов
// trackViewItem() происходит уже в браузере, в useEffect — один раз,
// когда покупатель открыл страницу.
// ============================================================

import { useEffect } from 'react';
import { trackViewItem } from '@/lib/analytics';

interface ProductViewTrackerProps {
  id: string;
  name: string;
  brand: string | null;
  price: number;
}

export default function ProductViewTracker({ id, name, brand, price }: ProductViewTrackerProps) {
  useEffect(() => {
    trackViewItem({ id, name, brand, price });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return null;
}
