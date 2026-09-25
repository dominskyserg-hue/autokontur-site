// ============================================================
// Дані для товарних сайтмапів (/sitemap-products-N.xml, app/sitemap-products/[chunk]/route.ts) —
// пагінація каталогу фіксованими "вікнами" по CHUNK_SIZE товарів.
//
// ORDER BY p.id — не тому, що порядок сам по собі важливий, а тому,
// що він має бути СТАБІЛЬНИМ між двома запитами: інакше та сама
// пагінація (LIMIT/OFFSET) на різних запитах видавала б різний набір
// товарів у "вікні", і якийсь товар міг би випасти з усіх сайтмапів
// одразу або потрапити у два.
// ============================================================

import { Pool } from 'pg';
import { buildProductPath } from './slug';
import { SITE_URL } from './siteConfig';
import type { SitemapUrlEntry } from './sitemapXml';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

// 45 000 — з запасом під ліміт Google (50 000 адрес на один файл
// сайтмапу), той самий розмір "вікна", що узгодили в плані
export const SITEMAP_PRODUCTS_CHUNK_SIZE = 45_000;

export async function getProductsSitemapTotalCount(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*)::int AS total FROM products WHERE is_active = true');
  return result.rows[0]?.total ?? 0;
}

// Скільки файлів /sitemap-products-N.xml потрібно під поточний каталог —
// без верхньої межі (раніше було жорстко 6 файлів = 270 000 товарів)
export async function getProductsSitemapChunkCount(): Promise<number> {
  const total = await getProductsSitemapTotalCount();
  return Math.max(1, Math.ceil(total / SITEMAP_PRODUCTS_CHUNK_SIZE));
}

// chunkNumber — 1-based (перший файл /sitemap-products-1.xml)
export async function getProductsSitemapEntries(chunkNumber: number): Promise<SitemapUrlEntry[]> {
  const offset = (chunkNumber - 1) * SITEMAP_PRODUCTS_CHUNK_SIZE;

  const result = await pool.query(
    `
    SELECT id, article, brand, name, updated_at
    FROM products
    WHERE is_active = true
    ORDER BY id
    LIMIT $1 OFFSET $2
    `,
    [SITEMAP_PRODUCTS_CHUNK_SIZE, offset]
  );

  return result.rows.map((row) => ({
    loc: `${SITE_URL}${buildProductPath(row.id, { brand: row.brand, article: row.article, name: row.name })}`,
    // lastmod = коли товар реально востаннє змінювався (нова ціна,
    // новий залишок після перезаливки прайсу постачальника) — саме
    // цього просив клієнт, а не дата генерації самого сайтмапу
    lastmod: new Date(row.updated_at).toISOString().slice(0, 10),
  }));
}
