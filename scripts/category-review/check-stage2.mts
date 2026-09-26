// ============================================================
// Автопроверка этапа 2 — ТОЛЬКО ЧТЕНИЕ (пересчёт в транзакции + ROLLBACK).
// Среди НОВЫХ назначений каждой категории ищет товары со словами, явно
// указывающими на другую категорию ("фара" в "Опалення і клімат" и т.п.).
//
//   node --env-file=.env.local --import tsx scripts/category-review/check-stage2.mts
// ============================================================

import fs from 'fs';
import pg from 'pg';

const { CATEGORIES } = await import('../../lib/categories.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const nameOf = new Map((CATEGORIES as Array<{ slug: string; name: string }>).map((c) => [c.slug, c.name]));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// Подозрительные слова: [подпись, регулярка по названию в нижнем регистре, исключение-регулярка?]
type Sus = [string, RegExp, RegExp?];
const GLOBAL: Sus[] = [
  ['масло моторное', /(моторн\S* (масл|олив))|((масл|олив)\S* моторн)/],
  ['щетка стеклоочистителя', /(щетк|щітк)\S* (стеклоочист|склоочис)|дворник|двірник/],
  ['лампа', /\bламп/],
  ['датчик', /датчик|сенсор/],
];
const PER: Record<string, Sus[]> = {
  'opalennya-klimat': [['фара', /\bфар[аиы]\b/], ['амортизатор', /амортиз/], ['колодк', /колодк/], ['ступиц', /ступиц|маточин/], ['ШРУС', /шрус|шркш/], ['рычаг', /рычаг|важіл/], ['генератор', /генератор/], ['стартер', /стартер/], ['ГРМ', /грм/]],
  'transmisiya-kpp': [['компрессор кондиционера', /компре\S* кондиц|кондиц/], ['радиатор', /радиатор|радіатор/], ['фара', /\bфар[аиы]\b/], ['тормоз', /тормоз|гальм/], ['колодк', /колодк/], ['амортизатор', /амортиз/], ['рулев', /рулев|рульов|кермов/]],
  'prokladky-dvyhuna': [['полуось', /полуос|піввіс/], ['КПП/АКПП', /кпп/], ['ступиц', /ступиц|маточин/], ['форсунк', /форсун/], ['ГУР', /\bгур\b|гидроусил|гідропідс/], ['компрессор', /компре/]],
  'kermove-upravlinnya': [['кардан (не рулевой колонки)', /кардан/, /колонк|рулев|рульов|кермов/], ['ШРУС', /шрус|шркш/], ['полуось', /полуос|піввіс/], ['тормоз', /тормоз|гальм/]],
  'polyklynovi-remeni-rolyky': [['ГРМ', /грм/], ['цепь', /цеп[ьи]|ланцюг/], ['зубчатый', /зубчат|зубчаст/]],
  'remeni-rolyky-grm-komplekty': [['генератор', /генератор/], ['кондиционер', /кондиц/], ['ГУР', /\bгур\b/], ['поликлиновый', /поликлин|полікл/], ['ручейковый', /ручейк/]],
  // Добавленные пары
  'systema-oholodzhennya': [['кондиционер', /кондиц/], ['печка/отопитель', /печк|пічк|отопит|опален/], ['масляный', /масл|олив/], ['ГУР', /\bгур\b/]],
  'kriplennya-kronshteiny': [['амортизатор', /амортиз/], ['стабилизатор', /стабил|стабіл/]],
  'pidshypnyky-matochyny': [['ШРУС/полуось', /шрус|шркш|полуос|піввіс/], ['тормозной диск', /диск\S* (тормоз|гальм)|(тормоз|гальм)\S* диск/]],
  'vazheli-pidvisky': [['сайлентблок', /сайлент|с\/бл|с-бл/], ['стабилизатор', /стабил|стабіл/], ['КПП/стеклоочиститель', /кпп|стеклоочист|склоочис/]],
  'amortyzatory': [['опора/отбойник/пыльник', /опор|отбойн|відбійн|пыльн|пильн/], ['капот/багажник', /капот|багажн/]],
  'palyvna-systema': [['омыватель', /омыват|омивач/], ['масляный', /масл|олив/]],
  'kuzov-detali': [['амортизатор (упор капота)', /амортиз/]],
  'generatory-startery': [['ремень', /ремень |ремінь |пасок/]],
  'remeni-rolyky-grm': [['двери/стекла/сиденья', /двер|стекл|скла|сиден|сидін/]],
};

const READ = `SELECT p.id, p.name, COALESCE(array_agg(pc.category_id) FILTER (WHERE pc.category_id IS NOT NULL), '{}') AS cats
  FROM products p LEFT JOIN product_categories pc ON pc.product_id = p.id WHERE p.is_active GROUP BY p.id`;
const client = await pool.connect();
let before: Array<{ id: string; name: string; cats: string[] }>, after: typeof before;
try {
  before = (await client.query(READ)).rows;
  await client.query('BEGIN');
  await recomputeInTransaction(client, { kind: 'all' }, { extraRules: true });
  after = (await client.query(READ)).rows;
} finally {
  await client.query('ROLLBACK');
  client.release();
}
const beforeCats = new Map(before.map((r) => [r.id, new Set(r.cats)]));
const newBy = new Map<string, Array<{ name: string }>>();
for (const r of after) for (const c of r.cats) if (!beforeCats.get(r.id)!.has(c)) { if (!newBy.has(c)) newBy.set(c, []); newBy.get(c)!.push(r); }

const out: Array<{ cat: string; word: string; n: number; total: number; ex: string[] }> = [];
for (const [cat, rows] of newBy) {
  const checks = [...(PER[cat] ?? []), ...GLOBAL.filter(([w]) => !(cat === 'opalennya-klimat' && w === 'датчик'))];
  for (const [word, re, except] of checks) {
    const hits = rows.filter((r) => { const n = (r.name || '').toLowerCase().replace(/ё/g, 'е'); return re.test(n) && !(except && except.test(n)); });
    if (hits.length) out.push({ cat, word, n: hits.length, total: rows.length, ex: hits.slice(0, 3).map((h) => h.name.slice(0, 80)) });
  }
}
out.sort((a, b) => b.n / b.total - a.n / a.total);
fs.writeFileSync(process.argv[2] ?? 'scripts/category-review/check-stage2.json', JSON.stringify(out, null, 1));
for (const o of out) console.log(`${(100 * o.n / o.total).toFixed(2)}% | ${nameOf.get(o.cat)} | ${o.word} | ${o.n} из ${o.total} | ${o.ex.join(' ¦ ')}`);
await pool.end();
