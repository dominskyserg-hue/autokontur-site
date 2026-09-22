// ============================================================
// Превращает готовый HTML документа (собранный шаблонами из
// invoiceTemplate.ts / deliveryNoteTemplate.ts / returnActTemplate.ts)
// в PDF-файл через headless-браузер (Puppeteer) — тот же самый HTML,
// что показывается в предпросмотре модального окна и печатается
// через window.print(), поэтому PDF выглядит пиксель-в-пиксель как
// печатная форма.
//
// На Vercel (serverless, без предустановленного Chrome) используется
// @sparticuz/chromium — версия Chromium, собранная специально под
// serverless-окружения (лямбда/functions), подключённая как обычная
// production-зависимость. Локально при разработке (npm run dev)
// используется уже установленный на компьютере Chrome/Edge — так не
// нужно отдельно докачивать ~300 МБ полного Chromium только для
// разработки (см. PUPPETEER_EXECUTABLE_PATH ниже для явного указания
// пути, если браузер стоит не по стандартному адресу).
// ============================================================

import puppeteer, { Browser } from 'puppeteer-core';

// Стандартные пути установки Chrome/Edge на разных ОС — используются
// только в разработке (NODE_ENV !== 'production'), как запасной
// вариант, если переменная окружения PUPPETEER_EXECUTABLE_PATH не
// задана явно
const LOCAL_BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

async function findLocalExecutablePath(): Promise<string> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const { existsSync } = await import('node:fs');
  const found = LOCAL_BROWSER_CANDIDATES.find((path) => existsSync(path));
  if (found) return found;

  throw new Error(
    'Не найден локальный браузер Chrome/Edge для генерации PDF в режиме разработки. ' +
      'Установите Google Chrome, либо укажите путь к нему в переменной окружения PUPPETEER_EXECUTABLE_PATH в .env.local.'
  );
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.NODE_ENV === 'production') {
    // Импортируем @sparticuz/chromium только на проде — он тянет за
    // собой сам бинарник Chromium (десятки МБ), незачем грузить это
    // в память локального dev-сервера
    const chromium = (await import('@sparticuz/chromium')).default;

    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  }

  const executablePath = await findLocalExecutablePath();
  return puppeteer.launch({ executablePath, headless: true });
}

// Превращает HTML-строку в PDF (A4, с фоновыми цветами/картинками —
// printBackground: true, иначе акцентные цвета шапки/таблицы в
// шаблоне просто не попали бы в файл)
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    // 'load' достаточно: шаблон документа полностью самодостаточен —
    // логотип/печать/QR уже встроены как data:-URI (см.
    // lib/documents/qrCode.ts), внешних ресурсов дожидаться не нужно.
    // 'networkidle0' для setContent (в отличие от page.goto) в этой
    // версии Puppeteer больше не поддерживается
    await page.setContent(html, { waitUntil: 'load' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
