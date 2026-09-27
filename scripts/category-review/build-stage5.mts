// ============================================================
// Отчёт по этапу 5 — ТОЛЬКО ЧТЕНИЕ: пересчёт с включённым этапом 5 в
// транзакции + ROLLBACK, в базу ничего не пишется.
//
//   CATEGORIES_STAGE5=1 node --env-file=.env.local --import tsx scripts/category-review/build-stage5.mts
//
// Пишет scripts/category-review/stage5.md:
//   а) итог: сколько получили категорию правилами (сальники/болты), по двойнику, по кроссу;
//   б) по двойнику/кроссу: в какие категории, сколько, пропущено из-за противоречий;
//   в) проверка двойников: собственное название товара указывает на ДРУГУЮ категорию;
//   г) «чужие» первые слова: чем начинаются названия товаров, получивших категорию по двойнику;
//   д) правила сальников и болтов: сколько и примеры;
//   е) переезды (должно быть 0 — этап 5 трогает только товары без категории), крошки;
//   ж) без категории в наличии + топ-20 первых слов;
//   з) по 40 случайных товаров «по двойнику» на каждую крупную категорию (с названием двойника).
// ============================================================

import fs from 'fs';
import pg from 'pg';

if (process.env.CATEGORIES_STAGE5 !== '1') throw new Error('Запускать с CATEGORIES_STAGE5=1');

const { getCategoryBySlug, detectCategoryForProductName } = await import('../../lib/categories.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { pickBreadcrumbCategory } = await import('../../lib/productCategoryLookup.ts');
const { buildCleanProductName } = await import('../../lib/productNameCleanup.ts');

const nameOf = (slug: string) => getCategoryBySlug(slug)?.name ?? slug;
const isTop = (slug: string) => !getCategoryBySlug(slug)?.parentCategorySlug;

const READ = `SELECT p.id, p.name, p.name_search, p.brand, p.article, (p.stock > 0) AS instock,
    COALESCE(array_agg(pc.category_id ORDER BY pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats,
    COALESCE(array_agg(pc.rule_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS rules
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`;
type Row = { id: string; name: string; name_search: string; brand: string; article: string; instock: boolean; cats: string[]; rules: string[] };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
let before: Row[], after: Row[];
let ms = 0;
let twinNames = new Map<string, string>();
let conflicts = 0;
try {
  before = (await client.query(READ)).rows;
  await client.query('BEGIN');
  ms = (await recomputeInTransaction(client, { kind: 'all' })).ms;
  after = (await client.query(READ)).rows;
  // Название двойника (или аналога по кроссу) — для проверки глазами
  const tn = await client.query(`SELECT DISTINCT ON (pc.product_id) pc.product_id, coalesce(
      (SELECT q.name FROM products q JOIN product_categories x ON x.product_id = q.id AND x.rule_id NOT IN ('twin','cross')
        WHERE q.article = p.article AND upper(q.brand) = upper(p.brand) AND q.id <> p.id LIMIT 1),
      (SELECT q.name FROM tecdoc_crosses tc JOIN products q ON q.article = tc.article_b AND upper(q.brand) = upper(tc.brand_b)
        JOIN product_categories x ON x.product_id = q.id AND x.rule_id NOT IN ('twin','cross')
        WHERE tc.article_a = p.article AND upper(tc.brand_a) = upper(p.brand) LIMIT 1)) AS twin
    FROM product_categories pc JOIN products p ON p.id = pc.product_id WHERE pc.rule_id IN ('twin','cross') AND p.is_active`);
  twinNames = new Map(tn.rows.map((r) => [r.product_id, r.twin ?? '']));
  // Сколько товаров без категории имели двойников, но пропущены из-за противоречий (>2 широких категорий)
  conflicts = (await client.query(`SELECT count(DISTINCT p.id)::int n FROM products p
    WHERE p.is_active AND NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)
      AND EXISTS (SELECT 1 FROM products q JOIN product_categories x ON x.product_id = q.id
                  WHERE q.article = p.article AND upper(q.brand) = upper(p.brand) AND q.id <> p.id)`)).rows[0].n;
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

const lines: string[] = [];
const out = (s = '') => lines.push(s);
const esc = (s: string) => (s ?? '').replace(/\|/g, '/').slice(0, 110);
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const beforeById = new Map(before.map((r) => [r.id, r]));
const firstWord = (r: Row) => r.name_search.replace(/^\s*(?:[a-zа-яіїєґ]?\d+\/)*\s*/, '').split(/[^a-zа-яіїєґё]+/).find((x) => x.length >= 3) ?? '—';

// Кто как получил категорию (только товары, у которых раньше не было ни одной)
const gainedBy = { rule: [] as Row[], twin: [] as Row[], cross: [] as Row[] };
for (const r of after) {
  if ((beforeById.get(r.id)?.cats.length ?? 0) > 0 || r.cats.length === 0) continue;
  if (r.rules.some((x) => x.startsWith('x5-'))) gainedBy.rule.push(r);
  else if (r.rules.includes('twin')) gainedBy.twin.push(r);
  else if (r.rules.includes('cross')) gainedBy.cross.push(r);
}
const inStock = (rows: Row[]) => rows.filter((r) => r.instock).length;

out('# Этап 5 — сальники и болты по сочетаниям + категория «по двойнику» (отчёт, в базу ничего не записано)');
out();
out(`Полный пересчёт с этапом 5: ${Math.round(ms / 1000)} с.`);
out('\n## а) Итог\n');
out('| Способ | Получили категорию | В наличии |');
out('|---|---:|---:|');
out(`| Правила сальников и болтов (x5-*) | ${gainedBy.rule.length} | ${inStock(gainedBy.rule)} |`);
out(`| По двойнику (тот же бренд + артикул у другого поставщика) | ${gainedBy.twin.length} | ${inStock(gainedBy.twin)} |`);
out(`| По кроссу TecDoc (двойника нет) | ${gainedBy.cross.length} | ${inStock(gainedBy.cross)} |`);
out(`\nПропущено из-за противоречий (двойник есть, но двойники дают больше 2 разных широких категорий): ${conflicts} товаров (все, не только в наличии).`);

// б) По двойнику: категории
const twinRows = [...gainedBy.twin, ...gainedBy.cross];
const byCat = new Map<string, Row[]>();
for (const r of twinRows) for (const c of r.cats.filter(isTop)) { if (!byCat.has(c)) byCat.set(c, []); byCat.get(c)!.push(r); }
out('\n## б) По двойнику и кроссу: в какие категории\n');
out('| Категория | Товаров | В наличии | Пример: товар ← двойник |');
out('|---|---:|---:|---|');
for (const [c, rows] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
  const ex = rows[0];
  out(`| ${nameOf(c)} | ${rows.length} | ${inStock(rows)} | ${esc(ex.name).slice(0, 40)} ← ${esc(twinNames.get(ex.id) ?? '').slice(0, 60)} |`);
}
const twoCats = twinRows.filter((r) => r.cats.filter(isTop).length === 2).length;
out(`\nТоваров с двумя широкими категориями от двойников: ${twoCats}.`);

// в) Противоречие: собственное название указывает на другую категорию
const contra = new Map<string, Row[]>();
for (const r of twinRows) {
  const own = detectCategoryForProductName(buildCleanProductName(r.name));
  const tops = r.cats.filter(isTop);
  if (own && !tops.includes(own.slug)) {
    const k = `своё название: ${own.name} → по двойнику: ${tops.map(nameOf).join(' + ')}`;
    if (!contra.has(k)) contra.set(k, []);
    contra.get(k)!.push(r);
  }
}
const contraTotal = [...contra.values()].reduce((s, v) => s + v.length, 0);
out('\n## в) Проверка: собственное название товара указывает на другую категорию\n');
out(`Всего: ${contraTotal} из ${twinRows.length} (${((100 * contraTotal) / Math.max(twinRows.length, 1)).toFixed(2)}%).\n`);
out('| Противоречие | Товаров | Примеры: товар ← двойник |');
out('|---|---:|---|');
for (const [k, v] of [...contra].sort((a, b) => b[1].length - a[1].length).slice(0, 25)) {
  out(`| ${k} | ${v.length} | ${shuffle(v).slice(0, 2).map((r) => `${esc(r.name).slice(0, 45)} ← ${esc(twinNames.get(r.id) ?? '').slice(0, 45)}`).join(' ¦ ')} |`);
}

// в2) Главная проверка: тип детали (первое слово) товара и двойника не совпадает.
// Одинаковые по смыслу слова (рус./укр., синонимы) сводим к одной группе
const SAME: string[][] = [
  ['подшип', 'підшип'], ['рычаг', 'ричаг', 'важіл', 'важел'], ['тяга', 'тяжк', 'тяги'], ['втулк', 'резинк', 'подушк'], ['сальн', 'манже', 'ущіль', 'уплот', 'кольц', 'кільц'],
  ['прокл', 'прокладан'], ['натяж', 'натяг', 'ролик', 'гидронат'], ['цепь', 'цепи', 'ланцю'], ['ремен', 'ремін', 'ремня', 'пас'], ['шкив', 'шків'], ['масл', 'олив', 'олія', 'олій'],
  ['амор', 'ам', 'тор'], ['датчи', 'давач', 'сенсо'], ['выклю', 'вимик', 'включ', 'перем'], ['крышк', 'кришк'], ['клапа'], ['болт', 'гвинт', 'винт'], ['гайк', 'гайка'],
  ['ремк', 'ремко', 'р/к', 'комплект', 'к-т', 'набір', 'набор'], ['фильт', 'фільт'], ['стойк', 'стійк'], ['опор', 'опорн'], ['пыльн', 'пильн', 'пильо', 'чехол', 'чохол'],
];
const groupOf = (w: string) => { const g = SAME.findIndex((list) => list.some((x) => w.startsWith(x))); return g === -1 ? w.slice(0, 4) : `g${g}`; };
const twinFirst = (name: string) => (name ?? '').toLowerCase().replace(/^\s*(?:[a-zа-яіїєґ]?\d+\/)*\s*/, '').split(/[^a-zа-яіїєґё]+/).find((x) => x.length >= 3) ?? '—';
const mismatch = new Map<string, Row[]>();
let checked = 0;
for (const r of twinRows) {
  const own = firstWord(r);
  const tw = twinFirst(twinNames.get(r.id) ?? '');
  if (own === '—' || tw === '—') continue;
  checked++;
  if (groupOf(own) === groupOf(tw)) continue;
  const k = `${own} ← ${tw}`;
  if (!mismatch.has(k)) mismatch.set(k, []);
  mismatch.get(k)!.push(r);
}
const mismatchTotal = [...mismatch.values()].reduce((s, v) => s + v.length, 0);
out('\n## в2) Проверка: тип детали товара ≠ тип детали двойника\n');
out(`Сравнивается первое слово названия товара и двойника (русские/украинские варианты и синонимы считаются одним словом). Не совпало: **${mismatchTotal} из ${checked} (${((100 * mismatchTotal) / Math.max(checked, 1)).toFixed(1)}%)**.\n`);
out('| Товар ← двойник (первые слова) | Товаров | Категория | Примеры: товар ← двойник |');
out('|---|---:|---|---|');
for (const [k, v] of [...mismatch].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
  out(`| ${k} | ${v.length} | ${nameOf(v[0].cats.find(isTop) ?? '')} | ${shuffle(v).slice(0, 2).map((r) => `${esc(r.name).slice(0, 45)} ← ${esc(twinNames.get(r.id) ?? '').slice(0, 45)}`).join(' ¦ ')} |`);
}

// в3) Строгий вариант: двойник принимается, только если тип детали совпадает
// (с расширенными синонимами) или собственное название ничего не говорит
const SAME_STRICT: string[][] = [
  ['подшип', 'підшип', 'радіал', 'упорн', 'ступиц', 'маточ'], ['компрес', 'колес'], ['сопло', 'геомет'], ['шарн', 'шрус', 'шркш'],
  ['сальн', 'маслок', 'маслос', 'манже', 'ущіль', 'уплот', 'кольц', 'кільц', 'шайб', 'прокл', 'герметик'],
  ['рычаг', 'ричаг', 'важіл', 'важел', 'тяга', 'тяжк', 'тяги'], ['втулк', 'резинк', 'подушк', 'сайлент', 'с/бл'],
  ['натяж', 'натяг', 'ролик', 'гидронат', 'направл', 'успоко', 'заспок', 'цепь', 'цепи', 'ланцю'], ['ремен', 'ремін', 'ремня', 'пас'], ['шкив', 'шків'],
  ['масл', 'олив', 'олія', 'олій'], ['амор', 'ам', 'тор', 'стійк', 'стойк'], ['датчи', 'давач', 'сенсо'], ['выклю', 'вимик', 'включ', 'перем'],
  ['крышк', 'кришк'], ['клапа'], ['болт', 'гвинт', 'винт'], ['гайк'], ['фильт', 'фільт'], ['опор', 'опорн'], ['пыльн', 'пильн', 'пильо', 'чехол', 'чохол'],
  ['мотор', 'насос', 'електродв', 'электродв'], ['випрям', 'діодн', 'диодн'], ['кріпл', 'кронш', 'крепл'], ['щетк', 'щітк', 'стеклоочист', 'склоочис'],
  ['провод', 'провід', 'дріт', 'свечн', 'свічн'], ['колод'],
];
const GENERIC_OWN = ['ходова', 'акция', 'акція', 'комплект', 'набір', 'набор', 'запчаст', 'деталь', 'елемент', 'элемент', 'ремк', 'ремкомплект'];
const groupStrict = (w: string) => { const g = SAME_STRICT.findIndex((list) => list.some((x) => w.startsWith(x))); return g === -1 ? w.slice(0, 4) : `g${g}`; };
const strictDropped = new Map<string, Row[]>();
const strictKept: Row[] = [];
for (const r of twinRows) {
  const own = firstWord(r);
  const tw = twinFirst(twinNames.get(r.id) ?? '');
  const ok = own === '—' || tw === '—' || /^[a-zа-яіїєґ]?\d/.test(own) || GENERIC_OWN.some((g) => own.startsWith(g)) || groupStrict(own) === groupStrict(tw)
    || (twinNames.get(r.id) ?? '').toLowerCase().includes(own.slice(0, 5));
  if (ok) { strictKept.push(r); continue; }
  const k = `${own} ← ${tw}`;
  if (!strictDropped.has(k)) strictDropped.set(k, []);
  strictDropped.get(k)!.push(r);
}
const droppedTotal = twinRows.length - strictKept.length;
out('\n## в3) Строгий вариант: двойник принимается, только если тип детали совпадает\n');
out(`Совпадение — с расширенными синонимами (колесо/компресорне, шрус/шарнір, сальник/маслоколпачки/кільце/шайба…), либо собственное название пустое/общее («W4/ХОДОВАЯ», «Комплект»), либо первое слово товара есть в названии двойника.\n`);
out(`Строгий вариант оставляет **${strictKept.length}** (в наличии ${inStock(strictKept)}), отбрасывает **${droppedTotal}** (в наличии ${twinRows.length - strictKept.length - (inStock(twinRows) - inStock(strictKept)) >= 0 ? inStock(twinRows) - inStock(strictKept) : 0}).\n`);
const keptTwin = strictKept.filter((r) => r.rules.includes('twin'));
const keptCross = strictKept.filter((r) => !r.rules.includes('twin'));
out(`Из оставленных: по двойнику ${keptTwin.length} (в наличии ${inStock(keptTwin)}), по кроссу ${keptCross.length} (в наличии ${inStock(keptCross)}).\n`);
out('Что отбрасывается (топ-40):\n');
out('| Товар ← двойник | Товаров | Категория двойника | Примеры |');
out('|---|---:|---|---|');
for (const [k, v] of [...strictDropped].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
  out(`| ${k} | ${v.length} | ${nameOf(v[0].cats.find(isTop) ?? '')} | ${shuffle(v).slice(0, 2).map((r) => `${esc(r.name).slice(0, 45)} ← ${esc(twinNames.get(r.id) ?? '').slice(0, 45)}`).join(' ¦ ')} |`);
}

// г) Чем начинаются названия товаров, получивших категорию по двойнику — по категориям
out('\n## г) Первые слова товаров «по двойнику» — по категориям (поиск «чужих»)\n');
out('Доля — от всех товаров «по двойнику» в этой категории. Если первое слово явно из другой категории — это «чужой».\n');
out('| Категория | Первые слова (товаров) |');
out('|---|---|');
for (const [c, rows] of [...byCat].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(firstWord(r), (m.get(firstWord(r)) ?? 0) + 1);
  out(`| ${nameOf(c)} (${rows.length}) | ${[...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => `${w} ${n} (${((100 * n) / rows.length).toFixed(1)}%)`).join(', ')} |`);
}

// д) Правила сальников и болтов
out('\n## д) Правила сальников и болтов\n');
out('| Правило | Категория | Товаров (в наличии) | Примеры |');
out('|---|---|---:|---|');
const byRule = new Map<string, Row[]>();
for (const r of gainedBy.rule) for (const x of r.rules) if (x.startsWith('x5-')) { if (!byRule.has(x)) byRule.set(x, []); byRule.get(x)!.push(r); }
for (const [rule, rows] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  out(`| ${rule} | ${nameOf(rows[0].cats.find(isTop) ?? rows[0].cats[0])} | ${rows.length} (${inStock(rows)}) | ${shuffle(rows).slice(0, 3).map((r) => esc(r.name).slice(0, 60)).join(' ¦ ')} |`);
}

// е) Переезды и крошки
let moved = 0, lost = 0, crumbChanged = 0;
for (const r of after) {
  const b = beforeById.get(r.id)?.cats ?? [];
  if (b.some((c) => !r.cats.includes(c))) moved++;
  const fb = () => detectCategoryForProductName(buildCleanProductName(r.name));
  const old = pickBreadcrumbCategory(b) ?? fb();
  const now = pickBreadcrumbCategory(r.cats) ?? fb();
  if (old?.slug !== now?.slug) { if (!now) lost++; else crumbChanged++; }
}
out('\n## е) Переезды и крошки\n');
out(`Товаров, ушедших из старой категории: ${moved}. Крошки: потеряли категорию — **${lost}**, сменилась или появилась — ${crumbChanged}.`);

// ж) Без категории
const uncatBefore = before.filter((r) => r.instock && r.cats.length === 0).length;
const remaining = after.filter((r) => r.instock && r.cats.length === 0);
out('\n## ж) Без категории в наличии\n');
out(`Было ${uncatBefore}, станет ${remaining.length} (−${uncatBefore - remaining.length}).\n`);
const fw = new Map<string, number>();
for (const r of remaining) fw.set(firstWord(r), (fw.get(firstWord(r)) ?? 0) + 1);
out('| Первое слово | Товаров |');
out('|---|---:|');
for (const [w, n] of [...fw].sort((a, b) => b[1] - a[1]).slice(0, 20)) out(`| ${w} | ${n} |`);

// з) Выборки
out('\n## з) Случайные товары «по двойнику» (по 40 на категорию, топ-10 категорий)\n');
for (const [c, rows] of [...byCat].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
  out(`\n### ${nameOf(c)} (40 из ${rows.length})\n`);
  for (const r of shuffle(rows).slice(0, 40)) out(`- ${esc(r.name)} ← «${esc(twinNames.get(r.id) ?? '')}»${r.rules.includes('cross') ? ' _(кросс)_' : ''}`);
}

fs.writeFileSync('scripts/category-review/stage5.md', lines.join('\n') + '\n');
console.log(lines.slice(0, lines.findIndex((l) => l.startsWith('## з)'))).join('\n'));
