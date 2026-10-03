// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/discount
//
// Скидка на ВЕСЬ заказ — кнопка "Знижка" в окне заказа.
//
//   Тело запроса:
//     { type: 'percent', value: 5 }    — минус 5% от цены каждой позиции
//     { type: 'amount',  value: 200 }  — минус 200 грн на весь заказ,
//                                        раскладываются по позициям
//                                        пропорционально их сумме
//
// Скидка применяется прямо к ценам продажи позиций (order_items.price) —
// так её автоматически учитывают итог заказа, бейдж оплаты, прибыль,
// счёт и накладная, ничего отдельно пересчитывать не нужно. Скидку на
// одну позицию делают в форме редактирования позиции (кнопки "−5%",
// "−10%"), этот роут — для всего заказа сразу.
//
// Меняются только "живые" позиции (не отгруженные, не возвращённые и не
// отменённые) и только если сам заказ ещё не отгружен: после отгрузки
// сумма уже начислена клиенту, и менять её задним числом нельзя.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { logOrderEvent, historyMoney } from '@/lib/orderHistory';

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

// Округление до копеек
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: orderId } = await context.params;
  if (!UUID_PATTERN.test(orderId)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: { type?: string; value?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const type = body.type;
  const value = Number(body.value);
  if (type !== 'percent' && type !== 'amount') {
    return NextResponse.json({ error: 'Тип знижки має бути percent або amount.' }, { status: 400 });
  }
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: 'Розмір знижки має бути числом більше нуля.' }, { status: 400 });
  }
  if (type === 'percent' && value >= 100) {
    return NextResponse.json({ error: 'Знижка у відсотках має бути менше 100%.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    if (orderResult.rows[0].status === 'shipped') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ уже отгружен — менять цены нельзя.' }, { status: 400 });
    }

    const itemsResult = await client.query(
      `SELECT id, price, quantity FROM order_items
       WHERE order_id = $1 AND status NOT IN ('shipped', 'returned', 'cancelled')
       ORDER BY price * quantity DESC`,
      [orderId]
    );
    const items = itemsResult.rows.map((row) => ({
      id: row.id as string,
      price: parseFloat(row.price),
      quantity: row.quantity as number,
    }));
    const totalBefore = roundMoney(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
    if (items.length === 0 || totalBefore <= 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'У заказі немає позицій, на які можна дати знижку.' }, { status: 400 });
    }
    if (type === 'amount' && value >= totalBefore) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Знижка (${historyMoney(value)}) не може бути більшою за суму заказу (${historyMoney(totalBefore)}).` },
        { status: 400 }
      );
    }

    // Новая цена за штуку для каждой позиции
    for (const item of items) {
      let newPrice: number;
      if (type === 'percent') {
        newPrice = roundMoney(item.price * (1 - value / 100));
      } else {
        // Доля позиции в сумме заказа -> её доля скидки, на одну штуку
        const lineShare = (item.price * item.quantity) / totalBefore;
        newPrice = roundMoney(item.price - (value * lineShare) / item.quantity);
      }
      await client.query('UPDATE order_items SET price = $2 WHERE id = $1', [item.id, Math.max(0, newPrice)]);
    }

    const totalAfterResult = await client.query(
      `SELECT COALESCE(SUM(price * quantity), 0) AS total FROM order_items
       WHERE order_id = $1 AND status NOT IN ('shipped', 'returned', 'cancelled')`,
      [orderId]
    );
    const totalAfter = parseFloat(totalAfterResult.rows[0].total);

    await client.query('COMMIT');

    await logOrderEvent(
      orderId,
      `Знижка на замовлення ${type === 'percent' ? `${value}%` : historyMoney(value)}: ` +
        `${historyMoney(totalBefore)} → ${historyMoney(totalAfter)}`
    );

    return NextResponse.json({ success: true, totalBefore, totalAfter });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при применении скидки к заказу:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не вдалося застосувати знижку: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
