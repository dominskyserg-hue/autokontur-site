// ============================================================
// Отчёт по этапу 3 (новые категории) — ТОЛЬКО ЧТЕНИЕ: пересчёт с
// включённым этапом 3 в транзакции + ROLLBACK, в базу ничего не пишется.
//
//   CATEGORIES_STAGE3=1 node --env-file=.env.local --import tsx scripts/category-review/build-stage3.mts
//
// Пишет scripts/category-review/stage3.md:
//   а) категории и подкатегории: товаров всего / в наличии;
//   б) 40 случайных товаров на категорию, 15 — на подкатегорию;
//   в) поиск "чужих" слов в новых категориях (доля + примеры);
//   г) переезды из существующих категорий;
//   д) сколько остаётся без категории в наличии;
//   е) хлебные крошки: у скольких товаров меняется категория в крошках.
// ============================================================

import fs from 'fs';
import pg from 'pg';

if (process.env.CATEGORIES_STAGE3 !== '1') throw new Error('Запускать с CATEGORIES_STAGE3=1');

const { CATEGORIES, getCategoryBySlug, detectCategoryForProductName } = await import('../../lib/categories.ts');
const { STAGE3_CATEGORIES } = await import('../../lib/categoriesStage3.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { pickBreadcrumbCategory } = await import('../../lib/productCategoryLookup.ts');
const { buildCleanProductName } = await import('../../lib/productNameCleanup.ts');

const nameOf = (slug: string) => getCategoryBySlug(slug)?.name ?? slug;
const NEW = (STAGE3_CATEGORIES as Array<{ slug: string; parentCategorySlug?: string }>).map((c) => c.slug);
const NEW_TOP = (STAGE3_CATEGORIES as Array<{ slug: string; parentCategorySlug?: string }>).filter((c) => !c.parentCategorySlug).map((c) => c.slug);

// "Чужие" слова: [подпись, регулярка по названию в нижнем регистре]
type Sus = [string, RegExp];
const GLOBAL: Sus[] = [
  ['масло моторное', /(моторн\S* (масл|олив))|((масл|олив)\S* моторн)/],
  ['щетка стеклоочистителя', /(щетк|щітк)\S* (стеклоочист|склоочис)|дворник|двірник/],
  ['лампа', /\bламп/],
];
const PER: Record<string, Sus[]> = {
  'detali-dvyhuna': [['EGR', /egr|рециркул/], ['сальник', /сальник/], ['прокладка', /прокладк/], ['тормоз/суппорт', /гальм|тормоз|супорт|суппорт/], ['КПП/АКПП', /кпп/], ['руль/ГУР', /\bгур\b|рулев|рульов|кермов/], ['кондиционер/компрессор', /кондиц|компрес/], ['ТНВД/топливо', /тнвд|палив|топлив/], ['поршневые кольца', /(кільц|кольц)\S* поршн|поршнев\S* (кільц|кольц)/], ['турбина', /турбін|турбин/], ['сцепление', /зчеплен|сцеплен/], ['датчик', /датчик|сенсор/], ['шкив', /шків|шкив/], ['зеркало', /дзеркал|зеркал/]],
  'datchyky': [['кондиционер', /кондиц/], ['колодки/износ', /колодк|колодок|зносу|износа/], ['клапан', /клапан/], ['реле', /\bреле\b/], ['выключатель', /вимикач|выключател/], ['проводка/разъём', /кабел|провод|джгут|разъ[её]м|роз.єм|фишк|фішк/], ['кронштейн/крепление', /кронштейн|кріплен|креплен|клипс|кліпс/]],
  'halmivna-systema': [['колодки (не датчик)', /колодк/], ['диск', /диск/], ['КПП/лента', /кпп|стрічк|лента/], ['сцепление', /зчеплен|сцеплен/], ['дроссель', /дросел|дроссел/], ['радиатор', /радіатор|радиатор/], ['ступица', /ступиц|маточин/], ['дверь/капот/багажник', /двер|капот|багажн|лючк/], ['пыльник', /пильов|пильник|пыльник/]],
  'turbiny': [['фильтр', /фільтр|фильтр/], ['датчик', /датчик|сенсор/], ['прокладка/кольцо', /прокладк|кільц|кольц/], ['охлаждение', /охолодж|охлажд/], ['вакуум', /вакуум/]],
  'stiiky-stabilizatora': [['втулка', /втулк/], ['рулевая', /рульов|рулев|кермов/], ['сайлентблок', /сайлент|с\/бл/], ['амортизатор', /амортиз/], ['пыльник', /пильов|пильник|пыльник/]],
  'datchyky-abs': [['коленвал/распредвал', /колінвал|коленвал|розподіл|распред/]],
  'datchyky-polozhennya-kolinvala': [['ABS', /\babs\b|\bабс\b/]],
  'lyambda-zondy': [['NOx', /nox|nох/], ['температура', /температур/]],
  'datchyky-temperatury': [['кондиционер', /кондиц/], ['давление', /тиск|давлен/]],
  'datchyky-tysku-masla': [['топливо', /палив|топлив/], ['уровень', /рівн|уровн/]],
  'vytratomiry-povitrya': [['давление', /тиск|давлен/]],
  'datchyky-tysku-map': [['масло', /масл|олив/], ['топливо', /палив|топлив/]],
  'datchyky-rivnya-palyva': [['вода', /вод/], ['масло', /масл|олив/]],
};

const READ = `SELECT p.id, p.name, (p.stock > 0) AS instock,
    COALESCE(array_agg(pc.category_id ORDER BY pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`;
type Row = { id: string; name: string; instock: boolean; cats: string[] };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
let before: Row[], after: Row[];
let ms = 0;
try {
  before = (await client.query(READ)).rows;
  await client.query('BEGIN');
  ms = (await recomputeInTransaction(client, { kind: 'all' })).ms;
  after = (await client.query(READ)).rows;
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

const lines: string[] = [];
const out = (s = '') => lines.push(s);
const esc = (s: string) => (s ?? '').replace(/\|/g, '/').slice(0, 140);
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

out('# Этап 3 — новые категории (отчёт, в базу ничего не записано)');
out();
out(`Полный пересчёт с этапом 3: ${Math.round(ms / 1000)} с.`);

// а) Категории
out('\n## а) Категории и подкатегории: товаров всего / в наличии\n');
out('| Категория | Всего | В наличии |');
out('|---|---:|---:|');
const members = new Map<string, Row[]>();
for (const r of after) for (const c of r.cats) { if (!members.has(c)) members.set(c, []); members.get(c)!.push(r); }
for (const slug of NEW) {
  const m = members.get(slug) ?? [];
  const isSub = Boolean(getCategoryBySlug(slug)?.parentCategorySlug);
  out(`| ${isSub ? '— ' : '**'}${nameOf(slug)}${isSub ? '' : '**'} | ${m.length} | ${m.filter((r) => r.instock).length} |`);
}

// в) Чужие слова
out('\n## в) Автопроверка: «чужие» слова в новых категориях\n');
out('Доля — от всех товаров категории.\n');
out('| Категория | Слово | Товаров | Доля | Примеры |');
out('|---|---|---:|---:|---|');
const susRows: Array<[number, string]> = [];
for (const slug of NEW) {
  const m = members.get(slug) ?? [];
  const checks = [...(PER[slug] ?? []), ...GLOBAL];
  for (const [word, re] of checks) {
    const hits = m.filter((r) => re.test((r.name ?? '').toLowerCase().replace(/ё/g, 'е')));
    if (!hits.length) continue;
    const share = hits.length / m.length;
    susRows.push([share, `| ${nameOf(slug)} | ${word} | ${hits.length} | ${(100 * share).toFixed(2)}% | ${shuffle(hits).slice(0, 3).map((h) => esc(h.name)).join(' ¦ ')} |`]);
  }
}
for (const [, row] of susRows.sort((a, b) => b[0] - a[0])) out(row);

// г) Переезды из существующих категорий
const beforeById = new Map(before.map((r) => [r.id, r.cats]));
const moves = new Map<string, string[]>();
const additions = new Map<string, string[]>();
const gained = new Map<string, number>();
let uncatBefore = 0, uncatAfter = 0;
for (const r of after) {
  const b = beforeById.get(r.id) ?? [];
  if (r.instock && b.length === 0) uncatBefore++;
  if (r.instock && r.cats.length === 0) uncatAfter++;
  const removed = b.filter((c) => !r.cats.includes(c));
  const added = r.cats.filter((c) => !b.includes(c));
  if (b.length === 0) { for (const c of added) if (!getCategoryBySlug(c)?.parentCategorySlug) gained.set(c, (gained.get(c) ?? 0) + 1); continue; }
  const addedTop = added.filter((c) => !getCategoryBySlug(c)?.parentCategorySlug);
  if (removed.length) {
    const key = `${removed.map(nameOf).join(' + ')} → ${addedTop.map(nameOf).join(' + ') || 'без категории'}`;
    if (!moves.has(key)) moves.set(key, []);
    moves.get(key)!.push(r.name);
  } else if (addedTop.length) {
    const key = `${b.filter((c) => !getCategoryBySlug(c)?.parentCategorySlug).map(nameOf).join(' + ')} + ${addedTop.map(nameOf).join(' + ')}`;
    if (!additions.has(key)) additions.set(key, []);
    additions.get(key)!.push(r.name);
  }
}
out('\n## г) Переезды из существующих категорий\n');
out('Товар УХОДИТ из старой категории. Почти все — датчики: после этапа 3 сам датчик лежит только в «Датчики» (или в «Гальмівна система» / «Опалення і клімат»).\n');
out('| Было → стало | Товаров | Примеры |');
out('|---|---:|---|');
for (const [k, v] of [...moves].sort((a, b) => b[1].length - a[1].length)) out(`| ${k} | ${v.length} | ${shuffle(v).slice(0, 3).map(esc).join(' ¦ ')} |`);
out(`\nИтого переезжает: ${[...moves.values()].reduce((s, v) => s + v.length, 0)} товаров.`);
out('\n### Добавление второй категории (из старой не уходит)\n');
out('| Старая + новая | Товаров | Примеры |');
out('|---|---:|---|');
for (const [k, v] of [...additions].sort((a, b) => b[1].length - a[1].length)) out(`| ${k} | ${v.length} | ${shuffle(v).slice(0, 3).map(esc).join(' ¦ ')} |`);

// д) Без категории
out('\n## д) Без категории в наличии\n');
out(`Было ${uncatBefore}, станет ${uncatAfter} (−${uncatBefore - uncatAfter}).\n`);
out('| Новая категория | Товаров без категории получили её |');
out('|---|---:|');
for (const [k, v] of [...gained].sort((a, b) => b[1] - a[1])) out(`| ${nameOf(k)} | ${v} |`);

// е) Крошки
let crumbSame = 0, crumbLost = 0, crumbNew = 0;
const crumbChanged = new Map<string, number>();
for (const r of after) {
  const old = pickBreadcrumbCategory(beforeById.get(r.id) ?? []) ?? detectCategoryForProductName(buildCleanProductName(r.name));
  const now = pickBreadcrumbCategory(r.cats) ?? detectCategoryForProductName(buildCleanProductName(r.name));
  if (old?.slug === now?.slug) { crumbSame++; continue; }
  if (!now) { crumbLost++; continue; }
  if (!old) { crumbNew++; continue; }
  const k = `${old.name} → ${now.name}`;
  crumbChanged.set(k, (crumbChanged.get(k) ?? 0) + 1);
}
out('\n## е) Хлебные крошки товара\n');
out(`Без изменений: ${crumbSame}; появилась категория: ${crumbNew}; **потеряли категорию: ${crumbLost}**; сменилась: ${[...crumbChanged.values()].reduce((s, v) => s + v, 0)}.\n`);
for (const [k, v] of [...crumbChanged].sort((a, b) => b[1] - a[1]).slice(0, 25)) out(`- ${k}: ${v}`);

// б) Случайные товары
out('\n## б) Случайные товары\n');
for (const slug of NEW) {
  const m = members.get(slug) ?? [];
  const n = NEW_TOP.includes(slug) ? 40 : 15;
  out(`\n### ${nameOf(slug)} (${n} из ${m.length})\n`);
  for (const r of shuffle(m).slice(0, n)) out(`- ${esc(r.name)}${r.instock ? '' : ' _(нет в наличии)_'}`);
}

fs.writeFileSync('scripts/category-review/stage3.md', lines.join('\n') + '\n');
console.log(lines.slice(0, lines.findIndex((l) => l.startsWith('## б)'))).join('\n'));
void CATEGORIES;
