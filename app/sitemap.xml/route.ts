// ============================================================
// /sitemap.xml — ІНДЕКС сайтмапів (sitemap index), а не сам список
// адрес. Посилається на /sitemap-static.xml (усі сторінки, крім
// товарів) і на стільки /sitemap-products-N.xml, скільки реально
// потрібно під поточну кількість товарів у базі (по
// SITEMAP_PRODUCTS_CHUNK_SIZE = 45 000 товарів на файл — з запасом
// під ліміт Google у 50 000 адрес на один файл).
//
// Це звичайний Route Handler (не файлова конвенція sitemap.ts), бо
// потрібні САМЕ ці, конкретно названі адреси — вбудований механізм
// Next.js (generateSitemaps) називає файли за власним шаблоном
// (/sitemap/0.xml), який тут не підходив.
//
// revalidate = 86400 (доба) — Next.js кешує відповідь і перебудовує
// її не частіше ніж раз на добу, навіть якщо Google або хтось інший
// буде запитувати /sitemap.xml частіше. Без цього кожен обхід
// пошуковика бив би прямо по базі даних
// ============================================================

import { SITE_URL } from '@/lib/siteConfig';
import { getProductsSitemapTotalCount, SITEMAP_PRODUCTS_CHUNK_SIZE, SITEMAP_PRODUCTS_MAX_CHUNKS } from '@/lib/sitemapProducts';
import { buildSitemapIndexXml, xmlResponse } from '@/lib/sitemapXml';

export const runtime = 'nodejs';
export const revalidate = 86400;

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const totalProducts = await getProductsSitemapTotalCount();
  const neededChunks = Math.max(1, Math.ceil(totalProducts / SITEMAP_PRODUCTS_CHUNK_SIZE));
  // Не посилаємось на файл, якого фізично не існує (див. коментар
  // біля SITEMAP_PRODUCTS_MAX_CHUNKS) — краще тимчасово недорахувати
  // частину каталогу в сайтмапі, ніж дати Google 404 на посилання
  // з власного індексу
  const chunkCount = Math.min(neededChunks, SITEMAP_PRODUCTS_MAX_CHUNKS);

  const productSitemaps = Array.from({ length: chunkCount }, (_, i) => ({
    loc: `${SITE_URL}/sitemap-products-${i + 1}.xml`,
    lastmod: today,
  }));

  const xml = buildSitemapIndexXml([{ loc: `${SITE_URL}/sitemap-static.xml`, lastmod: today }, ...productSitemaps]);

  return xmlResponse(xml);
}
