// ============================================================
// Дані для хабів моделей (lib/modelHubs.ts, app/marky/[make]/[model]).
//
// Товари хабу — лише з TecDoc-сумісності: товар потрапляє в хаб, якщо в
// tecdoc_compatibility є рядок з його brand+article і одним із
// tecdocModels хабу. tc.make порівнюємо без UPPER — у TecDoc марки
// записані великими літерами ('TOYOTA'), і так спрацьовує індекс
// idx_tecdoc_compat_vehicle (make, model)
// ============================================================

import { cache } from 'react';
import { Pool } from 'pg';
import { detectCategoryForProductName, getCategoryBySlug, type CategoryDef } from '@/lib/categories';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { MODEL_HUBS, MIN_HUB_PRODUCTS, PRIORITY_CATEGORY_SLUGS, type ModelHubDef } from '@/lib/modelHubs';
import { comparePopular, getRecentlySoldProductIds } from '@/lib/popularitySort';

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
}

const HUB_PRODUCTS_SQL = `
  SELECT DISTINCT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.stock, p.image_url, s.delivery_time
  FROM tecdoc_compatibility tc
  JOIN products p ON p.brand = tc.brand AND p.article = tc.article AND p.is_active = true
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE tc.make = $1 AND tc.model = ANY($2::text[])
`;

function gridRank(product: HubProduct): number {
  const inStock = product.stock > 0;
  const hasImage = Boolean(product.imageUrl);
  if (inStock && hasImage) return 0;
  if (inStock) return 1;
  if (hasImage) return 2;
  return 3;
}

export const loadHubData = cache(async function loadHubData(hub: ModelHubDef): Promise<HubData> {
  const [result, soldList] = await Promise.all([
    pool.query(HUB_PRODUCTS_SQL, [hub.tecdocMake, hub.tecdocModels]),
    getRecentlySoldProductIds(pool),
  ]);
  const soldIds = new Set(soldList);
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
  const products = [...bestByPart.values()];

  // Категорії — тим самим способом, що й хлібні крихти товару
  // (detectCategoryForProductName по очищеній назві). Товари без
  // розпізнаної категорії в блок не потрапляють, але в total рахуються
  const counts = new Map<string, number>();
  const categoryOf = new Map<string, string>();
  for (const product of products) {
    const category = detectCategoryForProductName(buildCleanProductName(product.name));
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

  return { total: products.length, categories, products: grid };
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
        [hub.tecdocMake, hub.tecdocModels]
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
