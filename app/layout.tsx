import type { Metadata } from 'next';
import { Pool } from 'pg';
import './globals.css';

// Библиотека pg использует Node.js API, поэтому layout должен
// рендериться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// Назва магазину раніше була "зашита" тут текстом ("AUTOKONTUR") —
// а фактична назва, яку бачить покупець (зараз "DominatorParts"),
// зберігається в site_settings.shop_name і підставлялась ТІЛЬКИ на
// клієнті через document.title (див. components/StorefrontHome.tsx).
// Через це Google, соцмережі та будь-хто без виконання JS бачили в
// заголовку сторінки застарілу назву. generateMetadata() читає той
// самий рядок з бази, що й сам магазин, — тому назва в <title> завжди
// збігається з тим, що показано на сторінці, і сама оновиться, якщо
// адмін ще раз перейменує магазин через /admin/settings
const FALLBACK_SHOP_NAME = 'DominatorParts';

export async function generateMetadata(): Promise<Metadata> {
  let shopName = FALLBACK_SHOP_NAME;

  try {
    const result = await pool.query('SELECT shop_name FROM site_settings WHERE id = 1');
    if (result.rows[0]?.shop_name) {
      shopName = result.rows[0].shop_name;
    }
  } catch (error) {
    // Base недоступна під час білда/деплою — не валимо весь сайт
    // через це, просто показуємо запасну назву
    console.error('Не вдалося отримати назву магазину для metadata:', error);
  }

  return {
    title: `${shopName} — автозапчастини з доставкою по Україні`,
    description: 'Пошук запчастин за артикулом, швидка доставка, оригінальні деталі.',
  };
}

// lang="uk" — основной язык сайта теперь украинский (клиентская
// витрина для покупателей). Админ-панель под /admin осталась на
// русском — это внутренний инструмент, её это не касается
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      {/* Шрифти фірмового стилю "Wasteland" вітрини (Bebas Neue/Rajdhani/Barlow) —
          підключені глобально, але реально використовуються лише в
          components/StorefrontHome.tsx; на адмін-панель (/admin) не впливають,
          бо там ці font-family ніде не задаються */}
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
