/** @type {import('next').NextConfig} */
const nextConfig = {
  // @sparticuz/chromium и puppeteer-core (lib/documents/renderPdf.ts,
  // генерация PDF печатных документов заказа) содержат бинарные файлы
  // Chromium — если позволить обычному webpack-бандлеру Next.js
  // пытаться их анализировать и упаковывать, сборка либо упадёт с
  // ошибкой разрешения модулей, либо раздует бандл. serverExternalPackages
  // явно говорит Next.js подключать эти пакеты как есть (require)
  // на сервере, а не бандлить — Vercel сам довключит их файлы через
  // трассировку (Output File Tracing) при деплое
  // /sitemap-products-N.xml -> один динамічний роут app/sitemap-products/[chunk]
  // (App Router не підтримує динамічний сегмент усередині імені "…-N.xml")
  async rewrites() {
    return [{ source: '/sitemap-products-:chunk(\\d+).xml', destination: '/sitemap-products/:chunk' }];
  },

  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

  // Не сообщаем в каждом ответе "X-Powered-By: Next.js" — лишняя
  // подсказка атакующему, на чём сделан сайт
  poweredByHeader: false,

  // Заголовки безопасности для ВСЕХ адресов сайта (аудит безопасности):
  //   X-Frame-Options: DENY — сайт (и админку) нельзя встроить в чужой
  //     iframe, защита от "кликджекинга" (невидимая кнопка поверх чужой страницы);
  //   X-Content-Type-Options: nosniff — браузер не "угадывает" тип файла
  //     (загруженная картинка не выполнится как скрипт);
  //   Referrer-Policy — на чужие сайты уходит только домен, без полного адреса;
  //   Permissions-Policy — камера, микрофон и геолокация сайту не нужны, запрещены;
  //   Strict-Transport-Security — только HTTPS на 2 года, включая поддомены.
  // Content-Security-Policy пока НЕ добавлен — отдельной задачей
  // (нужно аккуратно разрешить GA4, Google Ads, Meta Pixel)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },

  // Выключатель кабинета покупателя (lib/customerCabinet.ts): та же
  // серверная переменная CUSTOMER_CABINET_ENABLED, проброшенная в
  // браузерный код, чтобы скрыть ссылки "Кабінет" на витрине
  env: {
    NEXT_PUBLIC_CUSTOMER_CABINET_ENABLED: process.env.CUSTOMER_CABINET_ENABLED === 'true' ? 'true' : 'false',
  },

  // Самой трассировки (Output File Tracing) недостаточно: она находит
  // файлы через require()/import в коде, а @sparticuz/chromium
  // открывает свою папку bin/ (сжатые .br-архивы самого Chromium)
  // напрямую по пути через fs — трассировщик такие обращения не видит
  // и не докладывает эти файлы в собранную serverless-функцию. Без
  // этого блока на Vercel падает ошибка "The input directory
  // '/var/task/node_modules/@sparticuz/chromium/bin' does not exist" —
  // код вроде бы есть, а самого Chromium внутри функции нет.
  // outputFileTracingIncludes явно велит включить папку bin/ в бандл
  // ИМЕННО тех роутов, которые реально запускают Puppeteer
  // (lib/documents/renderPdf.ts → app/api/orders/[id]/documents/[docType]/download
  // и .../save; .../preview PDF не генерирует, поэтому её здесь нет)
  outputFileTracingIncludes: {
    '/api/orders/[id]/documents/[docType]/download': ['./node_modules/@sparticuz/chromium/bin/**'],
    '/api/orders/[id]/documents/[docType]/save': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
};

export default nextConfig;
