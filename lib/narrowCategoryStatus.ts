// ============================================================
// "Тонкие" узкие категории "деталь + модель" (CategoryDef.tecdocVehicle):
// после этапа C перехода с TecDoc в них остаются только товары,
// подтверждённые своей применимостью (lib/narrowCategoryVehicles.ts).
// Категория, где осталось меньше MIN_NARROW_PRODUCTS деталей, отдаёт 301
// на родительскую или широкую категорию (narrowRedirectTarget,
// app/category/[slug]/page.tsx) и не попадает в sitemap
// (app/sitemap-static.xml/route.ts).
//
// Детали считаются как на сайте: уникальные бренд + артикул среди
// активных товаров категории (product_categories). Кэш в памяти на 10 минут —
// список нужен на каждом показе узкой страницы и в sitemap
// ============================================================

import { Pool } from 'pg';
import { CATEGORIES, categoryMatchesName, type CategoryDef } from '@/lib/categories';

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

export const MIN_NARROW_PRODUCTS = 5;

const TTL_MS = 10 * 60 * 1000;
let cache: { expires: number; thin: Set<string> } | null = null;

export async function loadThinNarrowCategories(): Promise<Set<string>> {
  if (cache && cache.expires > Date.now()) return cache.thin;
  const narrowSlugs = CATEGORIES.filter((c) => c.tecdocVehicle).map((c) => c.slug);
  const result = await pool.query(
    `SELECT pc.category_id AS slug, COUNT(DISTINCT (UPPER(COALESCE(p.brand, '')), p.article))::int AS n
       FROM product_categories pc
       JOIN products p ON p.id = pc.product_id AND p.is_active
      WHERE pc.category_id = ANY($1::text[])
      GROUP BY pc.category_id`,
    [narrowSlugs]
  );
  const counts = new Map<string, number>(result.rows.map((row) => [row.slug as string, row.n as number]));
  const thin = new Set(narrowSlugs.filter((slug) => (counts.get(slug) ?? 0) < MIN_NARROW_PRODUCTS));
  cache = { expires: Date.now() + TTL_MS, thin };
  return thin;
}

// Куда вести 301 с тонкой узкой страницы: родительская категория, а если
// её нет — широкая категория по названию ("Пружини підвіски Mazda 6 GG"
// -> "Пружини підвіски"), в крайнем случае — общий каталог
export function narrowRedirectTarget(category: CategoryDef): string {
  if (category.parentCategorySlug) return `/category/${category.parentCategorySlug}`;
  const broad = CATEGORIES.find(
    (c) => !c.tecdocVehicle && !c.modelGroup && !c.parentCategorySlug && categoryMatchesName(c, category.name)
  );
  return broad ? `/category/${broad.slug}` : '/category';
}
