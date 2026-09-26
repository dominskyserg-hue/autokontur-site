// ============================================================
// Что изменит полный пересчёт по ТЕКУЩИМ правилам в коде по сравнению с
// тем, что сейчас записано в product_categories — ТОЛЬКО ЧТЕНИЕ
// (пересчёт в транзакции + ROLLBACK). Только активные товары.
//
//   node --env-file=.env.local --import tsx scripts/category-review/diff-recompute.mts [примеров=5]
// ============================================================

import pg from 'pg';

const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { getCategoryBySlug } = await import('../../lib/categories.ts');
const EXAMPLES = Number(process.argv[2] ?? 5);
const nameOf = (slug: string) => getCategoryBySlug(slug)?.name ?? slug;

const READ = `SELECT p.id, p.name, (p.stock > 0) AS instock,
    COALESCE(array_agg(pc.category_id ORDER BY pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats
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
const add = (m: Map<string, string[]>, k: string, v: string) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };
const gained = new Map<string, string[]>(); // категория → товары, у которых раньше не было ни одной
const lost = new Map<string, string[]>(); // категория → товары, оставшиеся совсем без категории
const moved = new Map<string, string[]>(); // "было → стало"
let uncatBefore = 0, uncatAfter = 0;
for (const r of after) {
  const b = beforeById.get(r.id) ?? [];
  if (r.instock && b.length === 0) uncatBefore++;
  if (r.instock && r.cats.length === 0) uncatAfter++;
  const removed = b.filter((c) => !r.cats.includes(c));
  const added = r.cats.filter((c) => !b.includes(c));
  if (b.length === 0 && added.length) { for (const c of added) add(gained, c, r.name); continue; }
  if (r.cats.length === 0 && removed.length) { for (const c of removed) add(lost, c, r.name); continue; }
  if (removed.length || added.length) {
    add(moved, `${removed.map(nameOf).join(' + ') || '—'} → ${added.map(nameOf).join(' + ') || '(только убрано)'}`, r.name);
  }
}
const print = (title: string, m: Map<string, string[]>, label = nameOf) => {
  const total = new Set([...m.values()].flat()).size;
  console.log(`\n## ${title}: ${[...m.values()].reduce((s, v) => s + v.length, 0)} назначений`);
  for (const [k, v] of [...m].sort((a, b) => b[1].length - a[1].length)) console.log(`${v.length} | ${label(k)} | ${v.slice(0, EXAMPLES).join(' ¦ ')}`);
  return total;
};
print('Получили категорию (раньше не было ни одной)', gained);
print('Потеряли категорию совсем', lost);
print('Смена/добавление категорий', moved, (k) => k);
console.log(`\nБез категории в наличии: было ${uncatBefore}, стало ${uncatAfter}`);
