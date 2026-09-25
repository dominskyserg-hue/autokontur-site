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
import { getProductsSitemapChunkCount } from '@/lib/sitemapProducts';
import { buildSitemapIndexXml, xmlResponse } from '@/lib/sitemapXml';

export const runtime = 'nodejs';
export const revalidate = 86400;

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  // Стільки файлів, скільки потрібно під ВЕСЬ каталог — файл
  // /sitemap-products-N.xml обслуговує один динамічний роут
  // (app/sitemap-products/[chunk]/route.ts), тож верхньої межі немає
  const chunkCount = await getProductsSitemapChunkCount();

  const productSitemaps = Array.from({ length: chunkCount }, (_, i) => ({
    loc: `${SITE_URL}/sitemap-products-${i + 1}.xml`,
    lastmod: today,
  }));

  const xml = buildSitemapIndexXml([{ loc: `${SITE_URL}/sitemap-static.xml`, lastmod: today }, ...productSitemaps]);

  return xmlResponse(xml);
}
