// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/orders/[id]/repeat
//
// Кнопка "Повторити замовлення" в окне заказа — для постоянных клиентов,
// которые регулярно берут одно и то же (масло, фильтры, колодки).
//
// Создаёт НОВЫЙ заказ (статус "Новое") для того же клиента, с той же
// доставкой (город/отделение, в том числе Ref-ы Новой Почты для
// создания ТТН), тем же авто/VIN и теми же товарами в тех же
// количествах — но по АКТУАЛЬНЫМ ценам каталога (цены за это время
// могли измениться), с учётом персонального правила цены клиента, так
// же, как при оформлении заказа менеджером
// (app/api/admin/orders/create/route.ts).
//
// Не переносятся: отменённые и возвращённые позиции, а также товары,
// которых уже нет в каталоге (их список возвращаем, чтобы менеджер знал).
//
//   Ответ: { success, orderId, orderNumber, skipped: ['артикул', ...] }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { computeCustomerPrice, type CustomerPricingRule } from '@/lib/customerPricing';
import { normalizePhone } from '@/lib/phoneNormalize';
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

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: sourceOrderId } = await context.params;
  if (!UUID_PATTERN.test(sourceOrderId)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sourceResult = await client.query(
      `SELECT order_number, customer_id, customer_name, customer_surname, customer_phone, city, nova_poshta_address,
              city_ref, warehouse_ref, car_info, vin
       FROM orders WHERE id = $1`,
      [sourceOrderId]
    );
    if (sourceResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ не найден.' }, { status: 404 });
    }
    const source = sourceResult.rows[0];

    // Позиции исходного заказа + их товар в каталоге СЕЙЧАС (LEFT JOIN:
    // товара могло уже не стать — тогда p.id будет NULL)
    const itemsResult = await client.query(
      `
      SELECT oi.article, oi.quantity,
             p.id AS product_id, p.brand, p.name, p.cost_price, p.retail_price, p.supplier_id,
             s.name AS supplier_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE oi.order_id = $1 AND oi.status NOT IN ('cancelled', 'returned')
      ORDER BY oi.created_at ASC
      `,
      [sourceOrderId]
    );
    const available = itemsResult.rows.filter((row) => row.product_id);
    const skipped: string[] = itemsResult.rows.filter((row) => !row.product_id).map((row) => row.article);

    if (available.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Жодного товару з цього замовлення вже немає в каталозі — повторити нічого.' },
        { status: 400 }
      );
    }

    // Персональное правило цены клиента — как при оформлении менеджером
    const ruleResult = await client.query<{ rule_type: 'discount' | 'markup'; percent: string }>(
      'SELECT rule_type, percent FROM customer_pricing_rules WHERE phone = $1',
      [normalizePhone(source.customer_phone || '')]
    );
    const pricingRule: CustomerPricingRule | null = ruleResult.rows[0]
      ? { ruleType: ruleResult.rows[0].rule_type, percent: parseFloat(ruleResult.rows[0].percent) }
      : null;

    const orderResult = await client.query<{ id: string; order_number: number }>(
      `
      INSERT INTO orders (customer_id, customer_name, customer_surname, customer_phone, city, nova_poshta_address,
                          city_ref, warehouse_ref, car_info, vin, comment, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'new')
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
        `Повтор замовлення №${source.order_number}`,
      ]
    );
    const newOrder = orderResult.rows[0];

    let total = 0;
    for (const row of available) {
      const price = computeCustomerPrice(parseFloat(row.cost_price), parseFloat(row.retail_price), pricingRule);
      total += price * row.quantity;
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          newOrder.id,
          row.product_id,
          row.article,
          row.brand,
          row.name,
          price,
          parseFloat(row.cost_price),
          row.quantity,
          row.supplier_id,
          row.supplier_name,
        ]
      );
    }

    await client.query('COMMIT');

    await logOrderEvent(newOrder.id, `Створено як повтор замовлення №${source.order_number} (${historyMoney(total)})`);
    await logOrderEvent(sourceOrderId, `Повторено: створено замовлення №${newOrder.order_number}`);

    return NextResponse.json(
      { success: true, orderId: newOrder.id, orderNumber: newOrder.order_number, skipped },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при повторе заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не вдалося повторити замовлення: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
