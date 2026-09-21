// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/procurement/mark-in-stock
//
// Короткий путь в обход шагов 1-2 закупочного цикла: товар для этой
// позиции заказа УЖЕ физически лежит на складе (остатки пополняются
// отдельно — автозагрузкой прайс-листов поставщиков, см.
// lib/priceListImport.ts) — заказывать его у поставщика заново не
// нужно, достаточно просто подтвердить, что он зарезервирован под
// этот заказ.
//
//   Тело запроса: { orderItemId: string }
//
// Проверяет, что products.stock у этого товара хватает на количество
// в заказе, и если да — сразу переводит order_items.status
// 'pending' -> 'in_stock', БЕЗ движения склада (stock_movements) и без
// изменения products.stock: списание произойдёт позже, одним разом
// при финальной отгрузке заказа (PATCH /api/orders/[id] со
// status='shipped') — так остаток считается ровно один раз, а не
// дважды (тут и при отгрузке)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { autoAdvanceOrderStatus } from '@/lib/orderStatusPipeline';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestBody {
  orderItemId?: string;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (typeof body.orderItemId !== 'string' || !UUID_PATTERN.test(body.orderItemId)) {
    return NextResponse.json({ error: 'Укажите корректный orderItemId.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemResult = await client.query(
      `
      SELECT oi.id, oi.order_id, oi.product_id, oi.article, oi.name, oi.quantity, oi.status, p.stock AS current_stock
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE oi.id = $1
      FOR UPDATE OF oi
      `,
      [body.orderItemId]
    );

    if (itemResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Позиция заказа не найдена.' }, { status: 404 });
    }

    const item = itemResult.rows[0];

    if (item.status !== 'pending') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Позиция уже не в статусе "Ожидает закупки" (сейчас: ${item.status}).` },
        { status: 400 }
      );
    }

    if (!item.product_id) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Товар этой позиции удалён из каталога — остаток проверить нельзя, оформите приход накладной вручную.' },
        { status: 400 }
      );
    }

    if (item.current_stock < item.quantity) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: `На складе недостаточно товара «${item.name || item.article}»: в наличии ${item.current_stock}, нужно ${item.quantity}. Оформите закупку у поставщика.`,
        },
        { status: 400 }
      );
    }

    await client.query(`UPDATE order_items SET status = 'in_stock' WHERE id = $1`, [item.id]);
    await autoAdvanceOrderStatus(client, item.order_id);

    await client.query('COMMIT');

    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при отметке позиции как имеющейся на складе:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось обновить позицию: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
