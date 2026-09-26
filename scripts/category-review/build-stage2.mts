// ============================================================
// Отчёт для проверки этапа 2 — ТОЛЬКО ЧТЕНИЕ: полный пересчёт категорий
// с новыми правилами выполняется в транзакции и ОТКАТЫВАЕТСЯ (ROLLBACK),
// в базе ничего не меняется.
//
//   node --env-file=.env.local --import tsx scripts/category-review/build-stage2.mts
//
// Сравнивает текущую таблицу product_categories ("было") с результатом
// пересчёта по новым правилам ("станет": lib/categories.ts +
// lib/categoryRulesExtra.ts) и пишет scripts/category-review/stage2.md
// (+ stage2-all.csv — все товары, у которых меняются категории)
// ============================================================

import fs from 'fs';
import pg from 'pg';

const { CATEGORIES } = await import('../../lib/categories.ts');
const { EXTRA_CATEGORY_RULES, buildExtraRuleCondition } = await import('../../lib/categoryRulesExtra.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');

type Cat = { slug: string; name: string; parentCategorySlug?: string; modelGroup?: string };
const CATS = CATEGORIES as Cat[];
const nameOf = new Map(CATS.map((c) => [c.slug, c.name]));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

type Row = { id: string; brand: string | null; article: string; name: string; stock: number; cats: string[]; rules: string[] };
const READ = `SELECT p.id, p.brand, p.article, p.name, p.stock,
    COALESCE(array_agg(pc.category_id ORDER BY pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats,
    COALESCE(array_agg(pc.rule_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS rules
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id
  WHERE p.is_active GROUP BY p.id`;

const client = await pool.connect();
let before: Row[], after: Row[], multi: Array<{ r: Row; cats: string[] }> = [];
try {
  before = (await client.query(READ)).rows;
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' }, { extraRules: true });
  after = (await client.query(READ)).rows;
  // Подошли под 2+ категорий по доп. правилам (среди товаров, получивших категорию доп. правилом)
  const params: unknown[] = []; const cases: string[] = [];
  for (const rule of EXTRA_CATEGORY_RULES) {
    const { sql, params: p } = buildExtraRuleCondition(rule, params.length + 1);
    params.push(...p);
    cases.push(`CASE WHEN ${sql} THEN '${rule.category}' END`);
  }
  const m = (await client.query(
    `SELECT p.id, array_remove(ARRAY[${cases.join(', ')}], NULL) AS cats FROM products p
     WHERE p.is_active AND EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.rule_id LIKE 'x-%')`,
    params
  )).rows as Array<{ id: string; cats: string[] }>;
  const byId = new Map(after.map((r) => [r.id, r]));
  // Пара "подкатегория + её раздел" — не конфликт (товар и так будет в обоих):
  // сравниваем по "корню" — разделу для общих подкатегорий
  const root = (slug: string) => { const c = CATS.find((x) => x.slug === slug); return c?.parentCategorySlug && !c.modelGroup ? c.parentCategorySlug : slug; };
  multi = m
    .map((x) => ({ r: byId.get(x.id)!, cats: [...new Set(x.cats)] }))
    .filter((x) => new Set(x.cats.map(root)).size > 1);
} finally {
  await client.query('ROLLBACK');
  client.release();
}

const beforeById = new Map(before.map((r) => [r.id, r]));
const count = (rows: Row[]) => { const m = new Map<string, number>(); for (const r of rows) for (const c of r.cats) m.set(c, (m.get(c) || 0) + 1); return m; };
const cntBefore = count(before), cntAfter = count(after);

// Классификация изменений по товарам
const gained: Array<{ r: Row; cat: string }> = []; // было без категории → получил
const moved: Array<{ r: Row; from: string[]; to: string[] }> = []; // потерял категорию, которая была
const extended: Row[] = []; // категория осталась, добавилась ещё (подкатегория/раздел)
for (const r of after) {
  const b = beforeById.get(r.id)!;
  const lost = b.cats.filter((c) => !r.cats.includes(c));
  const added = r.cats.filter((c) => !b.cats.includes(c));
  if (lost.length === 0 && added.length === 0) continue;
  if (b.cats.length === 0) {
    // для статистики "куда попал" берём самую узкую категорию (подкатегорию, если есть)
    const narrow = r.cats.find((c) => CATS.find((x) => x.slug === c)?.parentCategorySlug) ?? r.cats[0];
    gained.push({ r, cat: narrow });
  } else if (lost.length > 0) moved.push({ r, from: b.cats, to: r.cats });
  else extended.push(r);
}
const uncatBefore = before.filter((r) => r.stock > 0 && r.cats.length === 0).length;
const uncatAfter = after.filter((r) => r.stock > 0 && r.cats.length === 0).length;

function sample<T>(list: T[], n: number, seed = 7): T[] {
  const copy = [...list]; let s = seed;
  for (let i = copy.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, n);
}
const esc = (s: string) => (s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const names = (cats: string[]) => cats.map((c) => nameOf.get(c) ?? c).join(' + ') || '—';
function head(name: string): string {
  const w = (name || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-яіїєґ\s-]/g, ' ').split(/\s+/).filter((x) => x.length >= 3);
  return w.slice(0, 2).join(' ') || '(пусто)';
}
function composition(rows: Row[], top = 25): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(head(r.name), (m.get(head(r.name)) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([h, c]) => `${h} — ${c}`).join('; ');
}

let md = `# Этап 2 (версия 2): дополнительные правила категорий — на проверку\n\n`;
md += `Сгенерировано ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Полный пересчёт с новыми правилами выполнен в транзакции и **откачен** — в базе ничего не изменилось. Считаются активные товары (в наличии и под заказ — как на страницах).\n\n`;
md += `Что учтено по решениям владельца: «Прокладки, сальники та кільця двигуна» (только сальники двигателя), раздел «Ремені та ролики» с подкатегориями «Ремені та ролики ГРМ» и «Поліклинові ремені та ролики», датчики давления кондиционера — в «Опалення і клімат», «сцепления» → «Трансмісія і КПП», сальник ступицы → «Підшипники маточини».\n\n`;

md += `## а) Было / станет по категориям\n\n| Категория | Было | Добавится | Уйдёт | Станет |\n|---|---:|---:|---:|---:|\n`;
const allCats = [...new Set([...cntBefore.keys(), ...cntAfter.keys()])];
const addBy = new Map<string, number>(), remBy = new Map<string, number>();
for (const r of after) { const b = beforeById.get(r.id)!; for (const c of r.cats) if (!b.cats.includes(c)) addBy.set(c, (addBy.get(c) || 0) + 1); for (const c of b.cats) if (!r.cats.includes(c)) remBy.set(c, (remBy.get(c) || 0) + 1); }
for (const c of allCats.filter((c) => (addBy.get(c) || 0) + (remBy.get(c) || 0) > 0).sort((a, b) => (addBy.get(b) || 0) - (addBy.get(a) || 0))) {
  md += `| ${nameOf.get(c) ?? c} | ${cntBefore.get(c) ?? 0} | +${addBy.get(c) || 0} | −${remBy.get(c) || 0} | ${cntAfter.get(c) ?? 0} |\n`;
}
md += `\nОстальные категории не меняются.\n\n`;
md += `## д) Без категории (в наличии)\n\nБыло: **${uncatBefore}** → станет: **${uncatAfter}** (получат категорию: ${uncatBefore - uncatAfter}).\n\n`;

md += `## г) Переезды (товар ТЕРЯЕТ категорию, которая у него была): ${moved.length}\n\n`;
md += moved.length > 100 ? `Показаны 100 случайных.\n\n` : `Показаны все.\n\n`;
md += `| Бренд | Артикул | Название | Было | Станет |\n|---|---|---|---|---|\n`;
for (const x of moved.length > 100 ? sample(moved, 100) : moved) md += `| ${esc(x.r.brand || '—')} | ${esc(x.r.article)} | ${esc(x.r.name).slice(0, 90)} | ${names(x.from)} | ${names(x.to)} |\n`;
md += `\nОтдельно: у **${extended.length}** товаров категория сохраняется и ДОБАВЛЯЕТСЯ ещё одна (ГРМ-товары получают подкатегорию «Ремені та ролики ГРМ», товары поликлиновой подкатегории — раздел «Ремені та ролики»). Это не переезд.\n\n`;

md += `## в) Подошли под 2+ категорий по доп. правилам: ${multi.length}\n\nОтнесены по первому правилу (приоритет — порядок в lib/categoryRulesExtra.ts). 30 случайных:\n\n| Бренд | Артикул | Название | Подошли | Итог |\n|---|---|---|---|---|\n`;
for (const x of sample(multi, 30)) md += `| ${esc(x.r.brand || '—')} | ${esc(x.r.article)} | ${esc(x.r.name).slice(0, 80)} | ${names(x.cats)} | **${names(x.r.cats)}** |\n`;

md += `\n## Проверка трёх категорий, о которых ты спрашивал\n\n`;
for (const slug of ['opalennya-klimat', 'transmisiya-kpp', 'generatory-startery']) {
  const now = after.filter((r) => r.cats.includes(slug));
  const was = before.filter((r) => r.cats.includes(slug));
  const newOnes = now.filter((r) => !beforeById.get(r.id)!.cats.includes(slug));
  md += `### ${nameOf.get(slug)}: было ${was.length}, станет ${now.length} (в наличии ${now.filter((r) => r.stock > 0).length})\n\n`;
  md += `- **Что было раньше** (типы по первым словам): ${composition(was, 15)}\n`;
  md += `- **Что добавится**: ${newOnes.length ? composition(newOnes, 25) : '—'}\n\n`;
}

md += `## б) По 40 случайных новых товаров в каждой категории (были без категории)\n\n`;
const byCat = new Map<string, Row[]>();
for (const g of gained) { if (!byCat.has(g.cat)) byCat.set(g.cat, []); byCat.get(g.cat)!.push(g.r); }
for (const [slug, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
  md += `### ${nameOf.get(slug)} (+${list.length})\n\n| Бренд | Артикул | Название | В наличии |\n|---|---|---|---|\n`;
  for (const r of sample(list, 40)) md += `| ${esc(r.brand || '—')} | ${esc(r.article)} | ${esc(r.name).slice(0, 110)} | ${r.stock > 0 ? 'так' : 'ні'} |\n`;
  md += '\n';
}
fs.writeFileSync('scripts/category-review/stage2.md', md);

const csv = ['﻿Тип;Було;Стане;Бренд;Артикул;Назва;В наявності'];
for (const g of gained) csv.push(['нова', '', names(g.r.cats), g.r.brand || '', g.r.article, `"${(g.r.name || '').replace(/"/g, '""')}"`, g.r.stock > 0 ? 'так' : 'ні'].join(';'));
for (const x of moved) csv.push(['переїзд', names(x.from), names(x.to), x.r.brand || '', x.r.article, `"${(x.r.name || '').replace(/"/g, '""')}"`, x.r.stock > 0 ? 'так' : 'ні'].join(';'));
fs.writeFileSync('scripts/category-review/stage2-all.csv', csv.join('\r\n'));

console.log(`получат категорию: ${gained.length}; переезды: ${moved.length}; +подкатегория/раздел: ${extended.length}; 2+ по доп. правилам: ${multi.length}; без категории в наличии: ${uncatBefore} → ${uncatAfter}`);
for (const c of allCats.filter((c) => (addBy.get(c) || 0) + (remBy.get(c) || 0) > 0).sort((a, b) => (addBy.get(b) || 0) - (addBy.get(a) || 0))) console.log(`  ${nameOf.get(c) ?? c}: ${cntBefore.get(c) ?? 0} +${addBy.get(c) || 0} −${remBy.get(c) || 0} = ${cntAfter.get(c) ?? 0}`);
await pool.end();
