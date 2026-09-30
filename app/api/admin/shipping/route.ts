// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/shipping
//
// Список заказов, которые готовы к отгрузке прямо сейчас: статус
// "На складе" (in_stock) или "Готов к выдаче" (ready_for_pickup).
// Используется экраном "К отгрузке" (components/ShippingScreen.tsx),
// где оператор отмечает сразу несколько заказов галочками и одной
// кнопкой создаёт ТТН, печатает маркировки и отмечает их отгруженными.
//
// Сами действия выполняют уже существующие роуты — этот файл только
// собирает список:
//   POST  /api/orders/[id]/create-ttn   — создать ТТН
//   GET   /api/admin/shipping/labels    — маркировки пачкой одним PDF
//   PATCH /api/orders/[id] {status}     — отгрузить (списание склада,
//                                          начисление клиенту)
// ============================================================

import { NextResponse } from 'next/server';
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

// Больше этого за раз на полке обычно не бывает — ограничение просто
// страховка, чтобы экран не пытался нарисовать тысячи строк
const MAX_ORDERS = 300;

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    // Сумма и оплата считаются ТОЧНО так же, как в списке заказов
    // (app/api/orders/route.ts) — чтобы цифры на двух экранах совпадали
    const result = await pool.query(
      `
      SELECT
        o.id,
        o.order_number,
        o.customer_name,
        o.customer_surname,
        o.customer_phone,
        o.status,
        o.city,
        o.nova_poshta_address,
        o.city_ref,
        o.warehouse_ref,
        o.ttn_number,
        o.ttn_ref,
        o.created_at,
        COUNT(oi.id) AS items_count,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount,
        COALESCE(
          (SELECT SUM(cm.amount) FROM cash_movements cm
           WHERE cm.order_id = o.id AND cm.type IN ('customer_payment', 'customer_prepayment', 'customer_refund')),
          0
        ) AS paid_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status IN ('in_stock', 'ready_for_pickup')
      GROUP BY o.id
      ORDER BY o.created_at ASC
      LIMIT ${MAX_ORDERS}
      `
    );

    return NextResponse.json({
      success: true,
      orders: result.rows.map((row) => ({
        id: row.id,
        orderNumber: row.order_number,
        customerName: row.customer_name,
        customerSurname: row.customer_surname,
        customerPhone: row.customer_phone,
        status: row.status,
        city: row.city,
        novaPoshtaAddress: row.nova_poshta_address,
        // Можно ли создать ТТН без ручного выбора отделения: покупатель
        // выбрал город и отделение из списка Новой Почты на сайте
        hasDeliveryRefs: Boolean(row.city_ref && row.warehouse_ref),
        cityRef: row.city_ref,
        warehouseRef: row.warehouse_ref,
        ttnNumber: row.ttn_number,
        hasTtnLabel: Boolean(row.ttn_ref),
        createdAt: row.created_at,
        itemsCount: parseInt(row.items_count, 10),
        // SUM() по NUMERIC драйвер pg отдаёт строкой — переводим в число
        totalAmount: parseFloat(row.total_amount),
        paidAmount: parseFloat(row.paid_amount),
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении заказов к отгрузке:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить заказы к отгрузке: ' + message }, { status: 500 });
  }
}
