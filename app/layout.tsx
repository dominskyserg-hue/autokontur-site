import type { Metadata } from 'next';
import './globals.css';

// ВАЖЛИВО: тут навмисно СТАТИЧНІ дані, без звернення до бази.
// Раніше тут була generateMetadata() з pg-запитом до site_settings —
// але layout.tsx рендериться АБСОЛЮТНО на кожен запит до сайту
// (Головна, категорії, марки, admin — все), тому будь-яка проблема
// з підключенням до бази (вичерпаний ліміт з'єднань Supabase,
// таймаут тощо) валила весь сайт цілком, а не одну сторінку — це і
// сталось на проді. Назва магазину як і раніше підставляється
// клієнтським document.title у components/StorefrontHome.tsx (там
// збій одного fetch на одному екрані, а не крах усього сайту)
export const metadata: Metadata = {
  title: 'DominatorParts — автозапчастини з доставкою по Україні',
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
