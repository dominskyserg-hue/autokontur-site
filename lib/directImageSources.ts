// ============================================================
// Варіант Б — пряме вгадування посилання на фото за брендом і
// артикулом (Direct Image Matching), БЕЗ пошуку і без завантаження
// "наосліп": спочатку перевіряємо існування файлу HEAD-запитом
// (тільки заголовки, без самого фото), і лише тоді, якщо картинка
// справді існує, довантажуємо і обробляємо її через
// lib/imageProcessing.ts.
//
// ЧЕСНО ПРО МЕЖІ ЦЬОГО ПІДХОДУ: на відміну від Варіанту А (пошук у
// Bing, lib/imageSearch.ts), тут НЕМАЄ жодного універсального
// "офіційного" CDN автозапчастин зі стабільним публічним шаблоном
// посилань виду https://cdn.brand.com/{article}.jpg — виробники й
// каталоги (TecDoc-подібні бази, дистриб'ютори) зазвичай прив'язують
// фото до ВНУТРІШНІХ числових ID, а не до артикула напряму, і ці ID
// неможливо вгадати наперед. Я перевірив це наживо під час підготовки
// цього рішення: видача Bing (див. lib/imageSearch.ts) справді
// повертає фото з реальних каталогів (наприклад,
// kmotorshop.com/document/tecdoc/{внутрішній ID}/{артикул}PH01....JPG),
// але сам "{внутрішній ID}" — це не бренд і не артикул, а число, яке
// не вивести жодною формулою.
//
// Тому цей файл — не готовий список "перевірених брендових CDN", а
// КАРКАС: масив шаблонів, куди ви самі додаєте патерни, якщо у вас
// вже є пряма домовленість із конкретним постачальником і ви знаєте
// (з його прайсу, сайту чи документації API), що в нього посилання на
// фото дійсно будуються за артикулом. Наприклад: якщо в Excel-прайсі
// одного з ваших постачальників (див. supplier_excel_mappings) колись
// з'явиться окрема колонка з готовим посиланням на фото — це і є
// найнадійніший "Варіант Б" для САМЕ ЦЬОГО постачальника, без жодного
// вгадування.
// ============================================================

import { randomUserAgent } from './imageSearch';

export interface DirectImageTemplate {
  // Коротка назва для логів ("tecdoc-demo" тощо)
  name: string;
  // Функція будує URL за брендом і артикулом. cleanArticle — уже
  // очищений артикул (як зберігається в базі, див. cleanArticle() в
  // app/api/suppliers/parse-excel/route.ts), rawArticle — оригінальний
  // текст, якщо якомусь каталогу потрібні дефіси/пробіли як є
  buildUrl: (params: { brand: string; cleanArticle: string; rawArticle: string }) => string | null;
}

// ПРИКЛАД шаблону — навмисно вигаданий домен example-parts-cdn.com,
// щоб ніхто не сплутав це з реальним працюючим джерелом. Замініть чи
// видаліть, коли з'явиться реальний перевірений патерн
const EXAMPLE_TEMPLATE: DirectImageTemplate = {
  name: 'example-template (замініть на реальний)',
  buildUrl: ({ brand, cleanArticle }) =>
    `https://example-parts-cdn.com/${encodeURIComponent(brand.toLowerCase())}/${encodeURIComponent(cleanArticle)}.jpg`,
};

// Сюди додаєте реальні перевірені шаблони — по одному на кожне
// джерело, з яким ви домовились або яке самі перевірили вручну
export const DIRECT_IMAGE_TEMPLATES: DirectImageTemplate[] = [
  EXAMPLE_TEMPLATE,
];

// HEAD-запит — саме те, що просили в завданні: перевірити, що фото
// існує (статус 200 і Content-Type починається з image/), не
// завантажуючи сам файл. Це швидко й не витрачає чужий трафік
// даремно на явно неіснуючі посилання
export async function checkImageExists(url: string, timeoutMs = 6000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': randomUserAgent() },
      signal: controller.signal,
    });

    if (!response.ok) return false;

    const contentType = response.headers.get('content-type') || '';
    return contentType.startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DirectMatchParams {
  brand: string;
  cleanArticle: string;
  rawArticle: string;
}

// Перебирає всі шаблони з DIRECT_IMAGE_TEMPLATES по черзі й повертає
// ПЕРШЕ посилання, яке реально існує (перевірено HEAD-запитом), або
// null, якщо жодне не підійшло — тоді пайплайн (див.
// lib/productImagePipeline.ts) переходить до Варіанту А (пошук)
export async function findDirectImageUrl(params: DirectMatchParams): Promise<string | null> {
  for (const template of DIRECT_IMAGE_TEMPLATES) {
    const url = template.buildUrl(params);
    if (!url) continue;

    const exists = await checkImageExists(url);
    if (exists) return url;
  }

  return null;
}
