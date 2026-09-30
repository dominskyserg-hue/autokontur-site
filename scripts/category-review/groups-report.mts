// ============================================================
// Отчёт "до/после" по группам бренд+артикул (lib/productGroups.ts) —
// ТОЛЬКО ЧТЕНИЕ: пересчёт категорий с группами в транзакции + ROLLBACK.
//
//   PRODUCT_GROUPS=1 node --env-file=.env.local --import tsx scripts/category-review/groups-report.mts
//
// Пишет scripts/category-review/groups.md:
//   а) итог: групп, лишних адресов, сколько уходит из списков и sitemap;
//   б) категории: товаров до → групп после (всего / в наличии);
//   в) скорость страниц категорий до/после (время запроса в базе);
//   г) sitemap: адресов до/после;
//   д) 4 примера из Search Console: главная, canonical двойников, H1,
//      "Також відомий як", AggregateOffer.
// ============================================================

import fs from 'fs';
import pg from 'pg';

if (process.env.PRODUCT_GROUPS !== '1') throw new Error('Запускать с PRODUCT_GROUPS=1');

const { CATEGORIES, buildCategoryWhereClause } = await import('../../lib/categories.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { groupedListSql, groupedOrderBy } = await import('../../lib/productGroups.ts');
const { buildPopularOrderBy } = await import('../../lib/popularitySort.ts');
const { buildProductPath } = await import('../../lib/slug.ts');

const lines: string[] = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();

const TOP = (CATEGORIES as Array<{ slug: string; name: string; parentCategorySlug?: string; modelGroup?: string; catalogVehicle?: unknown }>)
  .filter((c) => !c.modelGroup && !c.catalogVehicle);
const COUNT_SQL = (grouped: boolean) => `SELECT pc.category_id, count(*)::int n, count(*) FILTER (WHERE ${grouped ? 'b.stock' : 'p.stock'} > 0)::int s
  FROM product_categories pc JOIN products p ON p.id = pc.product_id
  ${grouped ? 'JOIN products b ON b.id = COALESCE(p.group_best_offer_id, p.id)' : ''}
  WHERE p.is_active ${grouped ? 'AND p.is_group_primary' : ''} GROUP BY 1`;

// Время запроса первой страницы категории (как на сайте) — в базе, без сети
async function pageMs(slug: string, grouped: boolean): Promise<number> {
  const category = (CATEGORIES as any[]).find((c) => c.slug === slug);
  const { clause, params } = buildCategoryWhereClause(category, 1);
  const g = groupedListSql();
  const sql = grouped
    ? `SELECT p.id, b.retail_price FROM products p ${g.join} JOIN suppliers s ON s.id = b.supplier_id WHERE ${clause} AND ${g.where} ${groupedOrderBy(buildPopularOrderBy([]))} LIMIT 24`
    : `SELECT p.id, p.retail_price FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause} ${buildPopularOrderBy([])} LIMIT 24`;
  const countSql = grouped
    ? `SELECT count(*) FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause} AND ${g.where}`
    : `SELECT count(*) FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`;
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const a = (await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params)).rows[0]['QUERY PLAN'][0]['Execution Time'];
    const b = (await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${countSql}`, params)).rows[0]['QUERY PLAN'][0]['Execution Time'];
    best = Math.min(best, a + b);
  }
  return Math.round(best);
}

try {
  // ---- ДО ----
  const before = new Map((await client.query(COUNT_SQL(false))).rows.map((r) => [r.category_id, r]));
  const speedSlugs = ['prokladky-dvyhuna', 'transmisiya-kpp', 'halmivni-kolodky', 'datchyky', 'opory-pylovyky-amortyzatoriv', 'oliyni-filtry'];
  const speedBefore = new Map<string, number>();
  for (const s of speedSlugs) speedBefore.set(s, await pageMs(s, false));
  const smBefore = (await client.query(`SELECT count(*) FILTER (WHERE stock > 0)::int s, count(*) FILTER (WHERE stock <= 0 AND stock_zero_since > now() - interval '90 days')::int o FROM products WHERE is_active`)).rows[0];

  // ---- ПОСЛЕ (в транзакции: пересчёт категорий с объединением по группам) ----
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' });
  const after = new Map((await client.query(COUNT_SQL(true))).rows.map((r) => [r.category_id, r]));
  const speedAfter = new Map<string, number>();
  for (const s of speedSlugs) speedAfter.set(s, await pageMs(s, true));
  const smAfter = (await client.query(`SELECT
      count(*) FILTER (WHERE (stock > 0 OR EXISTS (SELECT 1 FROM products t WHERE t.group_primary_id = products.id AND t.is_active AND t.stock > 0)))::int s,
      count(*) FILTER (WHERE NOT (stock > 0 OR EXISTS (SELECT 1 FROM products t WHERE t.group_primary_id = products.id AND t.is_active AND t.stock > 0))
                       AND stock_zero_since > now() - interval '90 days')::int o
    FROM products WHERE is_active AND is_group_primary`)).rows[0];
  const totals = (await client.query(`SELECT count(*) FILTER (WHERE group_primary_id = id)::int groups,
      count(*) FILTER (WHERE NOT is_group_primary)::int twins, count(*) FILTER (WHERE group_primary_id IS NOT NULL)::int members
    FROM products WHERE is_active`)).rows[0];

  out('# Группы бренд+артикул — отчёт «до/после» (в базу ничего не записано)\n');
  out('## а) Итог\n');
  out(`Групп: **${totals.groups}**, товаров в них ${totals.members}. Двойников (уходят из списков и sitemap, остаются доступны по адресу с canonical на главную): **${totals.twins}**.\n`);

  out('## б) Категории: товаров до → групп после\n');
  out('| Категория | До (в наличии) | После, групп (в наличии) | Разница |');
  out('|---|---:|---:|---:|');
  for (const c of TOP.filter((c) => !c.parentCategorySlug)) {
    const b = before.get(c.slug) ?? { n: 0, s: 0 };
    const a = after.get(c.slug) ?? { n: 0, s: 0 };
    out(`| ${c.name} | ${b.n} (${b.s}) | ${a.n} (${a.s}) | ${a.n - b.n} |`);
  }

  out('\n## в) Скорость страницы категории (запрос первой страницы + счётчик, в базе)\n');
  out('| Категория | До, мс | После, мс |');
  out('|---|---:|---:|');
  for (const s of speedSlugs) out(`| ${s} | ${speedBefore.get(s)} | ${speedAfter.get(s)} |`);

  out('\n## г) Sitemap (товары)\n');
  out(`| | До | После |\n|---|---:|---:|\n| В наличии | ${smBefore.s} | ${smAfter.s} |\n| Нет в наличии (< 90 дней) | ${smBefore.o} | ${smAfter.o} |\n| Всего | ${smBefore.s + smBefore.o} | ${smAfter.s + smAfter.o} |`);

  out('\n## д) Примеры из Search Console\n');
  for (const id of ['9f98f7a3-44b0-48b7-a874-2ec50c054aa4', 'c1ee0375-4f38-49af-b149-1ed4339b9b9f', 'b0d94556-48da-4498-a28c-63b6fc2625f9', '00c9fb2e-6aec-42e3-986d-c4c9eedf3475']) {
    const rows = (await client.query(`SELECT q.id, q.brand, q.article, q.name, q.stock, q.retail_price, q.created_at, q.is_group_primary, q.group_primary_id,
        q.group_display_name, q.group_other_names, q.group_offer_count, q.group_best_offer_id
      FROM products p JOIN products q ON q.article = p.article AND upper(q.brand) = upper(p.brand) AND q.is_active
      WHERE p.id = $1 ORDER BY q.created_at, q.id`, [id])).rows;
    const primary = rows.find((r) => r.is_group_primary);
    const primaryPath = buildProductPath(primary.id, primary);
    out(`### ${primary.brand} ${primary.article}\n`);
    out(`- Главная: \`${primaryPath}\` (самая старая, заведена ${new Date(primary.created_at).toISOString().slice(0, 10)})`);
    out(`- H1 главной строится из: «${primary.group_display_name}»`);
    out(`- «Також відомий як: ${(primary.group_other_names ?? []).join('; ')}»`);
    const prices = rows.map((r) => parseFloat(r.retail_price));
    out(`- AggregateOffer: lowPrice ${Math.ceil(Math.min(...prices))}, highPrice ${Math.ceil(Math.max(...prices))}, offerCount ${rows.length}, ${rows.some((r) => r.stock > 0) ? 'InStock' : 'BackOrder'} (без персональных цен)`);
    out(`- Лучшее предложение (цена и «Купити» в списках): ${rows.find((r) => r.id === primary.group_best_offer_id)?.retail_price} грн`);
    for (const r of rows) {
      const path = buildProductPath(r.id, r);
      out(`  - ${r.id === id ? '**(из Search Console)** ' : ''}${r.is_group_primary ? 'главная' : 'двойник'}: «${r.name}», ${r.retail_price} грн, склад ${r.stock} → canonical \`${r.is_group_primary ? path : primaryPath}\``);
    }
    out();
  }
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
fs.writeFileSync('scripts/category-review/groups.md', lines.join('\n') + '\n');
