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
    const result = await pool.query(
      `
      SELECT
        oi.id, oi.order_id, oi.article, oi.brand, oi.name, oi.quantity, oi.cost_price,
        oi.supplier_id, oi.supplier_name, p.stock AS current_stock,
        COALESCE(recv.total_received, 0) AS total_received,
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
      };
      group.items.push(item);
    }

    return NextResponse.json({ success: true, groups: Array.from(groupsBySupplier.values()) });
  } catch (error) {
    console.error('Ошибка при получении потребности в закупках:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список закупок: ' + message }, { status: 500 });
  }
}
