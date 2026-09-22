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
};

export default nextConfig;
