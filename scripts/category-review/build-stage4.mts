// ============================================================
// Отчёт по этапу 4 — ТОЛЬКО ЧТЕНИЕ: пересчёт с включённым этапом 4 в
// транзакции + ROLLBACK, в базу ничего не пишется.
//
//   CATEGORIES_STAGE4=1 node --env-file=.env.local --import tsx scripts/category-review/build-stage4.mts
//
// Пишет scripts/category-review/stage4.md:
//   а) все категории: сколько добавится и сколько станет (всего / в наличии);
//   б) часть Б: сколько товаров получили категорию по каждому сочетанию;
//   в) поиск «чужих» слов в новых категориях;
//   г) переезды из существующих категорий и добавление второй категории;
//   д) без категории в наличии + топ-20 слов среди оставшихся;
//   е) хлебные крошки;
//   ж) по 40 случайных товаров на новую категорию и на каждое сочетание части Б.
// ============================================================

import fs from 'fs';
import pg from 'pg';

if (process.env.CATEGORIES_STAGE4 !== '1') throw new Error('Запускать с CATEGORIES_STAGE4=1');

const { CATEGORIES, getCategoryBySlug, detectCategoryForProductName } = await import('../../lib/categories.ts');
const { STAGE4_CATEGORIES } = await import('../../lib/categoriesStage4.ts');
const { EXTRA_CATEGORY_RULES } = await import('../../lib/categoryRulesExtra.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { pickBreadcrumbCategory } = await import('../../lib/productCategoryLookup.ts');
const { buildCleanProductName } = await import('../../lib/productNameCleanup.ts');

const nameOf = (slug: string) => getCategoryBySlug(slug)?.name ?? slug;
const NEW = (STAGE4_CATEGORIES as Array<{ slug: string }>).map((c) => c.slug);
const X4 = (EXTRA_CATEGORY_RULES as Array<{ id: string; category: string }>).filter((r) => r.id.startsWith('x4-'));

// Сомнительные сочетания (разбор топ-15 неоднозначных слов, см. отчёт)
const DOUBTFUL: Array<[string, string]> = [
  ['Сальник без уточнения («A1/САЛЬНИК», ~4 000), «сальник гумометалевий», «сальник (in/out)»', 'Непонятно, от какого узла'],
  ['Сальник / клапан / заглушка компресора (CARGO, SANTECH)', 'Компрессор кондиционера или пневмосистемы грузовика — по названию не различить'],
  ['Насос ГПК, ремкомплект ГПК, «ремк-т гидравлики» (~1 700)', 'Гидроподъёмник кабины грузовика — нет категории'],
  ['Кришка бачка омивача', 'Не входит в список владельца для «Склоочисники та омивачі»'],
  ['Болт без уточнения, «болт кріплення», «болт підвіски», «болт U-образный ресори»', 'Узел не указан или спорный (подвеска / кузов)'],
  ['Клапан без уточнения, «клапан управління тиском», «пластини клапанні»', 'Непонятно, какой системы'],
  ['Підшипник кульковий / роликовий / ковзання, «підшипник» без уточнения', 'Универсальные подшипники — непонятно, куда'],
  ['Ролик без уточнения («L2/РОЛИК»)', 'Непонятно: ремня, двери или сиденья'],
  ['Втулка розпірна, втулка балки / ресори / радіальної тяги', 'Спорно: подвеска или кузов; для ресор категории нет'],
  ['Шланг вентиляції / вакуумний / водяний / напірний', 'Непонятно, какой системы'],
  ['Подушка безпеки', 'Нет категории (система безопасности)'],
  ['Фільтр очищення картерних газів, фільтр гідравлічний, корпус фільтра', 'Спорно; кол-во небольшое'],
  ['Накладка педалі, накладка без уточнения', 'Салон или кузов — спорно'],
  ['Кришка блоку запобіжників, кришка без уточнения', 'Электрика — нет подходящей категории'],
];

type Sus = [string, RegExp];
const GLOBAL: Sus[] = [['датчик', /^\s*(датчик|сенсор)/]];
const PER: Record<string, Sus[]> = {
  osvitlennya: [['кронштейн/крепление', /кронштейн|кріплен|креплен/], ['стекло/корпус фары', /скло фар|стекло фар|корпус фар/], ['мотор/корректор', /мотор|коректор|корректор/], ['омыватель', /омив|омыв/], ['провод/разъём', /провод|проводк|роз.єм|разъ[её]м|фишк|фішк/], ['кузов', /бампер|капот|крил|крыл/]],
  'pruzhyny-pidvisky': [['амортизатор', /амортиз/], ['клапан/тормоз', /клапан|гальм|тормоз/], ['опора/отбойник', /опор|відбійн|отбойн/], ['рессора', /ресор|рессор/]],
  'shchitky-skloochysnyka': [['стартер/генератор', /стартер|генератор/], ['рычаг', /важіл|рычаг/], ['щётки не для стекла', /печ|пічк|вентилят/], ['жидкость', /рідин|жидк/], ['топливо', /палив|топлив|бензин|дизел/]],
  'opory-pylovyky-amortyzatoriv': [['ШРУС', /шрус|шркш|гранат/], ['рулевое', /рульов|рулев|кермов|рейк/], ['тяга', /тяг/], ['стабилизатор', /стабил|стабіл/], ['двигатель/КПП', /двиг|двс|кпп/], ['капот/багажник/дверь', /капот|багаж|двер|кришк|крышк/], ['кардан', /кардан/], ['шаровая', /шаров|кульов/], ['пружина', /пружин/]],
  'systema-zapaliuvannia': [['свеча', /свіч|свеч/], ['замок зажигания', /замок|личинк|ключ/], ['датчик', /датчик|сенсор/], ['реле', /\bреле\b/]],
  'masla-ridyny': [['моторное', /моторн/], ['фильтр', /фільтр|фильтр/], ['тормозная', /гальм|тормоз/], ['насос/бачок', /насос|бачок/]],
  trosy: [['ручник', /ручн|стояноч/], ['замок', /замок|замк/], ['кронштейн', /кронштейн/]],
};

const READ = `SELECT p.id, p.name, p.name_search, (p.stock > 0) AS instock,
    COALESCE(array_agg(pc.category_id ORDER BY pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats,
    COALESCE(array_agg(pc.rule_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS rules
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`;
type Row = { id: string; name: string; name_search: string; instock: boolean; cats: string[]; rules: string[] };

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
const group = (rows: Row[]) => { const m = new Map<string, Row[]>(); for (const r of rows) for (const c of r.cats) { if (!m.has(c)) m.set(c, []); m.get(c)!.push(r); } return m; };
const membersBefore = group(before);
const membersAfter = group(after);
const beforeById = new Map(before.map((r) => [r.id, r.cats]));

out('# Этап 4 — новые категории и однозначные сочетания (отчёт, в базу ничего не записано)');
out();
out(`Полный пересчёт с этапом 4: ${Math.round(ms / 1000)} с.`);

// а) Все категории: добавится / станет
out('\n## а) Категории: сколько добавится и сколько станет\n');
out('Только категории, где что-то меняется. «Добавится» — товары, которых в категории раньше не было; «уйдёт» — наоборот.\n');
out('| Категория | Было (в наличии) | Добавится | Уйдёт | Станет (в наличии) |');
out('|---|---:|---:|---:|---:|');
for (const c of CATEGORIES as Array<{ slug: string; parentCategorySlug?: string }>) {
  const b = membersBefore.get(c.slug) ?? [];
  const a = membersAfter.get(c.slug) ?? [];
  const bIds = new Set(b.map((r) => r.id));
  const aIds = new Set(a.map((r) => r.id));
  const added = a.filter((r) => !bIds.has(r.id)).length;
  const removed = b.filter((r) => !aIds.has(r.id)).length;
  if (!added && !removed) continue;
  const isNew = NEW.includes(c.slug);
  out(`| ${isNew ? '**' : ''}${nameOf(c.slug)}${isNew ? '** (новая)' : ''} | ${b.length} (${b.filter((r) => r.instock).length}) | +${added} | −${removed} | ${a.length} (${a.filter((r) => r.instock).length}) |`);
}

// б) Часть Б: по сочетаниям
out('\n## б) Часть Б: однозначные сочетания — сколько товаров без категории получили категорию\n');
out('| Правило | Категория | Товаров (в наличии) | Примеры |');
out('|---|---|---:|---|');
const byRule = new Map<string, Row[]>();
for (const r of after) for (const rule of r.rules) if (rule.startsWith('x4-')) { if (!byRule.has(rule)) byRule.set(rule, []); byRule.get(rule)!.push(r); }
for (const rule of X4) {
  const rows = byRule.get(rule.id) ?? [];
  out(`| ${rule.id} | ${nameOf(rule.category)} | ${rows.length} (${rows.filter((r) => r.instock).length}) | ${shuffle(rows).slice(0, 3).map((r) => esc(r.name)).join(' ¦ ')} |`);
}

// б2) Топ-15 неоднозначных слов: топ-10 сочетаний «слово + следующее/предыдущее слово»
// среди товаров без категории в наличии (до этапа 4) и куда они попадают после
out('\n## б2) Часть Б: неоднозначные слова — топ-10 сочетаний и куда они попадают\n');
out('Сочетание — слово + следующее значимое слово (или предыдущее, если слово не первое), корнями. «Куда» — самая частая категория после этапа 4 (доля товаров сочетания).\n');
const TARGETS: Array<[string, RegExp]> = [
  ['сальник', /^сальник/], ['опора', /^опор/], ['болт', /^болт/], ['клапан', /^клапан/], ['підшипник', /^(підшипник|подшипник)/],
  ['ролик', /^ролик/], ['насос', /^насос/], ['фільтр', /^(фільтр|фильтр)/], ['накладка', /^накладк/], ['втулка', /^втулк/],
  ['подушка', /^подушк/], ['ремкомплект', /^(ремкомплект|ремк|р\/к)/], ['кришка', /^(кришк|крышк)/], ['шланг', /^шланг/], ['заглушка', /^заглушк/],
];
const STOP = new Set(['с', 'з', 'для', 'на', 'в', 'и', 'і', 'та', 'к-т', 'кт', 'компл', 'комплект', 'пер', 'зад', 'л', 'п', 'лів', 'прав']);
const afterById = new Map(after.map((r) => [r.id, r.cats]));
const uncatBeforeRows = before.filter((r) => r.instock && r.cats.length === 0);
for (const [title, re] of TARGETS) {
  const combos = new Map<string, Row[]>();
  for (const r of uncatBeforeRows) {
    const words = r.name_search.replace(/^\s*(?:[a-zа-яіїєґ]?\d+\/)*\s*/, '').split(/[^a-zа-яіїєґё/.-]+/).filter(Boolean);
    const i = words.findIndex((w) => re.test(w));
    if (i === -1) continue;
    let other = '';
    if (i === 0) { for (let j = 1; j < words.length && j < 4; j++) if (!STOP.has(words[j]) && /[а-яіїєґ]/.test(words[j]) && words[j].length > 2) { other = words[j]; break; } }
    else other = words[i - 1];
    const stem = other.replace(/(ого|ому|ий|ій|ая|яя|ої|ой|ей|ів|ов|ах|ях|ами|ями|а|я|у|ю|и|і|е|о|ь)$/, '');
    const key = i === 0 ? `${title} + ${stem || '—'}` : `${stem} + ${title}`;
    if (!combos.has(key)) combos.set(key, []);
    combos.get(key)!.push(r);
  }
  out(`\n### ${title}\n`);
  out('| Сочетание | Товаров | Куда после этапа 4 | Пример |');
  out('|---|---:|---|---|');
  for (const [k, rows] of [...combos].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const dest = new Map<string, number>();
    for (const r of rows) {
      const top = (afterById.get(r.id) ?? []).filter((c) => !getCategoryBySlug(c)?.parentCategorySlug);
      const d = top.length ? top.map(nameOf).join(' + ') : 'без категории';
      dest.set(d, (dest.get(d) ?? 0) + 1);
    }
    const [bestDest, n] = [...dest].sort((a, b) => b[1] - a[1])[0];
    out(`| ${k} | ${rows.length} | ${bestDest} (${Math.round((100 * n) / rows.length)}%) | ${esc(rows[0].name).slice(0, 70)} |`);
  }
}

// в) Чужие слова
out('\n## в) Автопроверка: «чужие» слова в новых категориях\n');
out('| Категория | Слово | Товаров | Доля | Примеры |');
out('|---|---|---:|---:|---|');
const sus: Array<[number, string]> = [];
for (const slug of NEW) {
  const m = membersAfter.get(slug) ?? [];
  for (const [word, re] of [...(PER[slug] ?? []), ...GLOBAL]) {
    const hits = m.filter((r) => re.test((r.name ?? '').toLowerCase().replace(/ё/g, 'е')));
    if (!hits.length) continue;
    sus.push([hits.length / m.length, `| ${nameOf(slug)} | ${word} | ${hits.length} | ${((100 * hits.length) / m.length).toFixed(2)}% | ${shuffle(hits).slice(0, 3).map((h) => esc(h.name)).join(' ¦ ')} |`]);
  }
}
for (const [, row] of sus.sort((a, b) => b[0] - a[0])) out(row);

// г) Переезды и вторая категория
const moves = new Map<string, Row[]>();
const additions = new Map<string, Row[]>();
for (const r of after) {
  const b = beforeById.get(r.id) ?? [];
  if (b.length === 0) continue;
  const removed = b.filter((c) => !r.cats.includes(c));
  const addedTop = r.cats.filter((c) => !b.includes(c) && !getCategoryBySlug(c)?.parentCategorySlug);
  const target = removed.length ? moves : addedTop.length ? additions : null;
  if (!target) continue;
  const key = removed.length
    ? `${removed.map(nameOf).join(' + ')} → ${addedTop.map(nameOf).join(' + ') || 'без категории'}`
    : `${b.filter((c) => !getCategoryBySlug(c)?.parentCategorySlug).map(nameOf).join(' + ')} + ${addedTop.map(nameOf).join(' + ')}`;
  if (!target.has(key)) target.set(key, []);
  target.get(key)!.push(r);
}
out('\n## г) Переезды из существующих категорий (товар УХОДИТ из старой)\n');
out('| Было → стало | Товаров | Примеры |');
out('|---|---:|---|');
for (const [k, v] of [...moves].sort((a, b) => b[1].length - a[1].length)) out(`| ${k} | ${v.length} | ${shuffle(v).slice(0, 3).map((r) => esc(r.name)).join(' ¦ ')} |`);
out(`\nИтого переезжает: ${[...moves.values()].reduce((s, v) => s + v.length, 0)}.`);
out('\n### Добавление второй категории (из старой не уходит)\n');
out('| Старая + новая | Товаров | Примеры |');
out('|---|---:|---|');
for (const [k, v] of [...additions].sort((a, b) => b[1].length - a[1].length)) out(`| ${k} | ${v.length} | ${shuffle(v).slice(0, 3).map((r) => esc(r.name)).join(' ¦ ')} |`);

// д) Без категории
const uncatBefore = before.filter((r) => r.instock && r.cats.length === 0).length;
const remaining = after.filter((r) => r.instock && r.cats.length === 0);
out('\n## д) Без категории в наличии\n');
out(`Было ${uncatBefore}, станет ${remaining.length} (−${uncatBefore - remaining.length}).\n`);
const first = new Map<string, number>();
for (const r of remaining) {
  const w = r.name_search.replace(/^\s*(?:[a-zа-яіїєґ]?\d+\/)*\s*/, '').split(/[^a-zа-яіїєґё]+/).find((x) => x.length >= 4);
  if (w) first.set(w, (first.get(w) ?? 0) + 1);
}
out('Топ-20 первых слов среди оставшихся:\n');
out('| Слово | Товаров |');
out('|---|---:|');
for (const [w, n] of [...first].sort((a, b) => b[1] - a[1]).slice(0, 20)) out(`| ${w} | ${n} |`);

// е) Крошки
let lost = 0;
const crumbChanged = new Map<string, number>();
for (const r of after) {
  const fallback = () => detectCategoryForProductName(buildCleanProductName(r.name));
  const old = pickBreadcrumbCategory(beforeById.get(r.id) ?? []) ?? fallback();
  const now = pickBreadcrumbCategory(r.cats) ?? fallback();
  if (old?.slug === now?.slug) continue;
  if (!now) { lost++; continue; }
  const k = `${old?.name ?? '—'} → ${now.name}`;
  crumbChanged.set(k, (crumbChanged.get(k) ?? 0) + 1);
}
out('\n## е) Хлебные крошки товара\n');
out(`**Потеряли категорию: ${lost}**; сменилась: ${[...crumbChanged.values()].reduce((s, v) => s + v, 0)} (в т.ч. «— →» — у товара появилась категория).\n`);
for (const [k, v] of [...crumbChanged].sort((a, b) => b[1] - a[1]).slice(0, 30)) out(`- ${k}: ${v}`);

// з) Сомнительные сочетания части Б — оставлены без категории (решение за владельцем)
out('\n## з) Часть Б: сомнительные сочетания — оставлены без категории\n');
out('| Сочетание | Почему не добавлено / что предлагаю |');
out('|---|---|');
for (const [combo, why] of DOUBTFUL) out(`| ${combo} | ${why} |`);

// ж) Выборки
out('\n## ж) Случайные товары (по 40)\n');
for (const slug of NEW) {
  const m = membersAfter.get(slug) ?? [];
  out(`\n### ${nameOf(slug)} (40 из ${m.length})\n`);
  for (const r of shuffle(m).slice(0, 40)) out(`- ${esc(r.name)}${r.instock ? '' : ' _(нет в наличии)_'}`);
}
out('\n### Часть Б — все сочетания вместе (40 случайных)\n');
for (const r of shuffle([...byRule.values()].flat()).slice(0, 40)) out(`- ${esc(r.name)} → ${nameOf(r.cats.find((c) => !getCategoryBySlug(c)?.parentCategorySlug) ?? r.cats[0])}`);

fs.writeFileSync('scripts/category-review/stage4.md', lines.join('\n') + '\n');
console.log(lines.slice(0, lines.findIndex((l) => l.startsWith('## ж)'))).join('\n'));
