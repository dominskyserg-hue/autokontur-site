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
      <body>{children}</body>
    </html>
  );
}
