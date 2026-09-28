// ============================================================
// Этап C перехода с TecDoc — ПРЕДПРОСМОТР до выкладки. ТОЛЬКО ЧТЕНИЕ.
//
// Своя применимость считается В ПАМЯТИ текущим кодом
// (computeOwnVehicleRows, lib/ownVehicles.ts) — таблица product_vehicles_own
// не трогается. Сравнивается "сейчас (TecDoc)" и "после этапа C":
//   1) блок "Запчастина підходить для авто" на странице товара;
//   2) хабы моделей — число деталей и 20 случайных товаров на хаб;
//   3) узкие категории "деталь + модель" — сколько деталей останется,
//      какие уйдут в 301 (меньше 5 деталей);
//   4) списки марок и моделей фильтра "Моє авто".
//
//   node --env-file=.env.local --import tsx scripts/vehicle-coverage/stage-c-preview.mts [отчёт.md]
// ============================================================

import fs from 'node:fs';
import pg from 'pg';
import { computeOwnVehicleRows } from '../../lib/ownVehicles';
import { MODEL_HUBS, MIN_HUB_PRODUCTS } from '../../lib/modelHubs';
import { CATEGORIES, buildCategoryRuleClause, type CategoryDef } from '../../lib/categories';
import { narrowCategoryVehicles } from '../../lib/narrowCategoryVehicles';
import { MIN_NARROW_PRODUCTS, narrowRedirectTarget } from '../../lib/narrowCategoryStatus';
import { CAR_MAKES } from '../../lib/carMakes';
import { generationLabel } from '../../lib/carModelDictionary';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
await pool.query(`SET statement_timeout = '1200s'`);
const out: string[] = [];
const log = (line = '') => {
  out.push(line);
  console.log(line);
};
const fmt = (n: number) => n.toLocaleString('ru-RU');
const seed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
const partKey = (brand: string | null, article: string) => `${(brand ?? '').toUpperCase()}|${article}`;
const MAKE_NAME = new Map(CAR_MAKES.map((m) => [m.slug, m.name]));

// ---------- Товары и своя применимость в памяти ----------
const products = (await pool.query(`SELECT id, brand, article, name, stock FROM products WHERE is_active`)).rows as Array<{
  id: string; brand: string | null; article: string; name: string | null; stock: number;
}>;
const byId = new Map(products.map((p) => [p.id, p]));
const batch = await computeOwnVehicleRows(pool);

interface Row { make: string; model: string | null; generation: string | null }
// Строки своей применимости по детали (бренд + артикул) — как их читает сайт
const partRows = new Map<string, Row[]>();
for (let i = 0; i < batch.ids.length; i++) {
  const p = byId.get(batch.ids[i]);
  if (!p) continue;
  const key = partKey(p.brand, p.article);
  const list = partRows.get(key) ?? [];
  list.push({ make: batch.makes[i], model: batch.models[i], generation: batch.generations[i] });
  partRows.set(key, list);
}
log(`# Этап C: предпросмотр до выкладки\n`);
log(`Активных товаров ${fmt(products.length)}, строк своей применимости (в памяти) ${fmt(batch.ids.length)}.\n`);

// ============================================================
// 1. БЛОК НА СТРАНИЦЕ ТОВАРА
// ============================================================
const inStock = products.filter((p) => p.stock > 0);
const tecdocArticles = new Set<string>((await pool.query(`SELECT DISTINCT article FROM tecdoc_compatibility`)).rows.map((r) => r.article));
const withRows = (p: (typeof products)[number]) => partRows.get(partKey(p.brand, p.article)) ?? [];
const cur = inStock.filter((p) => tecdocArticles.has(p.article)).length;
const any = inStock.filter((p) => withRows(p).length > 0).length;
const model = inStock.filter((p) => withRows(p).some((r) => r.model)).length;
const gen = inStock.filter((p) => withRows(p).some((r) => r.generation)).length;
log(`## 1. Блок «Запчастина підходить для авто» (товары в наличии)\n`);
log(`| | Сейчас (TecDoc) | После этапа C |`);
log(`|---|---:|---:|`);
log(`| Блок есть | ${fmt(cur)} | ${fmt(any)} |`);
log(`| …с моделью | — | ${fmt(model)} |`);
log(`| …с поколением | — | ${fmt(gen)} |`);
log(`| Годы / двигатель | есть | не показываются (в своих данных нет) |\n`);
log(`### 20 случайных товаров в наличии с моделью — что покажет блок\n`);
const blockSample = inStock.filter((p) => withRows(p).some((r) => r.model)).sort((a, b) => seed(a.id) - seed(b.id)).slice(0, 20);
blockSample.forEach((p, i) => {
  const labels = [...new Set(withRows(p).filter((r) => r.model).map((r) => {
    const makeName = MAKE_NAME.get(r.make) ?? r.make;
    const hub = r.generation ? MODEL_HUBS.find((h) => h.makeSlug === r.make && h.slug === r.generation) : undefined;
    return `${makeName} ${hub?.label ?? generationLabel(r.generation) ?? r.model}`;
  }))];
  log(`${i + 1}. ${p.brand ?? ''} ${p.article} — ${(p.name ?? '').slice(0, 80)}\n   → Запчастини для: ${labels.join(' · ')}`);
});
log('');

// ============================================================
// 2. ХАБЫ
// ============================================================
log(`## 2. Хабы моделей (уникальные детали; порог показа — ${MIN_HUB_PRODUCTS})\n`);
log(`| Хаб | Сейчас (TecDoc) | После этапа C | в наличии | Будет виден |`);
log(`|---|---:|---:|---:|---|`);
const hubSamples: string[] = [];
for (const hub of MODEL_HUBS) {
  const curRes = await pool.query(
    `SELECT COUNT(DISTINCT (UPPER(COALESCE(p.brand, '')), p.article))::int AS n FROM tecdoc_compatibility tc
     JOIN products p ON p.brand = tc.brand AND p.article = tc.article AND p.is_active
     WHERE tc.make = $1 AND tc.model = ANY($2::text[])`,
    [hub.tecdocMake, hub.tecdocModels]
  );
  const parts = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    const key = partKey(p.brand, p.article);
    if (!(partRows.get(key) ?? []).some((r) => r.make === hub.makeSlug && r.generation === hub.slug)) continue;
    const prev = parts.get(key);
    if (!prev || (p.stock > 0 && prev.stock <= 0)) parts.set(key, p);
  }
  const list = [...parts.values()];
  const stock = list.filter((p) => p.stock > 0).length;
  const title = `${MAKE_NAME.get(hub.makeSlug) ?? hub.makeSlug} ${hub.label}`;
  log(`| ${title} | ${fmt(curRes.rows[0].n)} | ${fmt(list.length)} | ${fmt(stock)} | ${list.length >= MIN_HUB_PRODUCTS ? 'да' : '**нет**'} |`);
  hubSamples.push(`### ${title} — /marky/${hub.makeSlug}/${hub.slug}\n`);
  list.sort((a, b) => seed(a.id) - seed(b.id)).slice(0, 20).forEach((p, i) => {
    hubSamples.push(`${i + 1}. ${p.brand ?? ''} ${p.article} — ${(p.name ?? '').slice(0, 100)}${p.stock > 0 ? '' : ' _(під замовлення)_'}`);
  });
  hubSamples.push('');
}
log('');

// ============================================================
// 3. УЗКИЕ КАТЕГОРИИ
// ============================================================
log(`## 3. Узкие категории «деталь + модель» (уникальные детали; меньше ${MIN_NARROW_PRODUCTS} -> 301 на родительскую)\n`);
log(`| Категория | Модель в своих данных | Сейчас | После | Итог |`);
log(`|---|---|---:|---:|---|`);
const narrow = (CATEGORIES as CategoryDef[]).filter((c) => c.tecdocVehicle);
let kept = 0, redirected = 0, curTotal = 0, newTotal = 0;
for (const category of narrow) {
  const curRes = await pool.query(
    `SELECT COUNT(DISTINCT (UPPER(COALESCE(p.brand, '')), p.article))::int AS n FROM product_categories pc
     JOIN products p ON p.id = pc.product_id AND p.is_active WHERE pc.category_id = $1`,
    [category.slug]
  );
  // Кандидаты по словам категории (тип детали), без условия по машине
  const { clause, params } = buildCategoryRuleClause({ ...category, tecdocVehicle: undefined }, 1);
  const cand = await pool.query(`SELECT DISTINCT UPPER(COALESCE(p.brand, '')) || '|' || p.article AS k FROM products p WHERE ${clause}`, params);
  const vehicles = narrowCategoryVehicles(category);
  const confirmed = cand.rows.filter((r) =>
    (partRows.get(r.k) ?? []).some((row) => vehicles.some((v) => v.make === row.make && v.model === row.model && (v.generation === null || v.generation === row.generation)))
  ).length;
  const redirect = confirmed < MIN_NARROW_PRODUCTS;
  if (redirect) redirected++; else kept++;
  curTotal += curRes.rows[0].n;
  newTotal += confirmed;
  const target = vehicles.map((v) => `${MAKE_NAME.get(v.make) ?? v.make} ${generationLabel(v.generation) ?? MODEL_HUBS.find((h) => h.slug === v.generation)?.label ?? v.model}`).join(' / ');
  log(`| ${category.name} | ${target} | ${curRes.rows[0].n} | ${confirmed} | ${redirect ? `301 → ${narrowRedirectTarget(category)}` : "остаётся"} |`);
}
log(`\nИтого: ${narrow.length} категорий, остаются ${kept}, уходят в 301 — ${redirected}. Деталей в них сейчас ${fmt(curTotal)}, после — ${fmt(newTotal)}.\n`);

// ============================================================
// 4. ФИЛЬТР "МОЄ АВТО"
// ============================================================
const ownMakes = new Set(batch.makes);
const ownModels = new Set(batch.ids.map((_, i) => (batch.models[i] ? `${batch.makes[i]}|${batch.models[i]}` : '')).filter(Boolean));
const td = (await pool.query(`SELECT COUNT(DISTINCT make)::int AS makes, COUNT(DISTINCT (make, model))::int AS models FROM tecdoc_compatibility`)).rows[0];
log(`## 4. Фильтр «Моє авто»\n`);
log(`| Список | Сейчас (TecDoc + прайс) | После этапа C |`);
log(`|---|---:|---:|`);
log(`| Марки | ${fmt(td.makes)} (TecDoc) + car_make | ${fmt(ownMakes.size)} (своя применимость) + car_make |`);
log(`| Модели | ${fmt(td.models)} (записи TecDoc) | ${fmt(ownModels.size)} (свой словарь) |`);
log(`| Годы / двигатели | TecDoc + прайс | только поля прайса (car_year, engine_volume) |\n`);

log(`## 5. 20 случайных товаров на каждый хаб\n`);
hubSamples.forEach((l) => log(l));

if (process.argv[2]) fs.writeFileSync(process.argv[2], out.join('\n'), 'utf8');
await pool.end();
