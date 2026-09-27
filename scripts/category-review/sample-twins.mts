// ============================================================
// 100 случайных товаров, получивших категорию «по двойнику» (строгий
// вариант) — для ручной сверки типа детали. ТОЛЬКО ЧТЕНИЕ (ROLLBACK).
//
//   CATEGORIES_STAGE5=1 node --env-file=.env.local --import tsx scripts/category-review/sample-twins.mts
// ============================================================

import pg from 'pg';

const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { getCategoryBySlug } = await import('../../lib/categories.ts');
const { twinIsSamePart } = await import('../../lib/twinMatch.ts');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' });
  const total = (await client.query(`SELECT count(DISTINCT pc.product_id)::int n, count(DISTINCT pc.product_id) FILTER (WHERE p.stock > 0)::int s
    FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE pc.rule_id = 'twin' AND p.is_active`)).rows[0];
  console.log(`По двойнику (строгий вариант): ${total.n} товаров, в наличии ${total.s}\n`);
  const rows = (await client.query(`
    SELECT p.id, p.name, p.name_search, array_agg(DISTINCT pc.category_id) cats
    FROM product_categories pc JOIN products p ON p.id = pc.product_id
    WHERE pc.rule_id = 'twin' AND p.is_active AND p.stock > 0
    GROUP BY p.id ORDER BY random() LIMIT 100`)).rows;
  let i = 0;
  for (const r of rows) {
    // Двойники, по которым товар получил категорию (прошедшие проверку «та же деталь»)
    const twins = (await client.query(`SELECT q.name, q.name_search FROM products q JOIN products l ON l.id = $1
      WHERE q.article = l.article AND upper(q.brand) = upper(l.brand) AND q.id <> l.id
        AND EXISTS (SELECT 1 FROM product_categories x WHERE x.product_id = q.id AND x.rule_id <> 'twin')`, [r.id])).rows
      .filter((t) => twinIsSamePart(r.name_search, t.name_search));
    const cats = r.cats.filter((c: string) => !getCategoryBySlug(c)?.parentCategorySlug).map((c: string) => getCategoryBySlug(c)?.name ?? c);
    console.log(`${String(++i).padStart(3)}. ${r.name.slice(0, 55)} ← «${(twins[0]?.name ?? '').slice(0, 60)}» → ${cats.join(' + ')}`);
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
