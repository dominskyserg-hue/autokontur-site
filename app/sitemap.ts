// ============================================================
// /sitemap.xml — файлова конвенція Next.js App Router: усе, що
// повертає функція нижче, автоматично віддається на /sitemap.xml
// у потрібному Google форматі.
//
// Раніше в Google взагалі не було звідки дізнатись про сторінки
// категорій (app/category/[slug]) і марок (app/marky/[make]) —
// окрім внутрішніх посилань з Головної (повільно: чекати, поки
// пошуковик сам їх обійде). Sitemap називає всі адреси одразу.
// ============================================================

import type { MetadataRoute } from 'next';
import { CATEGORIES } from '@/lib/categories';
import { CAR_MAKES } from '@/lib/carMakes';
import { SITE_URL } from '@/lib/siteConfig';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/category`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${SITE_URL}/marky`, lastModified: now, changeFrequency: 'weekly', priority: 0.8 },
  ];

  // Товари в каталозі змінюються (нові прайси, залишки) частіше, ніж
  // сам список категорій/марок — тому changeFrequency: 'daily', а не
  // 'weekly'. Якщо якась категорія/марка тимчасово залишиться зовсім
  // без товару, її сторінка сама позначиться noindex (див.
  // generateMetadata у відповідних page.tsx) — присутність у sitemap
  // цьому не заважає, Google просто не проіндексує таку сторінку
  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map((c) => ({
    url: `${SITE_URL}/category/${c.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const makePages: MetadataRoute.Sitemap = CAR_MAKES.map((m) => ({
    url: `${SITE_URL}/marky/${m.slug}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages, ...makePages];
}
