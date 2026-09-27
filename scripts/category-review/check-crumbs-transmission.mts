// ============================================================
// Крошки прокладок и колец АКПП/КПП/CVT → «Трансмісія і КПП» — ТОЛЬКО ЧТЕНИЕ
// (пересчёт в транзакции + ROLLBACK). Сравнивает категорию в крошках:
//   было — записанные сейчас категории + прежний порядок (legacy);
//   стало — пересчёт по текущим правилам + новый порядок.
//
//   node --env-file=.env.local --import tsx scripts/category-review/check-crumbs-transmission.mts
// ============================================================

import pg from 'pg';

const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { pickBreadcrumbCategory } = await import('../../lib/productCategoryLookup.ts');
const { detectCategoryForProductName } = await import('../../lib/categories.ts');
const { buildCleanProductName } = await import('../../lib/productNameCleanup.ts');

const READ = `SELECT p.id, p.name, (p.stock > 0) AS instock,
    COALESCE(array_agg(pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`;
type Row = { id: string; name: string; instock: boolean; cats: string[] };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
let before: Row[], after: Row[];
try {
  before = (await client.query(READ)).rows;
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' });
  after = (await client.query(READ)).rows;
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

const beforeById = new Map(before.map((r) => [r.id, r.cats]));
const fallback = (r: Row) => detectCategoryForProductName(buildCleanProductName(r.name));
const changed = new Map<string, Row[]>();
let lost = 0, addedToTransmission = 0;
for (const r of after) {
  const b = beforeById.get(r.id) ?? [];
  if (!b.includes('transmisiya-kpp') && r.cats.includes('transmisiya-kpp')) addedToTransmission++;
  const old = pickBreadcrumbCategory(b, { legacy: true }) ?? fallback(r);
  const now = pickBreadcrumbCategory(r.cats) ?? fallback(r);
  if (old?.slug === now?.slug) continue;
  if (!now) { lost++; continue; }
  const k = `${old?.name ?? '—'} → ${now.name}`;
  if (!changed.has(k)) changed.set(k, []);
  changed.get(k)!.push(r);
}
console.log(`Новых товаров в «Трансмісія і КПП» (CVT/варіатор): ${addedToTransmission}`);
console.log(`Потеряли категорию в крошках: ${lost}`);
for (const [k, rows] of [...changed].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${k}: ${rows.length} (в наличии ${rows.filter((r) => r.instock).length})`);
  for (const r of rows.sort(() => Math.random() - 0.5).slice(0, 12)) console.log(`  - ${r.name}`);
}
