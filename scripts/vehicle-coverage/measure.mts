// ============================================================
// Переход с TecDoc на собственные данные, этап 1 — ЗАМЕР покрытия.
// ТОЛЬКО ЧТЕНИЕ: ничего не пишет в базу и ничего не переключает на сайте.
//
// Сравнивает "сейчас (с TecDoc)" и "без TecDoc" для функций сайта:
//   1) блок "Аналоги" — кроссы только из источников не-TecDoc
//      (autohelp, price_*, trw_2025) + ручные группы cross_reference_members;
//   2) марка авто — из OEM-номеров в этих кроссах (lib/oemMakeMap.ts),
//      бренда самого товара (оригинал), car_make из прайса, названия;
//   3) марка + модель — собственный словарь моделей
//      (lib/carModelDictionary.ts) по названию и car_model из прайса;
//   4) хабы моделей — те же признаки + поколение (код кузова или год);
//   5) узкие категории "деталь + модель" — сколько текущих товаров
//      подтверждаются без TecDoc.
//
// Результат — Markdown в stdout (и в файл, если передан путь):
//   node --env-file=.env.local --import tsx scripts/vehicle-coverage/measure.mts [отчёт.md]
// ============================================================

import fs from 'node:fs';
import pg from 'pg';
import { crossSideMatchesSql, crossBrandKey } from '../../lib/crossBrandMatch';
import { makesForOemBrand } from '../../lib/oemMakeMap';
import { detectCarModels, type DetectedModel } from '../../lib/carModelDictionary';
import { CAR_MAKES, detectCarMakeInText, getCarMakeByDbValue } from '../../lib/carMakes';
import { MODEL_HUBS } from '../../lib/modelHubs';
import { CATEGORIES } from '../../lib/categories';

const TECDOC_SOURCES = `('tecdoc_2016', 'tecdoc_2018')`;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await pool.query(`SET statement_timeout = '1800s'`);

const out: string[] = [];
const log = (line = '') => {
  out.push(line);
  console.log(line);
};
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const fmt = (n: number) => n.toLocaleString('ru-RU');
const partKey = (brand: string | null, article: string) => `${(brand ?? '').toUpperCase()}|${article}`;

// ---------- Товары ----------
interface Product {
  id: string;
  brand: string | null;
  article: string;
  name: string | null;
  carMake: string | null;
  carModel: string | null;
  stock: number;
}
const products: Product[] = (
  await pool.query(
    `SELECT id, brand, article, name, car_make, car_model, stock FROM products WHERE is_active`
  )
).rows.map((r) => ({ id: r.id, brand: r.brand, article: r.article, name: r.name, carMake: r.car_make, carModel: r.car_model, stock: r.stock }));
const inStock = products.filter((p) => p.stock > 0);
log(`# Замена TecDoc: замер покрытия (этап 1)\n`);
log(`Активных товаров: ${fmt(products.length)}, в наличии: ${fmt(inStock.length)}\n`);

// ============================================================
// 1. АНАЛОГИ
// ============================================================
const partsBase = `SELECT DISTINCT brand, article FROM products WHERE is_active AND brand IS NOT NULL`;
const rowBase = `tc.article_a = p.article AND tc.article_b <> p.article AND LENGTH(tc.article_b) >= 3 AND tc.is_valid
  AND ${crossSideMatchesSql('tc.brand_a', 'tc.article_a', 'p.brand')}`;
const analogs = await pool.query(`
  SELECT p.brand, p.article,
    EXISTS (SELECT 1 FROM tecdoc_crosses tc WHERE ${rowBase}) AS cur,
    EXISTS (SELECT 1 FROM tecdoc_crosses tc WHERE ${rowBase} AND tc.source NOT IN ${TECDOC_SOURCES}) AS own
  FROM (${partsBase} AND stock > 0) p`);
const analogCur = new Set<string>();
const analogOwn = new Set<string>();
for (const r of analogs.rows) {
  if (r.cur) analogCur.add(partKey(r.brand, r.article));
  if (r.own) analogOwn.add(partKey(r.brand, r.article));
}
const curated = new Set<string>(
  (
    await pool.query(`
      SELECT DISTINCT m.product_id FROM cross_reference_members m
      WHERE m.product_id IS NOT NULL
        AND (SELECT count(*) FROM cross_reference_members o WHERE o.group_id = m.group_id) > 1`)
  ).rows.map((r) => r.product_id as string)
);
const bySource = await pool.query(`
  SELECT tc.source, count(DISTINCT (p.brand, p.article)) AS parts
  FROM (${partsBase} AND stock > 0) p JOIN tecdoc_crosses tc ON ${rowBase}
  GROUP BY 1 ORDER BY 2 DESC`);

const stockAnalogCur = inStock.filter((p) => analogCur.has(partKey(p.brand, p.article))).length;
const stockAnalogOwn = inStock.filter((p) => analogOwn.has(partKey(p.brand, p.article))).length;
const stockCurated = inStock.filter((p) => curated.has(p.id)).length;
const stockAnyCur = inStock.filter((p) => analogCur.has(partKey(p.brand, p.article)) || curated.has(p.id)).length;
const stockAnyOwn = inStock.filter((p) => analogOwn.has(partKey(p.brand, p.article)) || curated.has(p.id)).length;

log(`## 1. Аналоги (товары в наличии)\n`);
log(`| Что | Сейчас (с TecDoc) | Без TecDoc | Потеря |`);
log(`|---|---:|---:|---:|`);
log(`| Блок «Аналоги» (tecdoc_crosses) | ${fmt(stockAnalogCur)} | ${fmt(stockAnalogOwn)} | ${fmt(stockAnalogCur - stockAnalogOwn)} (${pct(stockAnalogCur - stockAnalogOwn, stockAnalogCur)}) |`);
log(`| Ручные группы (блок «OEM-номери та аналоги») | ${fmt(stockCurated)} | ${fmt(stockCurated)} | 0 |`);
log(`| Хотя бы один из двух блоков | ${fmt(stockAnyCur)} | ${fmt(stockAnyOwn)} | ${fmt(stockAnyCur - stockAnyOwn)} (${pct(stockAnyCur - stockAnyOwn, stockAnyCur)}) |`);
log(`\nУникальных деталей (бренд+артикул) в наличии с блоком по источнику строк:\n`);
for (const r of bySource.rows) log(`- ${r.source}: ${fmt(Number(r.parts))}`);
log('');

// ============================================================
// 2. МАРКА АВТО
// ============================================================
// OEM-номера в кроссах не-TecDoc: бренд "другой стороны" строки
const oemRows = await pool.query(`
  SELECT DISTINCT p.brand, p.article, tc.brand_b AS other
  FROM (${partsBase}) p JOIN tecdoc_crosses tc ON ${rowBase} AND tc.source NOT IN ${TECDOC_SOURCES}`);
const oemMakes = new Map<string, Set<string>>();
for (const r of oemRows.rows) {
  const makes = makesForOemBrand(r.other);
  if (makes.length === 0) continue;
  const key = partKey(r.brand, r.article);
  const set = oemMakes.get(key) ?? new Set<string>();
  makes.forEach((m) => set.add(m));
  oemMakes.set(key, set);
}
// Ручные группы: бренды номеров в той же группе
const curatedRows = await pool.query(`
  SELECT DISTINCT m.product_id, o.brand FROM cross_reference_members m
  JOIN cross_reference_members o ON o.group_id = m.group_id AND o.id <> m.id
  WHERE m.product_id IS NOT NULL`);
const curatedMakes = new Map<string, Set<string>>();
for (const r of curatedRows.rows) {
  const makes = makesForOemBrand(r.brand);
  if (makes.length === 0) continue;
  const set = curatedMakes.get(r.product_id) ?? new Set<string>();
  makes.forEach((m) => set.add(m));
  curatedMakes.set(r.product_id, set);
}
// Сейчас: применимость TecDoc (то же сопоставление, что на сайте)
const compatRows = await pool.query(`
  SELECT DISTINCT p.brand, p.article, upper(tc.make) AS make, (tc.model <> '') AS has_model
  FROM (${partsBase}) p
  JOIN tecdoc_compatibility tc ON tc.article = p.article
   AND UPPER(translate(tc.brand, 'ÄÖÜäöüÉÈéè', 'AOUaoueEee')) = UPPER(p.brand)`);
const compatMake = new Set<string>();
const compatModel = new Set<string>();
for (const r of compatRows.rows) {
  const key = partKey(r.brand, r.article);
  compatMake.add(key);
  if (r.has_model) compatModel.add(key);
}

const MAKE_NAME = new Map(CAR_MAKES.map((m) => [m.slug, m.name]));
const isRealCarMake = (value: string | null) => {
  const v = (value ?? '').trim().toUpperCase();
  return Boolean(v) && !['UNIVERSAL', 'УНІВЕРСАЛ', 'УНИВЕРСАЛ', '-'].includes(v);
};

interface Own {
  makes: Set<string>;
  sources: Set<string>;
  models: DetectedModel[];
}
const own = new Map<string, Own>();
for (const p of products) {
  const makes = new Set<string>();
  const sources = new Set<string>();
  if (isRealCarMake(p.carMake)) {
    makes.add(getCarMakeByDbValue(p.carMake)?.slug ?? crossBrandKey(p.carMake).toLowerCase());
    sources.add('car_make из прайса');
  }
  const brandMakes = makesForOemBrand(p.brand);
  if (brandMakes.length) {
    brandMakes.forEach((m) => makes.add(m));
    sources.add('бренд товара — автопроизводитель');
  }
  const oem = oemMakes.get(partKey(p.brand, p.article));
  if (oem) {
    oem.forEach((m) => makes.add(m));
    sources.add('OEM-номер в кроссах прайсов/TRW');
  }
  const cur = curatedMakes.get(p.id);
  if (cur) {
    cur.forEach((m) => makes.add(m));
    sources.add('OEM-номер в ручных группах');
  }
  const models = [...detectCarModels(p.name), ...detectCarModels(`${p.carMake ?? ''} ${p.carModel ?? ''}`)];
  if (models.length) {
    models.forEach((m) => makes.add(m.make));
    sources.add('модель в названии / car_model');
  }
  const nameMake = detectCarMakeInText(p.name ?? '');
  if (nameMake) {
    const slug = CAR_MAKES.find((m) => m.dbValues.some((v) => nameMake.dbValues.includes(v)))?.slug ?? nameMake.dbValues[0].toLowerCase();
    makes.add(slug);
    sources.add('марка в названии');
  }
  own.set(p.id, { makes, sources, models });
}

const countBy = (list: Product[], fn: (p: Product) => boolean) => list.filter(fn).length;
const curMakeFn = (p: Product) => isRealCarMake(p.carMake) || compatMake.has(partKey(p.brand, p.article));
const ownMakeFn = (p: Product) => (own.get(p.id)?.makes.size ?? 0) > 0;
const curModelFn = (p: Product) => compatModel.has(partKey(p.brand, p.article));
const ownModelFn = (p: Product) => (own.get(p.id)?.models.length ?? 0) > 0;

log(`## 2. Марка авто\n`);
log(`| | Сейчас (car_make + TecDoc) | Без TecDoc | Разница |`);
log(`|---|---:|---:|---:|`);
for (const [label, list] of [['В наличии', inStock], ['Все активные', products]] as const) {
  const a = countBy(list, curMakeFn);
  const b = countBy(list, ownMakeFn);
  log(`| ${label} | ${fmt(a)} (${pct(a, list.length)}) | ${fmt(b)} (${pct(b, list.length)}) | ${b >= a ? '+' : ''}${fmt(b - a)} |`);
}
const onlyTecdocMake = countBy(inStock, (p) => curMakeFn(p) && !ownMakeFn(p));
const onlyOwnMake = countBy(inStock, (p) => !curMakeFn(p) && ownMakeFn(p));
log(`\nВ наличии: марка есть только из TecDoc — ${fmt(onlyTecdocMake)}; только из своих данных — ${fmt(onlyOwnMake)}.\n`);
const sourceCount = new Map<string, number>();
for (const p of inStock) for (const s of own.get(p.id)?.sources ?? []) sourceCount.set(s, (sourceCount.get(s) ?? 0) + 1);
log(`Откуда марка без TecDoc (в наличии, товар может попасть в несколько строк):\n`);
for (const [s, n] of [...sourceCount].sort((a, b) => b[1] - a[1])) log(`- ${s}: ${fmt(n)}`);
log('');

// ============================================================
// 3. МАРКА + МОДЕЛЬ
// ============================================================
log(`## 3. Марка + модель\n`);
log(`| | Сейчас (TecDoc, модель в применимости) | Без TecDoc (словарь по названию и car_model) | Разница |`);
log(`|---|---:|---:|---:|`);
for (const [label, list] of [['В наличии', inStock], ['Все активные', products]] as const) {
  const a = countBy(list, curModelFn);
  const b = countBy(list, ownModelFn);
  log(`| ${label} | ${fmt(a)} (${pct(a, list.length)}) | ${fmt(b)} (${pct(b, list.length)}) | ${b >= a ? '+' : ''}${fmt(b - a)} |`);
}
const modelFreq = new Map<string, number>();
for (const p of inStock) for (const m of own.get(p.id)?.models ?? []) modelFreq.set(`${MAKE_NAME.get(m.make) ?? m.make} ${m.model}`, (modelFreq.get(`${MAKE_NAME.get(m.make) ?? m.make} ${m.model}`) ?? 0) + 1);
log(`\nЧаще всего распознаются (в наличии): ${[...modelFreq].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${k} ${fmt(n)}`).join(', ')}\n`);

// Выборка 30 случайных товаров с распознанной моделью — для ручной проверки точности
const withModel = inStock.filter(ownModelFn);
const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const sample = [...withModel].sort((a, b) => seed(a.id) - seed(b.id)).slice(0, 30);
log(`### Выборка 30 случайных (для проверки точности)\n`);
log(`| # | Товар | car_model | Распознано |`);
log(`|---:|---|---|---|`);
sample.forEach((p, i) => {
  const models = own.get(p.id)!.models.map((m) => `${MAKE_NAME.get(m.make) ?? m.make} ${m.model}${m.generation ? ` [${m.generation}]` : ''}`);
  log(`| ${i + 1} | ${p.brand ?? ''} ${p.article} — ${(p.name ?? '').replace(/\|/g, '/').slice(0, 90)} | ${(p.carModel ?? '').replace(/\|/g, '/').slice(0, 30)} | ${[...new Set(models)].join('; ')} |`);
});
log('');

// ============================================================
// 4. ХАБЫ
// ============================================================
log(`## 4. Хабы моделей (уникальные детали бренд+артикул)\n`);
log(`| Хаб | Сейчас (TecDoc) | Без TecDoc | из них в наличии | Совпадает с текущими | Модель есть, поколение не определено |`);
log(`|---|---:|---:|---:|---:|---:|`);
const hubExamples: string[] = [];
for (const hub of MODEL_HUBS) {
  const cur = await pool.query(
    `SELECT DISTINCT upper(p.brand) || '|' || p.article AS k FROM tecdoc_compatibility tc
     JOIN products p ON p.brand = tc.brand AND p.article = tc.article AND p.is_active
     WHERE tc.make = $1 AND tc.model = ANY($2::text[])`,
    [hub.tecdocMake, hub.tecdocModels]
  );
  const curSet = new Set<string>(cur.rows.map((r) => r.k));
  const ownParts = new Map<string, Product>();
  const unknownGen = new Set<string>();
  for (const p of products) {
    const models = own.get(p.id)?.models ?? [];
    const key = partKey(p.brand, p.article);
    if (models.some((m) => m.generation === hub.slug)) {
      const prev = ownParts.get(key);
      if (!prev || (p.stock > 0 && prev.stock <= 0)) ownParts.set(key, p);
    } else if (models.some((m) => m.make === hub.makeSlug && m.generationUnknown && hubModelOf(hub) === m.model)) {
      unknownGen.add(key);
    }
  }
  const ownInStock = [...ownParts.values()].filter((p) => p.stock > 0).length;
  const overlap = [...ownParts.keys()].filter((k) => curSet.has(k)).length;
  log(`| ${MAKE_NAME.get(hub.makeSlug) ?? hub.makeSlug} ${hub.label} | ${fmt(curSet.size)} | ${fmt(ownParts.size)} | ${fmt(ownInStock)} | ${fmt(overlap)} | ${fmt(unknownGen.size)} |`);
  const examples = [...ownParts.values()].sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || seed(a.id) - seed(b.id)).slice(0, 10);
  hubExamples.push(`**${MAKE_NAME.get(hub.makeSlug) ?? hub.makeSlug} ${hub.label}**`);
  for (const p of examples) {
    hubExamples.push(`- ${p.brand ?? ''} ${p.article} — ${(p.name ?? '').slice(0, 95)}${p.stock > 0 ? '' : ' (під замовлення)'}${curSet.has(partKey(p.brand, p.article)) ? ' ✓есть и в TecDoc' : ''}`);
  }
  hubExamples.push('');
}
log(`\n### 10 примеров на хаб (без TecDoc)\n`);
hubExamples.forEach((l) => log(l));

// Модель хаба в словаре (по названию хаба)
function hubModelOf(hub: (typeof MODEL_HUBS)[number]): string {
  const detected = detectCarModels(`${MAKE_NAME.get(hub.makeSlug) ?? ''} ${hub.label} ${hub.yearFrom}-${hub.yearTo}`)[0];
  return detected?.model ?? hub.label;
}

// ============================================================
// 5. УЗКИЕ КАТЕГОРИИ "ДЕТАЛЬ + МОДЕЛЬ"
// ============================================================
const narrow = (CATEGORIES as Array<{ slug: string; name: string; tecdocVehicle?: unknown }>).filter((c) => c.tecdocVehicle);
const narrowRows = await pool.query(
  `SELECT pc.category_id, p.id FROM product_categories pc JOIN products p ON p.id = pc.product_id AND p.is_active WHERE pc.category_id = ANY($1)`,
  [narrow.map((c) => c.slug)]
);
let narrowTotal = 0;
let narrowConfirmed = 0;
for (const r of narrowRows.rows) {
  const category = narrow.find((c) => c.slug === r.category_id)!;
  const target = detectCarModels(category.name);
  const models = own.get(r.id)?.models ?? [];
  narrowTotal++;
  if (target.some((t) => models.some((m) => m.make === t.make && m.model === t.model))) narrowConfirmed++;
}
log(`## 5. Узкие категории «деталь + модель»\n`);
log(`Товаров в них сейчас: ${fmt(narrowTotal)}; подтверждаются без TecDoc (та же модель в названии/car_model): ${fmt(narrowConfirmed)} (${pct(narrowConfirmed, narrowTotal)}).\n`);

// Итоговые числа для таблицы в отчёте
log(`## Сводка для итоговой таблицы\n`);
log(`- Аналоги (в наличии): ${fmt(stockAnalogCur)} -> ${fmt(stockAnalogOwn)}`);
log(`- Любой блок аналогов (в наличии): ${fmt(stockAnyCur)} -> ${fmt(stockAnyOwn)}`);
log(`- Марка (в наличии): ${fmt(countBy(inStock, curMakeFn))} -> ${fmt(countBy(inStock, ownMakeFn))}`);
log(`- Марка+модель (в наличии): ${fmt(countBy(inStock, curModelFn))} -> ${fmt(countBy(inStock, ownModelFn))}`);
log(`- Узкие категории: ${fmt(narrowTotal)} -> ${fmt(narrowConfirmed)}`);

if (process.argv[2]) fs.writeFileSync(process.argv[2], out.join('\n'), 'utf8');
await pool.end();
