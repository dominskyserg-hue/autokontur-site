// ============================================================
// Марка и модель авто из СОБСТВЕННЫХ данных — таблица product_vehicles_own
// (schema.sql, раздел "СВОЯ ПРИМЕНИМОСТЬ").
//
// Источники (колонка source):
//   brand — бренд самого товара — автопроизводитель (оригинал TOYOTA);
//   name  — марка/модель в названии товара (lib/carModelDictionary.ts,
//           detectCarMakeInText из lib/carMakes.ts);
//   oem   — OEM-номер автопроизводителя в кроссах из разрешённых
//           источников (ALLOWED_CROSS_SOURCES) и в ручных группах
//           cross_reference_members (lib/oemMakeMap.ts);
//   price — поля car_make / car_model из прайса поставщика.
//
// Одна строка = товар + марка (+ модель, + поколение, если известны) +
// источник. Марка — slug из lib/carMakes.ts (для марок без своей
// страницы — нормализованное имя: lexus, skoda...). Поколение — slug хаба
// модели (lib/modelHubs.ts), только когда его удалось определить.
//
// Пересчёт: после импорта прайса — товары поставщика
// (lib/importFollowup.ts), каждую ночь — полностью
// (/api/cron/rebuild-own-vehicles), вручную — npm run own-vehicles:rebuild
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { crossBrandKeySql, crossSideMatchesSql } from '@/lib/crossBrandMatch';
import { makesForOemBrand, OEM_MAKE_KEYS } from '@/lib/oemMakeMap';
import { detectCarModels } from '@/lib/carModelDictionary';
import { CAR_MAKES, detectCarMakeInText, getCarMakeByDbValue } from '@/lib/carMakes';

// Источники кроссов, которым мы доверяем: прайсы наших поставщиков и
// официальный справочник TRW. Остальные источники (исключённые, см.
// scripts/crosses/schema.sql) сюда не входят
export const ALLOWED_CROSS_SOURCES = ['autohelp', 'price_nippon', 'trw_2025'];

export type OwnVehicleSource = 'brand' | 'name' | 'oem' | 'price';

export interface OwnVehicleRow {
  make: string;
  model: string | null;
  generation: string | null;
  source: OwnVehicleSource;
}

interface ProductInput {
  id: string;
  brand: string | null;
  name: string | null;
  carMake: string | null;
  carModel: string | null;
}

// "Універсальний" и прочие заглушки в car_make — не марка
const NOT_A_CAR_MAKE = new Set(['', '-', 'UNIVERSAL', 'УНІВЕРСАЛ', 'УНИВЕРСАЛ', 'УНІВЕРСАЛЬНИЙ']);

function makeSlugFromText(value: string | null): string | null {
  const text = (value ?? '').trim();
  if (NOT_A_CAR_MAKE.has(text.toUpperCase())) return null;
  const curated = getCarMakeByDbValue(text);
  if (curated) return curated.slug;
  const detected = detectCarMakeInText(text);
  if (!detected) return null;
  return CAR_MAKES.find((m) => m.dbValues.some((v) => detected.dbValues.includes(v)))?.slug ?? detected.dbValues[0].toLowerCase();
}

// Все строки своей применимости одного товара. oemBrands — бренды
// OEM-номеров из кроссов и ручных групп этого товара
export function computeOwnVehicles(product: ProductInput, oemBrands: string[]): OwnVehicleRow[] {
  const rows = new Map<string, OwnVehicleRow>();
  const add = (row: OwnVehicleRow) => {
    rows.set(`${row.make}|${row.model ?? ''}|${row.generation ?? ''}|${row.source}`, row);
  };

  for (const make of makesForOemBrand(product.brand)) add({ make, model: null, generation: null, source: 'brand' });

  for (const brand of oemBrands) {
    for (const make of makesForOemBrand(brand)) add({ make, model: null, generation: null, source: 'oem' });
  }

  const nameModels = detectCarModels(product.name);
  for (const m of nameModels) add({ make: m.make, model: m.model, generation: m.generation, source: 'name' });
  // Марка в названии без распознанной модели ("Фільтр масляний Toyota")
  if (nameModels.length === 0) {
    const make = makeSlugFromText(product.name);
    if (make) add({ make, model: null, generation: null, source: 'name' });
  }

  const priceMake = makeSlugFromText(product.carMake);
  const priceModels = detectCarModels(`${product.carMake ?? ''} ${product.carModel ?? ''}`);
  for (const m of priceModels) add({ make: m.make, model: m.model, generation: m.generation, source: 'price' });
  if (priceMake && !priceModels.some((m) => m.make === priceMake)) {
    add({ make: priceMake, model: null, generation: null, source: 'price' });
  }

  return [...rows.values()];
}

// Бренды OEM-номеров для товаров (разрешённые кроссы + ручные группы).
// Предварительный фильтр в SQL — ключ бренда строки начинается с ключа
// автопроизводителя; окончательно марку определяет makesForOemBrand
async function loadOemBrands(db: Pool | PoolClient, supplierId?: string): Promise<Map<string, string[]>> {
  const makeKeyRegex = `^(${OEM_MAKE_KEYS.join('|')})`;
  const supplierFilter = supplierId ? 'AND p.supplier_id = $3' : '';
  const params: unknown[] = [ALLOWED_CROSS_SOURCES, makeKeyRegex];
  if (supplierId) params.push(supplierId);

  const crosses = await db.query(
    `SELECT DISTINCT p.id, tc.brand_b AS brand
       FROM part_crosses tc
       JOIN products p ON p.article = tc.article_a AND p.is_active ${supplierFilter}
      WHERE tc.source = ANY($1::text[]) AND tc.is_valid AND LENGTH(tc.article_b) >= 3
        AND ${crossBrandKeySql('tc.brand_b')} ~ $2
        AND ${crossSideMatchesSql('tc.brand_a', 'tc.article_a', 'p.brand')}`,
    params
  );
  const curated = await db.query(
    `SELECT DISTINCT m.product_id AS id, o.brand
       FROM cross_reference_members m
       JOIN cross_reference_members o ON o.group_id = m.group_id AND o.id <> m.id
       JOIN products p ON p.id = m.product_id AND p.is_active ${supplierId ? 'AND p.supplier_id = $1' : ''}
      WHERE o.brand IS NOT NULL`,
    supplierId ? [supplierId] : []
  );

  const byProduct = new Map<string, string[]>();
  for (const row of [...crosses.rows, ...curated.rows]) {
    const list = byProduct.get(row.id) ?? [];
    list.push(row.brand);
    byProduct.set(row.id, list);
  }
  return byProduct;
}

const INSERT_CHUNK = 20_000;

// Пересчёт: всех активных товаров или одного поставщика. Запись разницы —
// в одной транзакции, читатели не видят промежуточного состояния.
// Строки неактивных товаров при полном пересчёте удаляются (их нет в wanted)
export interface OwnVehicleRowsBatch {
  products: number;
  ids: string[];
  makes: string[];
  models: (string | null)[];
  generations: (string | null)[];
  sources: string[];
}

// Расчёт строк своей применимости БЕЗ записи — для пересчёта и для
// проверок "что будет после изменения словаря" без записи в базу
export async function computeOwnVehicleRows(db: Pool | PoolClient, scope: { supplierId?: string } = {}): Promise<OwnVehicleRowsBatch> {
  const products = await db.query(
    `SELECT id, brand, name, car_make, car_model FROM products
      WHERE is_active ${scope.supplierId ? 'AND supplier_id = $1' : ''}`,
    scope.supplierId ? [scope.supplierId] : []
  );
  const oem = await loadOemBrands(db, scope.supplierId);

  const batch: OwnVehicleRowsBatch = { products: products.rows.length, ids: [], makes: [], models: [], generations: [], sources: [] };
  for (const r of products.rows) {
    const rows = computeOwnVehicles(
      { id: r.id, brand: r.brand, name: r.name, carMake: r.car_make, carModel: r.car_model },
      oem.get(r.id) ?? []
    );
    for (const row of rows) {
      batch.ids.push(r.id);
      batch.makes.push(row.make);
      batch.models.push(row.model);
      batch.generations.push(row.generation);
      batch.sources.push(row.source);
    }
  }
  return batch;
}

export async function rebuildOwnVehicles(pool: Pool, scope: { supplierId?: string } = {}): Promise<{ products: number; rows: number; added: number; removed: number; ms: number }> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    const { products: productCount, ids, makes, models, generations, sources } = await computeOwnVehicleRows(client, scope);

    // Пишем только разницу со старыми строками: за ночь меняется малая часть,
    // а полная перезапись 290 тыс. строк занимала ~20 с из лимита функции 60 с
    const existing = await client.query(
      `SELECT v.id, v.product_id, v.make, v.model, v.generation, v.source FROM product_vehicles_own v
        ${scope.supplierId ? 'JOIN products p ON p.id = v.product_id AND p.supplier_id = $1' : ''}`,
      scope.supplierId ? [scope.supplierId] : []
    );
    const rowKey = (productId: string, make: string, model: string | null, generation: string | null, source: string) =>
      `${productId}|${make}|${model ?? ''}|${generation ?? ''}|${source}`;
    const wanted = new Set<string>();
    for (let i = 0; i < ids.length; i++) wanted.add(rowKey(ids[i], makes[i], models[i], generations[i], sources[i]));
    const have = new Set<string>();
    const staleIds: string[] = [];
    for (const r of existing.rows) {
      const key = rowKey(r.product_id, r.make, r.model, r.generation, r.source);
      if (wanted.has(key) && !have.has(key)) have.add(key);
      else staleIds.push(r.id);
    }
    const fresh = [...Array(ids.length).keys()].filter((i) => !have.has(rowKey(ids[i], makes[i], models[i], generations[i], sources[i])));

    await client.query('BEGIN');
    for (let i = 0; i < staleIds.length; i += INSERT_CHUNK) {
      await client.query(`DELETE FROM product_vehicles_own WHERE id = ANY($1::bigint[])`, [staleIds.slice(i, i + INSERT_CHUNK)]);
    }
    for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
      const part = fresh.slice(i, i + INSERT_CHUNK);
      await client.query(
        `INSERT INTO product_vehicles_own (product_id, make, model, generation, source)
         SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])`,
        [part.map((j) => ids[j]), part.map((j) => makes[j]), part.map((j) => models[j]), part.map((j) => generations[j]), part.map((j) => sources[j])]
      );
    }
    await client.query('COMMIT');
    return { products: productCount, rows: ids.length, added: fresh.length, removed: staleIds.length, ms: Date.now() - started };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Для фоновых вызовов (после импорта): ошибка не должна ронять импорт —
// ночной полный пересчёт подстрахует
export async function rebuildOwnVehiclesSafely(pool: Pool, scope: { supplierId?: string } = {}): Promise<void> {
  try {
    const r = await rebuildOwnVehicles(pool, scope);
    console.log(`Своя применимость пересчитана: товаров ${r.products}, строк ${r.rows} (+${r.added} / −${r.removed}), ${r.ms} мс`);
  } catch (error) {
    console.error('Ошибка пересчёта своей применимости (product_vehicles_own):', error);
  }
}

// Значения марки из запроса/фильтра (dbValues: "TOYOTA", "VW"...) -> slug-и,
// как они лежат в product_vehicles_own.make. Для марок без своей страницы —
// нормализованное имя в нижнем регистре (lexus, skoda, citroen)
export function ownMakeSlugs(dbValues: string[]): string[] {
  const upper = dbValues.map((v) => v.trim().toUpperCase());
  const curated = CAR_MAKES.find((m) => m.dbValues.some((v) => upper.includes(v)));
  if (curated) return [curated.slug];
  return [...new Set(upper.map((v) => v.toLowerCase()).concat(upper.map((v) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())))];
}
