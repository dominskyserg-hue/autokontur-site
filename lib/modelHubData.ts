// ============================================================
// Дані для хабів моделей (lib/modelHubs.ts, app/marky/[make]/[model]).
//
// Товари хабу — зі своєї применимости (product_vehicles_own): деталь
// потрапляє в хаб, якщо для неї визначено це покоління (див.
// HUB_PRODUCTS_SQL нижче). До этапа C — з TecDoc-сумісності
// ============================================================

import { cache } from 'react';
import { Pool } from 'pg';
import { detectCategoryForProductName, getCategoryBySlug, type CategoryDef } from '@/lib/categories';
import { loadBreadcrumbCategories } from '@/lib/productCategoryLookup';
import { PRODUCT_GROUPS_ACTIVE } from '@/lib/productGroups';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { MODEL_HUBS, MIN_HUB_PRODUCTS, PRIORITY_CATEGORY_SLUGS, type ModelHubDef } from '@/lib/modelHubs';
import { comparePopular, getRecentlySoldProductIds } from '@/lib/popularitySort';
import { modelForGeneration } from '@/lib/carModelDictionary';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

export const HUB_GRID_SIZE = 24;

export interface HubProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  costPrice: number;
  retailPrice: number;
  stock: number;
  imageUrl: string | null;
  deliveryTime: string | null;
  // Группы бренд+артикул (lib/productGroups.ts): id — лучшее предложение
  // (цена, "Купити"), pageId — главная страница группы (ссылка карточки),
  // offerCount — сколько предложений у этой запчасти на хабе
  pageId: string;
  offerCount: number;
  groupPrimaryId: string | null;
  // Восстановленная / б/у деталь (бейдж "Відновлена")
  isRefurbished: boolean;
}

export interface HubCategoryCount {
  category: CategoryDef;
  count: number;
}

export interface HubData {
  total: number;
  categories: HubCategoryCount[];
  // Сітка: за порядком категорій (як блок категорій), усередині —
  // в наявності з фото -> в наявності без фото -> під замовлення
  products: HubProduct[];
  // "Можуть підходити до {модель}": та же модель, поколение НЕ подтверждено
  // (нет кода кузова, годы открыты или шире поколения). До MAYBE_LIMIT
  // деталей, не входят в основной список и в total
  maybe: HubProduct[];
  maybeModel: string;
}

export const MAYBE_LIMIT = 24;

// Детали той же модели без подтверждённого поколения ($1 марка, $2 модель,
// $3 slug хаба): есть строка с generation IS NULL и нет строки с этим
// поколением
const HUB_MAYBE_SQL = `
  WITH parts AS (
    SELECT DISTINCT UPPER(COALESCE(p1.brand, '')) AS brand, p1.article
    FROM product_vehicles_own pvo
    JOIN products p1 ON p1.id = pvo.product_id AND p1.is_active = true
    WHERE pvo.make = $1 AND pvo.model = $2 AND pvo.generation IS NULL
  ),
  confirmed AS (
    SELECT DISTINCT UPPER(COALESCE(p1.brand, '')) AS brand, p1.article
    FROM product_vehicles_own pvo
    JOIN products p1 ON p1.id = pvo.product_id AND p1.is_active = true
    WHERE pvo.make = $1 AND pvo.generation = $3
  )
  SELECT DISTINCT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.stock, p.image_url, s.delivery_time, p.group_primary_id, p.is_refurbished
  FROM parts
  JOIN products p ON p.article = parts.article AND UPPER(COALESCE(p.brand, '')) = parts.brand AND p.is_active = true
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE NOT EXISTS (SELECT 1 FROM confirmed c WHERE c.brand = parts.brand AND c.article = parts.article)
`;

// Этап C перехода с TecDoc: состав хаба — из своей применимости
// (product_vehicles_own, lib/ownVehicles.ts): деталь попадает в хаб, если
// у неё определено это поколение (generation = slug хаба) — по коду кузова
// или году в названии/прайсе. Берутся все предложения этой детали (бренд +
// артикул), даже если поколение распознано только у одного поставщика.
// $1 — slug марки, $2 — slug хаба
const HUB_PRODUCTS_SQL = `
  WITH parts AS (
    SELECT DISTINCT UPPER(COALESCE(p1.brand, '')) AS brand, p1.article
    FROM product_vehicles_own pvo
    JOIN products p1 ON p1.id = pvo.product_id AND p1.is_active = true
    WHERE pvo.make = $1 AND pvo.generation = $2
  )
  SELECT DISTINCT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.stock, p.image_url, s.delivery_time, p.group_primary_id, p.is_refurbished
  FROM parts
  JOIN products p ON p.article = parts.article AND UPPER(COALESCE(p.brand, '')) = parts.brand AND p.is_active = true
  JOIN suppliers s ON s.id = p.supplier_id
`;

function gridRank(product: HubProduct): number {
  const inStock = product.stock > 0;
  const hasImage = Boolean(product.imageUrl);
  if (inStock && hasImage) return 0;
  if (inStock) return 1;
  if (hasImage) return 2;
  return 3;
}

// Строки запроса -> товары; одна деталь (бренд + артикул) — одна карточка с
// лучшей пропозицией (в наявності з фото -> в наявності -> з фото, далі дешевша)
function rowsToOffers(rows: Array<Record<string, unknown>>): HubProduct[] {
  return rows.map((row) => ({
    id: row.id as string,
    article: row.article as string,
    brand: row.brand as string | null,
    name: row.name as string | null,
    costPrice: parseFloat(row.cost_price as string),
    retailPrice: parseFloat(row.retail_price as string),
    stock: row.stock as number,
    imageUrl: row.image_url as string | null,
    deliveryTime: row.delivery_time as string | null,
    pageId: row.id as string,
    offerCount: 1,
    groupPrimaryId: row.group_primary_id as string | null,
    isRefurbished: row.is_refurbished as boolean,
  }));
}

function bestPerPart(offers: HubProduct[]): HubProduct[] {
  const bestByPart = new Map<string, HubProduct>();
  const offersByPart = new Map<string, number>();
  for (const offer of offers) {
    const key = `${(offer.brand ?? '').toUpperCase()}|${offer.article}`;
    offersByPart.set(key, (offersByPart.get(key) ?? 0) + 1);
    const current = bestByPart.get(key);
    if (!current || gridRank(offer) < gridRank(current) || (gridRank(offer) === gridRank(current) && offer.retailPrice < current.retailPrice)) {
      bestByPart.set(key, offer);
    }
  }
  return [...bestByPart.entries()].map(([key, best]) => ({
    ...best,
    pageId: PRODUCT_GROUPS_ACTIVE ? best.groupPrimaryId ?? best.id : best.id,
    offerCount: PRODUCT_GROUPS_ACTIVE ? offersByPart.get(key) ?? 1 : 1,
  }));
}

export const loadHubData = cache(async function loadHubData(hub: ModelHubDef): Promise<HubData> {
  const hubModel = modelForGeneration(hub.slug);
  const [result, maybeResult, soldList] = await Promise.all([
    pool.query(HUB_PRODUCTS_SQL, [hub.makeSlug, hub.slug]),
    hubModel ? pool.query(HUB_MAYBE_SQL, [hub.makeSlug, hubModel.model, hub.slug]) : Promise.resolve({ rows: [] }),
    getRecentlySoldProductIds(pool),
  ]);
  const soldIds = new Set(soldList);
  const maybe = bestPerPart(rowsToOffers(maybeResult.rows))
    .sort((a, b) => gridRank(a) - gridRank(b) || comparePopular(a, b, soldIds))
    .slice(0, MAYBE_LIMIT);
  const offers: HubProduct[] = result.rows.map((row) => ({
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    costPrice: parseFloat(row.cost_price),
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    imageUrl: row.image_url,
    deliveryTime: row.delivery_time,
    pageId: row.id,
    offerCount: 1,
    groupPrimaryId: row.group_primary_id,
    isRefurbished: row.is_refurbished,
  }));

  // Той самий товар (бренд + артикул) часто є в кількох постачальників —
  // на хабі це ОДНА запчастина: лишаємо найкращу пропозицію (в наявності з
  // фото -> в наявності -> з фото, далі дешевша). І кількість "N запчастин",
  // і категорії рахуються вже по унікальних товарах
  const bestByPart = new Map<string, HubProduct>();
  for (const offer of offers) {
    const key = `${(offer.brand ?? '').toUpperCase()}|${offer.article}`;
    const current = bestByPart.get(key);
    if (!current || gridRank(offer) < gridRank(current) || (gridRank(offer) === gridRank(current) && offer.retailPrice < current.retailPrice)) {
      bestByPart.set(key, offer);
    }
  }
  // Ссылка — на главную страницу группы, пометка "N пропозицій" — по числу предложений на хабе
  const offersByPart = new Map<string, number>();
  for (const offer of offers) {
    const key = `${(offer.brand ?? '').toUpperCase()}|${offer.article}`;
    offersByPart.set(key, (offersByPart.get(key) ?? 0) + 1);
  }
  const products = [...bestByPart.values()].map((best) => ({
    ...best,
    pageId: PRODUCT_GROUPS_ACTIVE ? best.groupPrimaryId ?? best.id : best.id,
    offerCount: PRODUCT_GROUPS_ACTIVE ? offersByPart.get(`${(best.brand ?? '').toUpperCase()}|${best.article}`) ?? 1 : 1,
  }));

  // Категорії — тим самим способом, що й хлібні крихти товару: з таблиці
  // product_categories (lib/productCategoryLookup.ts), запасний варіант —
  // за словами в очищеній назві. Товари без категорії в блок не
  // потрапляють, але в total рахуються
  const fromTable = await loadBreadcrumbCategories(pool, products.map((product) => product.id));
  const counts = new Map<string, number>();
  const categoryOf = new Map<string, string>();
  for (const product of products) {
    const category = fromTable.get(product.id) ?? detectCategoryForProductName(buildCleanProductName(product.name));
    if (category) {
      counts.set(category.slug, (counts.get(category.slug) ?? 0) + 1);
      categoryOf.set(product.id, category.slug);
    }
  }
  const categories: HubCategoryCount[] = [...counts.entries()]
    .map(([slug, count]) => ({ category: getCategoryBySlug(slug)!, count }))
    .filter((item) => Boolean(item.category))
    .sort((a, b) => {
      const pa = PRIORITY_CATEGORY_SLUGS.indexOf(a.category.slug);
      const pb = PRIORITY_CATEGORY_SLUGS.indexOf(b.category.slug);
      if (pa !== -1 || pb !== -1) return (pa === -1 ? Infinity : pa) - (pb === -1 ? Infinity : pb);
      return b.count - a.count;
    });

  // Сітка — у тому ж порядку категорій, що й блок категорій (спершу
  // пріоритетні: гальма, фільтри, підвіска...), товари без категорії — в
  // кінці; усередині категорії — сортування "За популярністю", однакове
  // для всього сайту (lib/popularitySort.ts): наявність → продаж за 180
  // днів → фото → група бренду → ціна за зростанням
  const categoryOrder = new Map(categories.map((item, index) => [item.category.slug, index]));
  const categoryRank = (product: HubProduct): number => {
    const slug = categoryOf.get(product.id);
    return slug !== undefined ? categoryOrder.get(slug) ?? categories.length : categories.length;
  };
  const grid = [...products]
    .sort((a, b) => categoryRank(a) - categoryRank(b) || comparePopular(a, b, soldIds))
    .slice(0, HUB_GRID_SIZE);

  return { total: products.length, categories, products: grid, maybe, maybeModel: hubModel?.model ?? hub.label };
});

// Кількість товарів кожного хабу — для списку "Моделі {Марка}" і
// сайтмапу (хаби з < MIN_HUB_PRODUCTS не показуються)
// Кешується в пам'яті на годину: список видимих хабів потрібен на кожній
// сторінці товару (блок сумісності) і марки — 12+ COUNT-запитів на кожен
// показ були б зайвими
const COUNTS_TTL_MS = 60 * 60 * 1000;
let countsCache: { expires: number; counts: Map<string, number> } | null = null;

export const loadHubProductCounts = cache(async function loadHubProductCounts(): Promise<Map<string, number>> {
  if (countsCache && countsCache.expires > Date.now()) return countsCache.counts;
  const counts = new Map<string, number>();
  await Promise.all(
    MODEL_HUBS.map(async (hub) => {
      // Унікальні запчастини (бренд + артикул) — так само, як на самій сторінці
      const result = await pool.query(
        `SELECT COUNT(DISTINCT (UPPER(COALESCE(t.brand, '')), t.article))::int AS n FROM (${HUB_PRODUCTS_SQL}) t`,
        [hub.makeSlug, hub.slug]
      );
      counts.set(`${hub.makeSlug}/${hub.slug}`, result.rows[0]?.n ?? 0);
    })
  );
  countsCache = { expires: Date.now() + COUNTS_TTL_MS, counts };
  return counts;
});

export async function loadVisibleHubs(): Promise<ModelHubDef[]> {
  const counts = await loadHubProductCounts();
  return MODEL_HUBS.filter((hub) => (counts.get(`${hub.makeSlug}/${hub.slug}`) ?? 0) >= MIN_HUB_PRODUCTS);
}
