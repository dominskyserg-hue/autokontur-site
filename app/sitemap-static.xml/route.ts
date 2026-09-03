// ============================================================
// /sitemap-static.xml — усі сторінки сайту, КРІМ товарів (ті — в
// /sitemap-products-N.xml, посилання на все разом — з /sitemap.xml).
//
// Було раніше файлом app/sitemap.ts (файлова конвенція Next.js) —
// переїхало сюди, у звичайний Route Handler, бо потрібна саме ця,
// конкретна адреса як ЧАСТИНА sitemap-індексу, а не єдиний sitemap.xml
// сам по собі.
// ============================================================

import { CATEGORIES } from '@/lib/categories';
import { CAR_MAKES } from '@/lib/carMakes';
import { SITE_URL } from '@/lib/siteConfig';
import { buildUrlsetXml, xmlResponse, type SitemapUrlEntry } from '@/lib/sitemapXml';

export const runtime = 'nodejs';
export const revalidate = 86400;

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);

  const staticPages: SitemapUrlEntry[] = [
    { loc: SITE_URL, lastmod: today, changefreq: 'daily', priority: 1 },
    { loc: `${SITE_URL}/category`, lastmod: today, changefreq: 'weekly', priority: 0.8 },
    { loc: `${SITE_URL}/marky`, lastmod: today, changefreq: 'weekly', priority: 0.8 },
    { loc: `${SITE_URL}/about`, lastmod: today, changefreq: 'monthly', priority: 0.4 },
    { loc: `${SITE_URL}/delivery`, lastmod: today, changefreq: 'monthly', priority: 0.5 },
    { loc: `${SITE_URL}/contacts`, lastmod: today, changefreq: 'monthly', priority: 0.5 },
    // Юридичні сторінки — низький priority (не те, за чим шукають у
    // Google), але мають бути в сайтмапі заради повноти й довіри
    // (E-E-A-T): показує пошуковику, що на сайті взагалі є ці сторінки
    { loc: `${SITE_URL}/terms`, lastmod: today, changefreq: 'yearly', priority: 0.2 },
    { loc: `${SITE_URL}/privacy`, lastmod: today, changefreq: 'yearly', priority: 0.2 },
    { loc: `${SITE_URL}/returns`, lastmod: today, changefreq: 'yearly', priority: 0.3 },
  ];

  // Товари в каталозі змінюються (нові прайси, залишки) частіше, ніж
  // сам список категорій/марок — тому changeFrequency: 'daily', а не
  // 'weekly'. Якщо якась категорія/марка тимчасово залишиться зовсім
  // без товару, її сторінка сама позначиться noindex (див.
  // generateMetadata у відповідних page.tsx) — присутність у sitemap
  // цьому не заважає, Google просто не проіндексує таку сторінку
  const categoryPages: SitemapUrlEntry[] = CATEGORIES.map((c) => ({
    loc: `${SITE_URL}/category/${c.slug}`,
    lastmod: today,
    changefreq: 'daily',
    priority: 0.7,
  }));

  const makePages: SitemapUrlEntry[] = CAR_MAKES.map((m) => ({
    loc: `${SITE_URL}/marky/${m.slug}`,
    lastmod: today,
    changefreq: 'daily',
    priority: 0.7,
  }));

  const makeToPages: SitemapUrlEntry[] = CAR_MAKES.map((m) => ({
    loc: `${SITE_URL}/marky/${m.slug}/to`,
    lastmod: today,
    changefreq: 'weekly',
    priority: 0.6,
  }));

  const xml = buildUrlsetXml([...staticPages, ...categoryPages, ...makePages, ...makeToPages]);
  return xmlResponse(xml);
}
