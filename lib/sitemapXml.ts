// ============================================================
// Побудова XML для сайтмапів вручну (звичайні Route Handlers, а не
// файлова конвенція Next.js sitemap.ts) — потрібно, щоб мати ТОЧНО
// названі файли (/sitemap-static.xml, /sitemap-products-1.xml...) і
// один /sitemap.xml, що є ІНДЕКСОМ інших сайтмапів, а не єдиним
// списком адрес. Вбудований generateSitemaps() Next.js віддає файли
// за своїм власним шаблоном імен (/sitemap/0.xml) — тут потрібні
// саме ці, конкретні адреси.
// ============================================================

export interface SitemapUrlEntry {
  loc: string;
  lastmod: string; // YYYY-MM-DD
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod: string;
}

// Екранування спецсимволів XML — url товару теоретично може містити
// амперсанд і т.п. (slug вже безпечний, бо проходить через slugify(),
// але SITE_URL/шлях підставляються без додаткової фільтрації, тому
// краще екранувати завжди, а не сподіватись на це)
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildUrlsetXml(entries: SitemapUrlEntry[]): string {
  const items = entries
    .map(
      (entry) => `
  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>${
      entry.changefreq ? `\n    <changefreq>${entry.changefreq}</changefreq>` : ''
    }${entry.priority !== undefined ? `\n    <priority>${entry.priority}</priority>` : ''}
  </url>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}\n</urlset>`;
}

export function buildSitemapIndexXml(entries: SitemapIndexEntry[]): string {
  const items = entries
    .map(
      (entry) => `
  <sitemap>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
  </sitemap>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}\n</sitemapindex>`;
}

// Одна и та же відповідь для всіх сайтмапів нижче — тіло XML +
// правильний Content-Type. revalidate на самих route.ts (86400с/добу)
// керує тим, як часто це тіло реально перебудовується
export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
