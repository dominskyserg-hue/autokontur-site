// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/procurement/needed?status=pending|ordered_from_supplier
//
// Отдаёт order_items определённого статуса закупочного цикла,
// сгруппированные по поставщику — экран "Закупки"
// (components/ProcurementScreen.tsx) использует один и тот же роут для
// двух своих вкладок:
//
//   status=pending                — "Нужно заказать": позиции, которые
//                                    ещё нужно либо заказать у
//                                    поставщика, либо (если товар уже
//                                    реально есть на складе) просто
//                                    отметить как готовые без похода к
//                                    поставщику (см. currentStock ниже
//                                    и POST .../mark-in-stock)
//   status=ordered_from_supplier  — "Ожидают приёмки": уже заказанные
//                                    у поставщика позиции, по которым
//                                    можно оформить приход (см.
//                                    remainingToReceive ниже и
//                                    POST .../receive)
//
// В обоих случаях родительский заказ должен быть ещё не отменён и не
// отгружен (у отменённого/уже отгруженного заказа закупать для него
// больше нечего), а позиции группируются по supplier_id — это и есть
// заготовка заказа/накладной конкретному поставщику. Позиции без
// поставщика (supplier_id = NULL — редкий случай, когда поставщика уже
// удалили из справочника) идут отдельной группой.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureOrderItemProcurementColumns, KYIV_TODAY_SQL } from '@/lib/orderItemColumns';

export const runtime = 'nodejs';

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

const ALLOWED_STATUSES = ['pending', 'ordered_from_supplier'] as const;

interface NeededItem {
  id: string; // id позиции order_items
  orderId: string;
  article: string;
  brand: string | null;
  name: string | null;
  quantity: number;
  costPrice: number;
  // Только для status=pending — текущий остаток на складе (null,
  // если товар уже удалён из каталога)
  currentStock: number | null;
  // Только для status=ordered_from_supplier — сколько из заказанного
  // ещё не приехало (quantity минус уже принятое по прошлым частичным
  // накладным, см. app/api/admin/procurement/receive/route.ts)
  remainingToReceive: number | null;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  orderStatus: string;
  orderCreatedAt: string;
  // Только для status=pending — выгоднее предложение у другого поставщика
  // (null, если лучше текущего ничего нет)
  betterOffer: BetterOffer | null;
  // Только для status=ordered_from_supplier — когда заказали у поставщика,
  // когда он обещал привезти (YYYY-MM-DD) и сколько дней уже опаздывает
  supplierOrderedAt: string | null;
  expectedAt: string | null;
  daysLate: number;
}

// Лучшее предложение того же артикула у другого поставщика
interface BetterOffer {
  productId: string;
  supplierName: string;
  costPrice: number;
  stock: number;
  // 'cheaper' — дешевле по закупке; 'in_stock' — у текущего поставщика
  // нет в наличии, а у этого есть (цена может быть и выше)
  reason: 'cheaper' | 'in_stock';
  // Экономия на всю позицию (разница закупки × количество); 0 для 'in_stock' дороже
  saving: number;
}

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  items: NeededItem[];
}

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const statusParam = request.nextUrl.searchParams.get('status') || 'pending';
  if (!(ALLOWED_STATUSES as readonly string[]).includes(statusParam)) {
    return NextResponse.json({ error: `status должен быть одним из: ${ALLOWED_STATUSES.join(', ')}.` }, { status: 400 });
  }

  try {
    await ensureOrderItemProcurementColumns();

    // Бренд сравниваем без регистра, пробелов и знаков ("Hyundai/Kia" =
    // "HYUNDAI KIA") — так же, как в app/api/admin/products/offers/route.ts
    const brandKey = (column: string) =>
      `regexp_replace(upper(COALESCE(${column}, '')), '[^A-Z0-9А-ЯЁІЇЄҐ]', '', 'g')`;

    const result = await pool.query(
      `
      SELECT
        oi.id, oi.order_id, oi.article, oi.brand, oi.name, oi.quantity, oi.cost_price,
        oi.supplier_id, oi.supplier_name, p.stock AS current_stock,
        COALESCE(recv.total_received, 0) AS total_received,
        oi.supplier_ordered_at,
        to_char(oi.expected_at, 'YYYY-MM-DD') AS expected_at,
        GREATEST(0, ${KYIV_TODAY_SQL} - oi.expected_at)::int AS days_late,
        alt.id AS alt_product_id, alt.supplier_name AS alt_supplier_name,
        alt.cost_price AS alt_cost_price, alt.stock AS alt_stock,
        o.customer_name, o.customer_surname, o.customer_phone, o.status AS order_status, o.created_at AS order_created_at
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN (
        SELECT order_item_id, SUM(quantity_change) AS total_received
        FROM stock_movements
        WHERE reason = 'supplier_receipt'
        GROUP BY order_item_id
      ) recv ON recv.order_item_id = oi.id
      -- Лучшее предложение у ДРУГОГО поставщика (только для "Нужно заказать"):
      -- в наличии и либо дешевле по закупке, либо у текущего товара нет
      -- остатка. Из подходящих — самое дешёвое
      LEFT JOIN LATERAL (
        SELECT p2.id, s2.name AS supplier_name, p2.cost_price, p2.stock
        FROM products p2
        JOIN suppliers s2 ON s2.id = p2.supplier_id
        WHERE $1 = 'pending'
          AND p2.article = oi.article
          AND ${brandKey('p2.brand')} = ${brandKey('oi.brand')}
          AND p2.is_active
          AND s2.is_active
          AND p2.stock > 0
          AND p2.supplier_id IS DISTINCT FROM oi.supplier_id
          AND (p2.cost_price < oi.cost_price - 0.009 OR COALESCE(p.stock, 0) <= 0)
        ORDER BY p2.cost_price ASC
        LIMIT 1
      ) alt ON true
      WHERE oi.status = $1 AND o.status NOT IN ('cancelled', 'shipped')
      ORDER BY oi.supplier_name NULLS LAST, o.created_at ASC
      `,
      [statusParam]
    );

    const groupsBySupplier = new Map<string, SupplierGroup>();

    for (const row of result.rows) {
      const key = row.supplier_id || '__none__';
      let group = groupsBySupplier.get(key);
      if (!group) {
        group = {
          supplierId: row.supplier_id,
          supplierName: row.supplier_name || 'Без поставщика',
          items: [],
        };
        groupsBySupplier.set(key, group);
      }

      const item: NeededItem = {
        id: row.id,
        orderId: row.order_id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        quantity: row.quantity,
        // NUMERIC из pg приходит строкой — явно переводим в число
        costPrice: parseFloat(row.cost_price),
        currentStock: statusParam === 'pending' ? (row.current_stock === null ? null : Number(row.current_stock)) : null,
        remainingToReceive:
          statusParam === 'ordered_from_supplier' ? row.quantity - parseInt(row.total_received, 10) : null,
        customerName: row.customer_name,
        customerSurname: row.customer_surname,
        customerPhone: row.customer_phone,
        orderStatus: row.order_status,
        orderCreatedAt: row.order_created_at,
        betterOffer: null,
        supplierOrderedAt: row.supplier_ordered_at,
        expectedAt: row.expected_at,
        daysLate: row.days_late ?? 0,
      };
      if (row.alt_product_id) {
        const altCost = parseFloat(row.alt_cost_price);
        const cheaper = altCost < item.costPrice - 0.009;
        item.betterOffer = {
          productId: row.alt_product_id,
          supplierName: row.alt_supplier_name,
          costPrice: altCost,
          stock: Number(row.alt_stock),
          reason: cheaper ? 'cheaper' : 'in_stock',
          saving: cheaper ? Math.round((item.costPrice - altCost) * item.quantity * 100) / 100 : 0,
        };
      }
      group.items.push(item);
    }

    return NextResponse.json({ success: true, groups: Array.from(groupsBySupplier.values()) });
  } catch (error) {
    console.error('Ошибка при получении потребности в закупках:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список закупок: ' + message }, { status: 500 });
  }
}
