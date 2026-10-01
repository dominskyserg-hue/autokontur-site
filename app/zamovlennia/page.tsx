// ============================================================
// /zamovlennia — страница "Де моє замовлення?". Покупатель вводит номер
// заказа и телефон и видит статус, состав заказа и где посылка (ТТН).
// Логика формы — components/OrderStatusLookup.tsx, данные —
// POST /api/order-status. Личный кабинет при этом не нужен.
//
// ?n=142 в адресе — номер заказа сразу подставляется в форму (ссылка
// с экрана "Дякуємо за замовлення")
// ============================================================

import type { Metadata } from 'next';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import OrderStatusLookup from '@/components/OrderStatusLookup';
import { TECH_BG, TECH_BODY_FONT, TECH_DISPLAY_FONT, TECH_FAINT, TECH_INK, TECH_MUTED } from '@/lib/techTheme';

export const metadata: Metadata = {
  title: 'Де моє замовлення? Статус замовлення — DominatorParts',
  description: 'Перевірте статус свого замовлення автозапчастин: вкажіть номер замовлення і телефон.',
  // Личная страница — в поиске ей делать нечего
  robots: { index: false, follow: true },
};

export default async function OrderStatusPage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const { n } = await searchParams;
  const initialOrderNumber = (n || '').replace(/\D/g, '').slice(0, 10);

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <SiteHeaderServer />
      <main className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-2 text-3xl font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
          Де моє замовлення?
        </h1>
        <p className="mb-6 text-sm leading-relaxed" style={{ color: TECH_MUTED }}>
          Вкажіть номер замовлення (його ми повідомили після оформлення) і телефон, який ви залишали, — покажемо статус
          і номер ТТН Нової Пошти.
        </p>
        <OrderStatusLookup initialOrderNumber={initialOrderNumber} />
        <p className="mt-8 text-xs" style={{ color: TECH_FAINT }}>
          Не пам&apos;ятаєте номер замовлення? Напишіть нам у Telegram або зателефонуйте — підкажемо.
        </p>
      </main>
    </div>
  );
}
