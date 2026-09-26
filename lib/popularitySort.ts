// ============================================================
// Сортировка "За популярністю" — ОДНА на весь сайт: категории, марки
// авто, хабы моделей, поиск.
//
// Порядок:
//   1. есть в наличии (stock > 0);
//   2. была продажа за последние 180 дней (не отменённый заказ);
//   3. есть фото;
//   4. группа бренда 1 → 2 → 3 (списки — в lib/brandPriority.ts);
//   5. цена по возрастанию.
//
// Отдельного поля "популярность" в базе нет. Проданных за 180 дней
// товаров пока единицы, поэтому их id берём одним запросом и кэшируем
// в памяти на 10 минут, а в сортировку подставляем готовым списком —
// это дешевле, чем проверять заказы для каждой строки.
//
// Списки брендов и id подставляются в SQL текстом, а не параметрами:
// это наши собственные константы (lib/brandPriority.ts) и UUID из базы,
// проверенные регуляркой, а не ввод пользователя. Так не нужно
// перенумеровывать $1, $2… во всех запросах, где используется сортировка
// ============================================================

import type { Pool } from 'pg';
import { BRAND_GROUP_1_KEYS, BRAND_GROUP_2_KEYS, getBrandGroup } from '@/lib/brandPriority';

const SOLD_WINDOW_DAYS = 180;
const SOLD_CACHE_TTL_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let soldCache: { ids: string[]; at: number } | null = null;

// id товаров, проданных за 180 дней (кэш 10 минут). Ошибка базы — пустой
// список: сортировка просто пропустит этот признак, страница не упадёт
export async function getRecentlySoldProductIds(pool: Pool): Promise<string[]> {
  if (soldCache && Date.now() - soldCache.at < SOLD_CACHE_TTL_MS) return soldCache.ids;
  try {
    const result = await pool.query<{ product_id: string }>(
      `SELECT DISTINCT oi.product_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id IS NOT NULL
         AND o.status <> 'cancelled'
         AND o.created_at > now() - make_interval(days => $1)`,
      [SOLD_WINDOW_DAYS]
    );
    const ids = result.rows.map((row) => row.product_id).filter((id) => UUID_RE.test(id));
    soldCache = { ids, at: Date.now() };
    return ids;
  } catch (error) {
    console.error('Ошибка при получении проданных за 180 дней товаров:', error);
    return soldCache?.ids ?? [];
  }
}

// Строки из наших констант → SQL-литерал массива (кавычки экранируем)
function textArrayLiteral(values: string[]): string {
  if (values.length === 0) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => `'${value.replace(/'/g, "''")}'`).join(',')}]::text[]`;
}

// Та же нормализация бренда, что normalizeBrandKey() в lib/brandPriority.ts:
// верхний регистр, без пробелов и дефисов
const BRAND_KEY_SQL = "UPPER(regexp_replace(COALESCE(p.brand, ''), '[[:space:]-]', '', 'g'))";

const BRAND_GROUP_SQL = `(CASE WHEN ${BRAND_KEY_SQL} = ANY(${textArrayLiteral(BRAND_GROUP_1_KEYS)}) THEN 1
  WHEN ${BRAND_KEY_SQL} = ANY(${textArrayLiteral(BRAND_GROUP_2_KEYS)}) THEN 2 ELSE 3 END)`;

// "ORDER BY …" для запросов, где товары — это таблица products с псевдонимом p
export function buildPopularOrderBy(soldProductIds: string[]): string {
  const ids = soldProductIds.filter((id) => UUID_RE.test(id));
  const soldSql = ids.length > 0 ? `(p.id = ANY(ARRAY[${ids.map((id) => `'${id}'`).join(',')}]::uuid[]))` : 'FALSE';
  return `ORDER BY (p.stock > 0) DESC, ${soldSql} DESC, (p.image_url IS NOT NULL) DESC, ${BRAND_GROUP_SQL} ASC, p.retail_price ASC`;
}

// То же сравнение в JavaScript — для хабов моделей (lib/modelHubData.ts),
// где товары сортируются уже после загрузки
export function comparePopular(
  a: { id: string; stock: number; imageUrl: string | null; brand: string | null; retailPrice: number },
  b: { id: string; stock: number; imageUrl: string | null; brand: string | null; retailPrice: number },
  soldIds: Set<string>
): number {
  return (
    Number(b.stock > 0) - Number(a.stock > 0) ||
    Number(soldIds.has(b.id)) - Number(soldIds.has(a.id)) ||
    Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) ||
    getBrandGroup(a.brand) - getBrandGroup(b.brand) ||
    a.retailPrice - b.retailPrice
  );
}
