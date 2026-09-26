// ============================================================
// "Гальмівні колодки передні/задні" до/після onlyWithinParent — ТОЛЬКО ЧТЕНИЕ
// (пересчёт в транзакции + ROLLBACK). Показывает, сколько товаров было и
// стало, что убрано и куда убранные товары попали.
//
//   node --env-file=.env.local --import tsx scripts/category-review/check-brake-subcats.mts
// ============================================================

import pg from 'pg';

const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const SLUGS = ['halmivni-kolodky-peredni', 'halmivni-kolodky-zadni'];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

const READ = `SELECT pc.category_id, p.id, p.name, (p.stock > 0) AS instock
  FROM product_categories pc JOIN products p ON p.id = pc.product_id
  WHERE p.is_active AND pc.category_id = ANY($1)`;
const OTHER = `SELECT product_id, array_agg(category_id) AS cats FROM product_categories WHERE product_id = ANY($1::uuid[]) GROUP BY 1`;

const client = await pool.connect();
try {
  const before = (await client.query(READ, [SLUGS])).rows;
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' });
  const after = (await client.query(READ, [SLUGS])).rows;
  for (const slug of SLUGS) {
    const b = before.filter((r) => r.category_id === slug);
    const a = after.filter((r) => r.category_id === slug);
    const aIds = new Set(a.map((r) => r.id));
    const removed = b.filter((r) => !aIds.has(r.id));
    const added = a.filter((r) => !new Set(b.map((x) => x.id)).has(r.id));
    console.log(`\n${slug}: было ${b.length} (в наличии ${b.filter((r) => r.instock).length}), стало ${a.length} (в наличии ${a.filter((r) => r.instock).length}); убрано ${removed.length}, добавлено ${added.length}`);
    const groups = new Map<string, string[]>();
    for (const r of removed) {
      const n = (r.name ?? '').toLowerCase();
      const g = /датчик|сенсор|індикатор|индикатор/.test(n) ? 'датчики износа' : /трос/.test(n) ? 'тросы' : 'прочее';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r.name);
    }
    for (const [g, names] of groups) console.log(`  ${g}: ${names.length} | ${names.slice(0, 4).join(' ¦ ')}`);
    const other = (await client.query(OTHER, [removed.map((r) => r.id)])).rows;
    const where = new Map<string, number>();
    for (const o of other) for (const c of o.cats) where.set(c, (where.get(c) ?? 0) + 1);
    console.log(`  убранные теперь в категориях: ${JSON.stringify(Object.fromEntries(where))}, без категории: ${removed.length - other.length}`);
    for (const r of removed.filter((x) => /прочее/.test('') || !/датчик|сенсор|індикатор|индикатор|трос/i.test(x.name ?? ''))) console.log('   прочее:', r.name);
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
