// Сторінка "Особистий кабінет" покупця — вхід за номером телефону та
// історія його замовлень. Вся логіка — в components/CustomerDashboard.tsx
//
// Пока кабинет выключен (lib/customerCabinet.ts, CUSTOMER_CABINET_ENABLED)
// вместо него показываем понятный текст со ссылкой на Telegram-бота —
// сам CustomerDashboard не рендерим (его API всё равно отвечает 403)
import type { Metadata } from 'next';
import { Send } from 'lucide-react';
import CustomerDashboard from '@/components/CustomerDashboard';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import { CUSTOMER_CABINET_DISABLED_MESSAGE, isCustomerCabinetEnabled } from '@/lib/customerCabinet';
import { TECH_ACCENT, TECH_BG, TECH_BORDER, TECH_BODY_FONT, TECH_DISPLAY_FONT, TECH_INK, TECH_MUTED } from '@/lib/techTheme';

// Флаг читается на сервере при каждом запросе, а не один раз при сборке
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Особистий кабінет — DominatorParts',
  robots: { index: false, follow: false },
};

const TELEGRAM_BOT_USERNAME = 'dominatorparts_orders_bot';

export default function AccountPage() {
  if (isCustomerCabinetEnabled()) {
    return <CustomerDashboard />;
  }

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <SiteHeaderServer />
      <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
        <h1 className="mb-3 text-2xl font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
          Особистий кабінет
        </h1>
        <p className="mb-6 text-sm" style={{ color: TECH_MUTED }}>
          {CUSTOMER_CABINET_DISABLED_MESSAGE}
        </p>
        <a
          href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=link`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
          style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_ACCENT }}
        >
          <Send className="h-4 w-4" />
          Відкрити Telegram-бот
        </a>
      </main>
    </div>
  );
}
