// ============================================================
// КАТЕГОРИЯ ТОВАРА ДЛЯ ХЛЕБНЫХ КРОШЕК И ХАБОВ МОДЕЛЕЙ
// ============================================================
// Берётся из таблицы product_categories (lib/categoryAssignment.ts) — тот
// же набор, что и на страницах категорий. Раньше крошки угадывали
// категорию по словам в названии отдельно (detectCategoryForProductName),
// и товар мог лежать в одной категории, а в крошках показывать другую.
//
// У товара может быть несколько категорий — в крошки идёт ОДНА: первая
// широкая категория по CATEGORY_PRIORITY_ORDER (тот же порядок, что у
// detectCategoryForProductName). Если товар есть только в подкатегории —
// её родительский раздел
// ============================================================

import type { Pool } from 'pg';
import { CATEGORY_PRIORITY_ORDER, getCategoryBySlug, type CategoryDef } from '@/lib/categories';

// Место широкой категории в CATEGORY_PRIORITY_ORDER (меньше — важнее;
// новые категории этапа 3 — первыми, см. lib/categories.ts)
const TOP_LEVEL_ORDER = new Map(CATEGORY_PRIORITY_ORDER.filter((c) => !c.parentCategorySlug).map((c, i) => [c.slug, i]));

export function pickBreadcrumbCategory(slugs: readonly string[]): CategoryDef | undefined {
  let best: string | undefined;
  for (const slug of slugs) {
    if (!TOP_LEVEL_ORDER.has(slug)) continue;
    if (best === undefined || TOP_LEVEL_ORDER.get(slug)! < TOP_LEVEL_ORDER.get(best)!) best = slug;
  }
  if (best) return getCategoryBySlug(best);

  // Только подкатегории — берём родителя первой из них по порядку списка
  const parents = slugs
    .map((slug) => getCategoryBySlug(slug)?.parentCategorySlug)
    .filter((slug): slug is string => Boolean(slug) && TOP_LEVEL_ORDER.has(slug as string));
  return parents.length > 0 ? pickBreadcrumbCategory(parents) : undefined;
}

// Категории для крошек сразу для многих товаров (хаб модели) — одним запросом
export async function loadBreadcrumbCategories(pool: Pool, productIds: string[]): Promise<Map<string, CategoryDef>> {
  const result = new Map<string, CategoryDef>();
  if (productIds.length === 0) return result;
  const rows = await pool.query<{ product_id: string; slugs: string[] }>(
    `SELECT product_id, array_agg(category_id) AS slugs
     FROM product_categories WHERE product_id = ANY($1::uuid[]) GROUP BY product_id`,
    [productIds]
  );
  for (const row of rows.rows) {
    const category = pickBreadcrumbCategory(row.slugs);
    if (category) result.set(row.product_id, category);
  }
  return result;
}
