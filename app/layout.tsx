import type { Metadata } from 'next';
import Script from 'next/script';
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Друга пара шрифтів — ТІЛЬКИ для нового розділу "Tech Premium"
// (наразі шапка + hero на Головній, components/StorefrontHome.tsx).
// Не чіпає й не замінює основні шрифти вітрини (Bebas Neue/Rajdhani/
// Barlow, підключені нижче через <link> — ними й далі користуються
// решта сторінок і компонентів). next/font сам вшиває файл шрифту в
// білд і віддає його з того ж домену — без запиту до fonts.gstatic.com
// у покупця, і без "блимання" шрифту при завантаженні (FOUT)
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

const interTech = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter-tech',
  display: 'swap',
});

// Моноширинний шрифт — ТІЛЬКИ для артикулів/OEM-кодів у блоці
// результатів пошуку (Tech Premium). У каталозі запчастин код має
// значення символ-у-символ, тож моноширинний накреслення читається
// й копіюється надійніше за звичайний текстовий шрифт
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

// ID лічильника GA4 (напр. "G-XXXXXXXXXX") — Google Analytics →
// Адмін → Потоки даних → ваш потік → Ідентифікатор потоку. Токен
// підтвердження Google Search Console — Search Console → Налаштування
// → Верифікація власності → метод "HTML-тег" → скопіювати ЛИШЕ
// значення content="..." (без усього тега). Обидва задаються як
// звичайні змінні середовища у Vercel (Project Settings → Environment
// Variables) — префікс NEXT_PUBLIC_ обов'язковий, інакше значення не
// потрапить у код, що виконується в браузері (без нього не запрацює
// саме відстеження GA4, хоча код і не впаде з помилкою)
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const GSC_VERIFICATION = process.env.NEXT_PUBLIC_GSC_VERIFICATION;

// ID пикселя Meta (Facebook) — business.facebook.com → Events Manager →
// выбрать пиксель → Настройки → "ID пикселя" (число вида 1234567890123456).
// Тот же принцип, что и с GA_MEASUREMENT_ID выше: значение задаётся через
// переменную окружения NEXT_PUBLIC_META_PIXEL_ID (см. пояснение в конце
// файла), а не прямо в коде — так его можно менять без правки кода
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

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
  // verification.google рендерить <meta name="google-site-verification"
  // content="..." /> — офіційний, задокументований спосіб Next.js
  // (краще за ручний <meta> в <head>, бо Next сам стежить, щоб тег не
  // задублювався, якщо його ще десь підключити). Якщо змінна не задана
  // (локальна розробка, чи поки не встигли підключити GSC) — Next
  // просто не рендерить тег, помилки не буде
  verification: GSC_VERIFICATION ? { google: GSC_VERIFICATION } : undefined,
};

// lang="uk" — основной язык сайта теперь украинский (клиентская
// витрина для покупателей). Админ-панель под /admin осталась на
// русском — это внутренний инструмент, её это не касается
export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  // Паралельний слот app/@modal — модальне вікно картки товару
  // (app/@modal/(...)p/[id]/[[...slug]]/page.tsx), яке відкривається
  // поверх поточної сторінки при кліку по товару в каталозі. На
  // сторінках, де такого перехопленого маршруту немає (майже всюди),
  // сюди підставляється app/@modal/default.tsx, який рендерить null
  modal: React.ReactNode;
}>) {
  return (
    <html lang="uk" className={`${spaceGrotesk.variable} ${interTech.variable} ${jetbrainsMono.variable}`}>
      {/* Шрифти фірмового стилю "Wasteland" вітрини (Bebas Neue/Rajdhani/Barlow) —
          підключені глобально, але реально використовуються лише в
          components/StorefrontHome.tsx; на адмін-панель (/admin) не впливають,
          бо там ці font-family ніде не задаються */}
      <head>
        {/* ==================== ФАВІКОНКА ====================
            Файли лежать у /public (тому шляхи нижче — від кореня
            сайту, без /public у самому шляху) — див. коментар з
            повним списком файлів і їх призначенням в кінці цього
            файлу */}
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
        <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />

        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* ==================== META (FACEBOOK) PIXEL — <noscript>-ФОЛБЭК ====================
            Обязательная часть стандартного кода Meta Pixel: если у
            покупателя отключён JavaScript в браузере, обычный fbq()
            ниже вообще не выполнится — эта картинка <img> с тем же
            pixel_id выполняет роль "счётчика" вместо него. Она должна
            стоять СРАЗУ ПОСЛЕ открывающего тега <body> — это требование
            самой Meta. Рендерится, только если задана переменная
            окружения NEXT_PUBLIC_META_PIXEL_ID (см. пояснение в конце
            файла) */}
        {META_PIXEL_ID && (
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: 'none' }}
              src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        )}

        {children}
        {modal}

        {/* ==================== META (FACEBOOK) PIXEL — базовый код ====================
            Стандартный код инициализации fbq() — ровно такой же, какой
            выдаёт сам Facebook Events Manager, только перенесённый в
            формат Next.js <Script> вместо обычного <script>. strategy=
            "afterInteractive" — та же причина, что и у GA4 ниже: не
            задерживать первую отрисовку страницы ради стороннего
            скрипта аналитики. 'track', 'PageView' сразу после
            инициализации — это базовое событие "покупатель открыл
            страницу", которое Meta Pixel ожидает видеть на КАЖДОЙ
            странице сайта */}
        {META_PIXEL_ID && (
          <Script id="meta-pixel-init" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${META_PIXEL_ID}');
              fbq('track', 'PageView');
            `}
          </Script>
        )}

        {/* ==================== GOOGLE ANALYTICS 4 ====================
            strategy="afterInteractive" — те саме, що рекомендує сам
            Next.js для gtag.js: завантажується ПІСЛЯ того, як сторінка
            стала інтерактивною, щоб не затримувати перший рендер і
            Core Web Vitals (LCP) заради стороннього скрипта аналітики.
            Якщо NEXT_PUBLIC_GA_MEASUREMENT_ID не задано — обидва
            <Script> просто не рендеряться, на сайті це ніяк не видно */}
        {GA_MEASUREMENT_ID && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
            <Script id="ga4-init" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}

// ============================================================
// ФАЙЛИ ФАВІКОНКИ — де лежать і як згенеровані (public/favicon.svg,
// public/favicon.ico, public/favicon-16x16.png, public/favicon-32x32.png,
// public/apple-touch-icon.png). Next.js віддає все з /public напряму
// з кореня сайту, тому файл public/favicon.ico доступний за адресою
// /favicon.ico — саме такий шлях і використаний у <link> вище.
//
// Малюнок — фірмовий значок DominatorParts (шестерня + свічка
// запалювання), той самий, що і в шапці сайту (компонент
// DominatorMark у components/StorefrontHome.tsx), у кольорі бренду
// #1D5FD6. favicon.svg сам перемикається на світліший відтінок
// #6FA0FF у темній темі браузера (@media prefers-color-scheme: dark
// прямо всередині SVG) — це і є "підтримка теми" з файлу, а не
// два окремих light/dark файли.
//
// Якщо картинку захочете замінити на іншу — досить перегенерувати
// ці ж 5 файлів (розміри й імена мають лишитись точно такими самими,
// інакше треба міняти й шляхи в <link> вище):
//   favicon.svg           — вихідний вектор, будь-який розмір
//   favicon.ico           — 16×16 + 32×32 + 48×48 в одному файлі
//                            (для старих браузерів, які SVG не вміють)
//   favicon-16x16.png     — PNG-фолбек, прозорий фон
//   favicon-32x32.png     — PNG-фолбек, прозорий фон
//   apple-touch-icon.png  — 180×180, ФОН ОБОВ'ЯЗКОВО НЕПРОЗОРИЙ
//                            (iOS сам додає скруглені кути; прозорі
//                            ділянки на "домашньому екрані" iPhone
//                            стануть чорними)
// ============================================================

// ============================================================
// GA4 І GOOGLE SEARCH CONSOLE — куди вписати реальні значення
//
// Обидва підключаються ЧЕРЕЗ ЗМІННІ СЕРЕДОВИЩА, а не прямо в коді —
// той самий підхід, що і з CRON_SECRET/BLOB_READ_WRITE_TOKEN: значення
// належать вашому Google-акаунту, у коді їх бути не повинно.
//
// Vercel Dashboard → проект autokontur-site-tpyb → Settings →
// Environment Variables → додати обидві (Production, і Preview за
// бажанням):
//
//   NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
//     Джерело: analytics.google.com → Адмін → Потоки даних → ваш
//     потік (Web) → "Ідентифікатор потоку" вгорі картки
//
//   NEXT_PUBLIC_GSC_VERIFICATION=abcdEFGH12345...
//     Джерело: search.google.com/search-console → додати ресурс →
//     тип "Префікс URL-адреси" → вкладка "Файл HTML-тега" → скопіювати
//     ЛИШЕ значення content="..." (сам тег вставляти не треба —
//     app/layout.tsx сам його збирає через metadata.verification.google)
//
// Локально (.env.local) можна лишити обидві порожніми — тоді ні
// лічильник, ні тег верифікації просто не рендеряться, помилки не буде
// ============================================================

// ============================================================
// META (FACEBOOK) PIXEL — куда вписать реальное значение
//
// Тот же принцип, что и с GA4 выше: значение задаётся через переменную
// окружения, а не прямо в коде.
//
// Vercel Dashboard → проект → Settings → Environment Variables →
// добавить (Production, и Preview по желанию):
//
//   NEXT_PUBLIC_META_PIXEL_ID=1234567890123456
//     Источник: business.facebook.com → Events Manager → выбрать
//     пиксель → Настройки → "ID пикселя" (число из 15-16 цифр)
//
// Локально (.env.local) можно оставить пустым — тогда пиксель просто
// не рендерится, ошибки не будет.
//
// ЧТО ДАЛЬШЕ (события электронной торговли): базовый код пикселя
// (этот файл) отправляет только событие "просмотр страницы" на КАЖДОЙ
// странице. Отслеживание конкретных действий покупателя — просмотр
// товара, добавление в корзину, начало и завершение оформления заказа —
// подключено отдельно, через функции-обёртки в lib/analytics.ts
// (вызываются из components/ProductDetailContent.tsx,
// components/AddToCartButton.tsx и components/StorefrontHome.tsx)
// ============================================================
