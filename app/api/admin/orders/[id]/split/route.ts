// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/orders/[id]/split
//
// Кнопка "Розділити замовлення" в окне заказа: часть деталей уже на
// складе и может ехать клиенту сейчас, а часть ещё идёт от поставщика.
// Выбранные позиции ПЕРЕНОСЯТСЯ в новый связанный заказ — исходный заказ
// с оставшимися (готовыми) позициями можно сразу отгружать.
//
//   Тело запроса: { itemIds: string[] }  — какие позиции перенести
//   Ответ: { success, orderId, orderNumber }  — новый заказ
//
// Как переносим:
//   - позиции переезжают целиком (UPDATE order_items SET order_id),
//     со своими статусами, ценами и поставщиками — поэтому уже
//     оформленная закупка у поставщика и приходы на склад остаются
//     привязанными к ним (stock_movements ссылается на позицию);
//   - новый заказ получает те же данные клиента, доставку (с Ref-ами
//     Новой Почты), авто/VIN и комментарий "Частина замовлення №X";
//   - оплаты ОСТАЮТСЯ в исходном заказе (cash_movements.order_id) —
//     переносить деньги между заказами автоматически нельзя, это решает
//     менеджер (например, принимает оплату за вторую часть отдельно);
//   - статусы обоих заказов пересчитываются по их позициям
//     (lib/orderStatusPipeline.ts).
// Нельзя перенести отгруженные/возвращённые/отменённые позиции и нельзя
// перенести ВСЕ позиции — в исходном заказе должна остаться хотя бы одна.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { autoAdvanceOrderStatus } from '@/lib/orderStatusPipeline';
import { logOrderEvent } from '@/lib/orderHistory';

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

const MOVABLE_STATUSES = ['pending', 'ordered_from_supplier', 'in_stock'];

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: sourceOrderId } = await context.params;
  if (!UUID_PATTERN.test(sourceOrderId)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: { itemIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((v): v is string => typeof v === 'string') : [];
  if (itemIds.length === 0 || !itemIds.every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'Оберіть позиції, які треба перенести в нове замовлення.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceResult = await client.query(
      `SELECT order_number, status, customer_id, customer_name, customer_surname, customer_phone, city,
              nova_poshta_address, city_ref, warehouse_ref, car_info, vin
       FROM orders WHERE id = $1 FOR UPDATE`,
      [sourceOrderId]
    );
    if (sourceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const source = sourceResult.rows[0];
    if (source.status === 'shipped' || source.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Відвантажене або скасоване замовлення розділити не можна.' }, { status: 400 });
    }

    const itemsResult = await client.query(
      `SELECT id, article, status FROM order_items WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned')`,
      [sourceOrderId]
    );
    const liveItems = itemsResult.rows;
    const toMove = liveItems.filter((item) => itemIds.includes(item.id));

    if (toMove.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Частину позицій не знайдено в цьому замовленні.' }, { status: 400 });
    }
    const notMovable = toMove.find((item) => !MOVABLE_STATUSES.includes(item.status));
    if (notMovable) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Позицію ${notMovable.article} вже відвантажено — її перенести не можна.` },
        { status: 400 }
      );
    }
    if (toMove.length >= liveItems.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'У вихідному замовленні має залишитись хоча б одна позиція.' },
        { status: 400 }
      );
    }

    // Статус нового заказа: не "дальше", чем у исходного, — дальше его
    // сам сдвинет пересчёт по позициям ниже
    const newStatus = source.status === 'new' ? 'new' : 'processing';
    const newOrderResult = await client.query<{ id: string; order_number: number }>(
      `
      INSERT INTO orders (customer_id, customer_name, customer_surname, customer_phone, city, nova_poshta_address,
                          city_ref, warehouse_ref, car_info, vin, comment, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, order_number
      `,
      [
        source.customer_id,
        source.customer_name,
        source.customer_surname,
        source.customer_phone,
        source.city,
        source.nova_poshta_address,
        source.city_ref,
        source.warehouse_ref,
        source.car_info,
        source.vin,
        `Частина замовлення №${source.order_number}`,
        newStatus,
      ]
    );
    const newOrder = newOrderResult.rows[0];

    await client.query('UPDATE order_items SET order_id = $2 WHERE id = ANY($1::uuid[]) AND order_id = $3', [
      itemIds,
      newOrder.id,
      sourceOrderId,
    ]);

    // Статусы обоих заказов — по их новым составам
    await autoAdvanceOrderStatus(client, sourceOrderId);
    await autoAdvanceOrderStatus(client, newOrder.id);

    await client.query('COMMIT');

    const articles = toMove.map((item) => item.article).join(', ');
    await logOrderEvent(
      sourceOrderId,
      `Розділено: позиції ${articles} перенесено в замовлення №${newOrder.order_number}`
    );
    await logOrderEvent(
      newOrder.id,
      `Створено при розділенні замовлення №${source.order_number}: позиції ${articles}. Оплати лишились у №${source.order_number}`
    );

    return NextResponse.json(
      { success: true, orderId: newOrder.id, orderNumber: newOrder.order_number },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при разделении заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не вдалося розділити замовлення: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
