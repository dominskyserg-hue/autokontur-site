// ============================================================
// "Наш склад" на витрине: какие детали физически лежат у НАС (а не у
// поставщика) и свободны для продажи — такие покупатель получает
// быстрее всего, поэтому на сайте они:
//   - идут первыми в сортировке "За популярністю" (lib/popularitySort.ts:
//     поиск, категории, страницы марок);
//   - помечаются бейджем "На нашому складі · відправка сьогодні".
//
// Свободный остаток считается так же, как в окне заказа
// (lib/warehouseStock.ts): сумма движений stock_movements по товару минус
// то, что уже отложено под неотгруженные заказы (позиции 'in_stock').
// Ключ — артикул + бренд (одна и та же деталь могла прийти от разных
// поставщиков, а на витрине они объединены в одну карточку — группу
// бренд+артикул, lib/productGroups.ts).
//
// Складских деталей — десятки/сотни, а не тысячи, поэтому список ключей
// берём одним запросом и кэшируем в памяти на 2 минуты, а в сортировку
// подставляем готовым списком (тот же приём, что и "продано за 180 дней").
// ============================================================

import type { Pool } from 'pg';

const CACHE_TTL_MS = 2 * 60 * 1000;

let cache: { keys: string[]; at: number } | null = null;

// Нормализация бренда — как BRAND_KEY_SQL в lib/popularitySort.ts
// (верхний регистр, без пробелов и дефисов)
export function ownStockBrandKey(brand: string | null | undefined): string {
  return (brand || '').replace(/[\s-]/g, '').toUpperCase();
}

export function ownStockKey(article: string, brand: string | null | undefined): string {
  return `${article}|${ownStockBrandKey(brand)}`;
}

// Список ключей "артикул|БРЕНД" деталей со свободным остатком на нашем
// складе. Ошибка базы — пустой список: витрина просто не покажет бейдж
// и не поднимет эти товары в сортировке, но страница не упадёт
export async function getOwnStockKeys(pool: Pool): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.keys;
  try {
    const result = await pool.query<{ key: string }>(`
      WITH balances AS (
        SELECT product_id, SUM(quantity_change) AS balance
        FROM stock_movements
        GROUP BY product_id
      ),
      reserved AS (
        SELECT oi.product_id, SUM(oi.quantity) AS qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.status = 'in_stock' AND o.status NOT IN ('shipped', 'cancelled') AND oi.product_id IS NOT NULL
        GROUP BY oi.product_id
      )
      SELECT p.article || '|' || UPPER(regexp_replace(COALESCE(p.brand, ''), '[[:space:]-]', '', 'g')) AS key
      FROM balances b
      JOIN products p ON p.id = b.product_id
      LEFT JOIN reserved r ON r.product_id = b.product_id
      GROUP BY 1
      HAVING SUM(b.balance - COALESCE(r.qty, 0)) > 0
    `);
    const keys = result.rows.map((row) => row.key);
    cache = { keys, at: Date.now() };
    return keys;
  } catch (error) {
    console.error('Ошибка при получении остатков нашего склада для витрины:', error);
    return cache?.keys ?? [];
  }
}

// Удобная проверка для одной детали (страница товара)
export async function isOwnStock(pool: Pool, article: string, brand: string | null): Promise<boolean> {
  const keys = await getOwnStockKeys(pool);
  return keys.includes(ownStockKey(article, brand));
}
