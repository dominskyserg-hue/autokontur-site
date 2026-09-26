// ============================================================
// Проверка перед переключением хлебных крошек товара и хабов моделей
// на таблицу product_categories — ТОЛЬКО ЧТЕНИЕ.
// Для каждого активного товара сравнивает категорию в крошках:
//   старая — detectCategoryForProductName (слова в очищенном названии);
//   новая  — pickBreadcrumbCategory (из product_categories), а если там
//            пусто — старый способ (так же, как в lib/productDetail.ts).
//
//   node --env-file=.env.local --import tsx scripts/category-review/check-breadcrumbs.mts
// ============================================================

import pg from 'pg';

const { detectCategoryForProductName, getCategoryBySlug } = await import('../../lib/categories.ts');
const { pickBreadcrumbCategory } = await import('../../lib/productCategoryLookup.ts');
const { buildCleanProductName } = await import('../../lib/productNameCleanup.ts');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const rows = (
  await pool.query(`SELECT p.id, p.name, COALESCE(array_agg(pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats
    FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`)
).rows as Array<{ id: string; name: string | null; cats: string[] }>;

let same = 0, gained = 0, none = 0;
const lost: Array<[string, string]> = [];
const changed = new Map<string, Array<string>>();
for (const r of rows) {
  const before = detectCategoryForProductName(buildCleanProductName(r.name))?.slug;
  // Как в lib/productDetail.ts: таблица, запасной вариант — старый способ
  const after = (pickBreadcrumbCategory(r.cats) ?? detectCategoryForProductName(buildCleanProductName(r.name)))?.slug;
  if (before === after) { if (before) same++; else none++; continue; }
  if (!after) { lost.push([before!, r.name ?? '']); continue; }
  if (!before) { gained++; continue; }
  const key = `${getCategoryBySlug(before)?.name} → ${getCategoryBySlug(after)?.name}`;
  if (!changed.has(key)) changed.set(key, []);
  changed.get(key)!.push(r.name ?? '');
}
console.log({ total: rows.length, same, gained, lost: lost.length, changed: [...changed.values()].reduce((s, v) => s + v.length, 0), none });
for (const [cat, name] of lost.slice(0, 30)) console.log('ПОТЕРЯ', getCategoryBySlug(cat)?.name, '|', name);
for (const [key, names] of [...changed].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`СМЕНА ${names.length} | ${key} | ${names.slice(0, 3).join(' ¦ ')}`);
}
await pool.end();
