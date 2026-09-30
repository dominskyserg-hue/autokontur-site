// ============================================================
// Свободный остаток на НАШЕМ складе — для кнопки "Взяти з нашого
// складу" в окне заказа.
//
// Остаток на складе = сумма движений stock_movements по товару (так же
// считает раздел "Склад", app/api/admin/warehouse/route.ts). Но часть
// этого остатка уже может быть отложена под другие заказы: позиции в
// статусе 'in_stock' ещё не отгруженных заказов (списание со склада
// происходит только при отгрузке). Поэтому
//
//     свободно = остаток − отложено под другие неотгруженные заказы
//
// Ищем по АРТИКУЛУ, а не по конкретному товару позиции: деталь могла
// прийти на склад от одного поставщика, а в заказ попасть из прайса
// другого — физически это та же деталь на нашей полке.
// ============================================================

import type { Pool, PoolClient } from 'pg';

export interface WarehouseAvailability {
  productId: string;
  article: string;
  brand: string | null;
  supplierId: string;
  supplierName: string;
  balance: number;
  reserved: number;
  available: number;
  // Закупочная цена детали на складе: цена последнего прихода от
  // поставщика, а если приходов не было (оприходовали вручную) —
  // закупочная цена из прайса
  costPrice: number;
}

// articles — список очищенных артикулов; excludeOrderItemId — позиция,
// для которой ищем (её собственный резерв не считаем, чтобы повторное
// нажатие не "съедало" остаток само у себя)
export async function getWarehouseAvailability(
  db: Pool | PoolClient,
  articles: string[],
  excludeOrderItemId: string | null = null
): Promise<WarehouseAvailability[]> {
  if (articles.length === 0) return [];

  const result = await db.query(
    `
    SELECT * FROM (
      SELECT
        p.id,
        p.article,
        p.brand,
        p.supplier_id,
        s.name AS supplier_name,
        p.cost_price,
        COALESCE((SELECT SUM(sm.quantity_change) FROM stock_movements sm WHERE sm.product_id = p.id), 0)::int AS balance,
        COALESCE((
          SELECT SUM(oi.quantity)
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = p.id
            AND oi.status = 'in_stock'
            AND o.status NOT IN ('shipped', 'cancelled')
            AND ($2::uuid IS NULL OR oi.id <> $2::uuid)
        ), 0)::int AS reserved,
        (
          SELECT sii.cost_price
          FROM supplier_invoice_items sii
          JOIN supplier_invoices si ON si.id = sii.invoice_id
          WHERE sii.product_id = p.id
          ORDER BY si.created_at DESC
          LIMIT 1
        ) AS last_receipt_cost
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.article = ANY($1::text[])
    ) AS t
    WHERE balance - reserved > 0
    ORDER BY balance - reserved DESC
    `,
    [articles, excludeOrderItemId]
  );

  return result.rows.map((row) => ({
    productId: row.id,
    article: row.article,
    brand: row.brand,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    balance: row.balance,
    reserved: row.reserved,
    available: row.balance - row.reserved,
    // NUMERIC драйвер pg отдаёт строкой — переводим в число
    costPrice: parseFloat(row.last_receipt_cost ?? row.cost_price),
  }));
}
