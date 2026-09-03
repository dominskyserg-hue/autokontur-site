// ============================================================
// /sitemap-products-1.xml — товари №1–45 000 (за стабільним
// сортуванням ORDER BY id, див. lib/sitemapProducts.ts). Кожен файл
// у цій серії (sitemap-products-1..6) — точна копія, відрізняється
// лише CHUNK_NUMBER нижче.
// ============================================================

import { getProductsSitemapEntries } from '@/lib/sitemapProducts';
import { buildUrlsetXml, xmlResponse } from '@/lib/sitemapXml';

export const runtime = 'nodejs';
export const revalidate = 86400;

const CHUNK_NUMBER = 1;

export async function GET() {
  const entries = await getProductsSitemapEntries(CHUNK_NUMBER);
  return xmlResponse(buildUrlsetXml(entries));
}
