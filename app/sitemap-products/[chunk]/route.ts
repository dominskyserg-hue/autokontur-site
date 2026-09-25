// ============================================================
// /sitemap-products-N.xml — N-те "вікно" по SITEMAP_PRODUCTS_CHUNK_SIZE
// товарів (lib/sitemapProducts.ts). Публічна адреса /sitemap-products-N.xml
// переписується сюди (/sitemap-products/N) у next.config.mjs (rewrites) —
// App Router не вміє динамічний сегмент ВСЕРЕДИНІ імені ("-N.xml").
//
// Раніше кожен файл був окремою папкою (sitemap-products-1.xml ...
// sitemap-products-6.xml), і коли каталог виріс понад 6 × 45 000 = 270 000
// товарів, решта (~89 тис.) мовчки не потрапляла в жоден сайтмап. Тепер
// кількість файлів рахується з кількості товарів — обмеження немає
// ============================================================

import { getProductsSitemapChunkCount, getProductsSitemapEntries } from '@/lib/sitemapProducts';
import { buildUrlsetXml, xmlResponse } from '@/lib/sitemapXml';

export const runtime = 'nodejs';
export const revalidate = 86400;

export async function GET(_request: Request, { params }: { params: Promise<{ chunk: string }> }) {
  const { chunk } = await params;
  const chunkNumber = Number(chunk);
  if (!Number.isInteger(chunkNumber) || chunkNumber < 1 || chunkNumber > (await getProductsSitemapChunkCount())) {
    return new Response('Not found', { status: 404 });
  }
  const entries = await getProductsSitemapEntries(chunkNumber);
  const response = xmlResponse(buildUrlsetXml(entries));
  // Динамічний роут (параметр [chunk]) не кешується через revalidate як
  // старі статичні файли — кешуємо на CDN Vercel на добу (як раніше),
  // щоб кожен обхід пошуковика не робив ~3 с запиту до бази
  response.headers.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
  return response;
}
