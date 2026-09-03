// ============================================================
// Дані для товарних сайтмапів (app/sitemap-products-N.xml/route.ts) —
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

// Скільки файлів app/sitemap-products-N.xml РЕАЛЬНО існує як окремі
// route-файли (кожен — своя папка, бо Next.js App Router маршрутизує
// за файловою системою, а не за одним параметризованим шаблоном для
// такого імені). Зараз товарів ~128 000 (потрібно 3 файли) — 6 дає
// запас у 270 000 товарів. Якщо каталог виросте ще більше — потрібно
// створити ще одну папку app/sitemap-products-7.xml (скопіювавши код
// app/sitemap-products-6.xml/route.ts і поправивши CHUNK_NUMBER) і
// збільшити це число
export const SITEMAP_PRODUCTS_MAX_CHUNKS = 6;

export async function getProductsSitemapTotalCount(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*)::int AS total FROM products');
  return result.rows[0]?.total ?? 0;
}

// chunkNumber — 1-based (перший файл /sitemap-products-1.xml)
export async function getProductsSitemapEntries(chunkNumber: number): Promise<SitemapUrlEntry[]> {
  const offset = (chunkNumber - 1) * SITEMAP_PRODUCTS_CHUNK_SIZE;

  const result = await pool.query(
    `
    SELECT id, article, brand, name, updated_at
    FROM products
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
