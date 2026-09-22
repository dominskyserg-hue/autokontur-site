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
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],

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
