import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AUTOKONTUR — автозапчастини з доставкою по Україні',
  description: 'Пошук запчастин за артикулом, швидка доставка, оригінальні деталі.',
};

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
