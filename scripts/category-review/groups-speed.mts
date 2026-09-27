// ============================================================
// Скорость страницы категории (первая страница + счётчик, время в базе
// через EXPLAIN ANALYZE, лучшее из 3) в трёх вариантах:
//   до групп        — все товары, без группировки;
//   с соединением   — лучшее предложение группы соединением таблицы с собой;
//   готовые поля    — лучшее предложение из полей group_best_* главной.
// ТОЛЬКО ЧТЕНИЕ.
//   node --env-file=.env.local --import tsx scripts/category-review/groups-speed.mts
// ============================================================

import pg from 'pg';

const { CATEGORIES, buildCategoryWhereClause } = await import('../../lib/categories.ts');
const { groupedListSql, groupedOrderBy } = await import('../../lib/productGroups.ts');
const { buildPopularOrderBy } = await import('../../lib/popularitySort.ts');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const SLUGS = ['prokladky-dvyhuna', 'transmisiya-kpp', 'detali-dvyhuna', 'halmivni-kolodky', 'datchyky', 'opory-pylovyky-amortyzatoriv', 'oliyni-filtry'];
const order = buildPopularOrderBy([]);
const g = groupedListSql();

const variants: Record<string, (clause: string) => [string, string]> = {
  'до групп': (clause) => [
    `SELECT p.id, p.retail_price FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause} ${order} LIMIT 24`,
    `SELECT count(*) FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`,
  ],
  'с соединением': (clause) => [
    `SELECT p.id, b.retail_price FROM products p JOIN products b ON b.id = COALESCE(p.group_best_offer_id, p.id) JOIN suppliers s ON s.id = b.supplier_id
     WHERE ${clause} AND p.is_group_primary ${order.replace(/\(p\.stock > 0\)/g, '(b.stock > 0)').replace(/p\.retail_price/g, 'b.retail_price')} LIMIT 24`,
    `SELECT count(*) FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause} AND p.is_group_primary`,
  ],
  'готовые поля': (clause) => [
    `SELECT p.id, b.retail_price FROM products p ${g.join} JOIN suppliers s ON s.id = b.supplier_id WHERE ${clause} AND ${g.where} ${groupedOrderBy(order)} LIMIT 24`,
    `SELECT count(*) FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause} AND ${g.where}`,
  ],
};

const ms = async (sql: string, params: unknown[]) =>
  (await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params)).rows[0]['QUERY PLAN'][0]['Execution Time'] as number;

console.log(`| Категория | ${Object.keys(variants).join(' | ')} |`);
console.log(`|---|${Object.keys(variants).map(() => '---:').join('|')}|`);
for (const slug of SLUGS) {
  const category = (CATEGORIES as any[]).find((c) => c.slug === slug);
  const { clause, params } = buildCategoryWhereClause(category, 1);
  const cells: string[] = [];
  for (const build of Object.values(variants)) {
    const [page, count] = build(clause);
    let best = Infinity;
    for (let i = 0; i < 3; i++) best = Math.min(best, (await ms(page, params)) + (await ms(count, params)));
    cells.push(String(Math.round(best)));
  }
  console.log(`| ${slug} | ${cells.join(' | ')} |`);
}
await pool.end();
