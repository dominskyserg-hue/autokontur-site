// ============================================================
// Дані для товарних сайтмапів (/sitemap-products-N.xml, app/sitemap-products/[chunk]/route.ts) —
// пагінація каталогу фіксованими "вікнами" по CHUNK_SIZE товарів.
//
// ПОРЯДОК (щоб Google першими бачив найважливіші сторінки):
//   1) файли з товарами В НАЯВНОСТІ — спершу бренди групи 1, потім
//      групи 2, потім решта (lib/brandPriority.ts);
//   2) ОКРЕМІ файли в кінці — товари, яких немає в наявності менше 90
//      днів (products.stock_zero_since). Тих, кого немає довше, у
//      сайтмапі немає зовсім — сторінка лишається доступною.
// Усередині групи — ORDER BY id: порядок має бути СТАБІЛЬНИМ між
// запитами, інакше LIMIT/OFFSET на різних запитах видавав би різний
// набір і товар міг випасти з усіх файлів або потрапити у два.
//
// lastmod = products.content_changed_at — коли РЕАЛЬНО змінилися ціна,
// назва чи наявність (ставить тригер у базі, schema.sql). Раніше тут
// був updated_at, а він змінюється при кожному імпорті прайсу — lastmod
// у всіх товарів дорівнював даті останнього імпорту. Немає чесної дати
// (товар заведено до появлення поля) — lastmod не пишемо зовсім
// ============================================================

import { Pool } from 'pg';
import { buildProductPath } from './slug';
import { SITE_URL } from './siteConfig';
import { BRAND_GROUP_1_KEYS, BRAND_GROUP_2_KEYS } from './brandPriority';
import { PRODUCT_GROUPS_ACTIVE } from './productGroups';
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

// 45 000 — з запасом під ліміт Google (50 000 адрес на один файл сайтмапу)
export const SITEMAP_PRODUCTS_CHUNK_SIZE = 45_000;

// Товари, яких немає в наявності довше, ніж стільки днів, у сайтмап не йдуть
const OUT_OF_STOCK_DAYS = 90;

// Группы бренд+артикул (lib/productGroups.ts): в sitemap — только главная
// страница группы; "в наличии" — если в наличии хоть одно предложение группы
const PRIMARY_SQL = PRODUCT_GROUPS_ACTIVE ? ' AND is_group_primary' : '';
const HAS_STOCK_SQL = PRODUCT_GROUPS_ACTIVE
  ? '(stock > 0 OR EXISTS (SELECT 1 FROM products t WHERE t.group_primary_id = products.id AND t.is_active AND t.stock > 0))'
  : 'stock > 0';
const IN_STOCK_SQL = `is_active = true${PRIMARY_SQL} AND ${HAS_STOCK_SQL}`;
const RECENTLY_OUT_SQL = `is_active = true${PRIMARY_SQL} AND NOT ${HAS_STOCK_SQL} AND stock_zero_since > now() - interval '${OUT_OF_STOCK_DAYS} days'`;

// Група бренду в SQL: $1 — ключі групи 1, $2 — групи 2 (normalizeBrandKey)
const BRAND_GROUP_SQL = `CASE WHEN upper(regexp_replace(coalesce(brand, ''), '[[:space:]-]', '', 'g')) = ANY($1::text[]) THEN 1
  WHEN upper(regexp_replace(coalesce(brand, ''), '[[:space:]-]', '', 'g')) = ANY($2::text[]) THEN 2 ELSE 3 END`;

export interface ProductsSitemapPlan {
  inStock: number;
  recentlyOut: number;
  inStockChunks: number;
  recentlyOutChunks: number;
}

// Скільки товарів і файлів кожного виду — для індексу /sitemap.xml
export async function getProductsSitemapPlan(): Promise<ProductsSitemapPlan> {
  const result = await pool.query(
    `SELECT count(*) FILTER (WHERE ${IN_STOCK_SQL})::int AS in_stock,
            count(*) FILTER (WHERE ${RECENTLY_OUT_SQL})::int AS recently_out
     FROM products`
  );
  const inStock: number = result.rows[0]?.in_stock ?? 0;
  const recentlyOut: number = result.rows[0]?.recently_out ?? 0;
  return {
    inStock,
    recentlyOut,
    inStockChunks: Math.max(1, Math.ceil(inStock / SITEMAP_PRODUCTS_CHUNK_SIZE)),
    recentlyOutChunks: Math.ceil(recentlyOut / SITEMAP_PRODUCTS_CHUNK_SIZE),
  };
}

// Скільки всього файлів /sitemap-products-N.xml (без верхньої межі)
export async function getProductsSitemapChunkCount(): Promise<number> {
  const plan = await getProductsSitemapPlan();
  return plan.inStockChunks + plan.recentlyOutChunks;
}

// chunkNumber — 1-based: спершу файли "в наявності", далі "немає в наявності"
export async function getProductsSitemapEntries(chunkNumber: number): Promise<SitemapUrlEntry[]> {
  const plan = await getProductsSitemapPlan();
  const inStockPart = chunkNumber <= plan.inStockChunks;
  const offset = ((inStockPart ? chunkNumber : chunkNumber - plan.inStockChunks) - 1) * SITEMAP_PRODUCTS_CHUNK_SIZE;

  const result = inStockPart
    ? await pool.query(
        `SELECT id, article, brand, name, content_changed_at FROM products
         WHERE ${IN_STOCK_SQL}
         ORDER BY ${BRAND_GROUP_SQL}, id
         LIMIT $3 OFFSET $4`,
        [BRAND_GROUP_1_KEYS, BRAND_GROUP_2_KEYS, SITEMAP_PRODUCTS_CHUNK_SIZE, offset]
      )
    : await pool.query(
        `SELECT id, article, brand, name, content_changed_at FROM products
         WHERE ${RECENTLY_OUT_SQL}
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [SITEMAP_PRODUCTS_CHUNK_SIZE, offset]
      );

  return result.rows.map((row) => ({
    loc: `${SITE_URL}${buildProductPath(row.id, { brand: row.brand, article: row.article, name: row.name })}`,
    lastmod: row.content_changed_at ? new Date(row.content_changed_at).toISOString().slice(0, 10) : undefined,
  }));
}
