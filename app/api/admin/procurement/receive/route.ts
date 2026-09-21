// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/procurement/receive
//
// Шаг 2 закупочного цикла: поставщик привёз товар, менеджер оформляет
// приходную накладную по конкретным позициям заказов клиентов (в
// отличие от app/api/admin/suppliers/[id]/invoices/route.ts — та
// накладная чисто финансовая, без построчного состава и без связи с
// заказами; эта — специально под цепочку "заказ клиента -> закупка").
//
//   Тело запроса:
//   {
//     supplierId: string,
//     invoiceNumber?: string,
//     comment?: string,
//     items: [{ orderItemId: string, quantity: number, costPrice: number }]
//   }
//
// ЧАСТИЧНЫЙ ПРИХОД: quantity позиции заказа (order_items.quantity) —
// это сколько было заказано клиентом. Поставщик мог привезти не всё
// сразу. Сколько уже фактически приехало по этой позиции РАНЕЕ, здесь
// не хранится отдельным полем — считается на лету суммой
// stock_movements.quantity_change с reason='supplier_receipt' и этим
// order_item_id (тот же принцип, что и remaining-quantity при частичных
// возвратах клиента, см. app/api/admin/orders/[id]/returns/route.ts).
// Позиция переходит в order_items.status='in_stock' только когда сумма
// всех приходов по ней достигла заказанного количества — если приехала
// только часть, статус остаётся 'ordered_from_supplier', а остаток
// нужно будет принять отдельной накладной позже.
//
// В одной транзакции:
//   1. supplier_invoices (шапка накладной) + supplier_invoice_items
//      (построчный состав) — источник для supplier_transactions ниже.
//   2. supplier_transactions (type='goods_received') — триггер сам
//      увеличит suppliers.balance (наш долг перед поставщиком).
//   3. На каждую позицию: stock_movements (+quantity, reason=
//      'supplier_receipt') и products.stock += quantity — физический
//      приход на склад.
//   4. Если позиция набрала полное заказанное количество —
//      order_items.status = 'in_stock'.
//   5. Для каждого затронутого заказа — проверка, не пора ли двинуть
//      вперёд orders.status (lib/orderStatusPipeline.ts).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient } from 'pg';
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

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

interface ReceiveItemInput {
  orderItemId?: string;
  quantity?: number;
  costPrice?: number;
}

interface ReceiveRequestBody {
  supplierId?: string;
  invoiceNumber?: string;
  comment?: string;
  items?: ReceiveItemInput[];
}

interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  article: string;
  brand: string | null;
  name: string | null;
  quantity: number;
  status: string;
  supplier_id: string | null;
}

export async function POST(request: NextRequest) {
  let body: ReceiveRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const supplierId = body.supplierId;
  if (!isValidUuid(supplierId)) {
    return NextResponse.json({ error: 'Укажите корректный id поставщика.' }, { status: 400 });
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: 'Укажите хотя бы одну принятую позицию.' }, { status: 400 });
  }

  const items: { orderItemId: string; quantity: number; costPrice: number }[] = [];
  for (const raw of rawItems) {
    if (!isValidUuid(raw.orderItemId)) {
      return NextResponse.json({ error: 'У каждой позиции нужен корректный orderItemId.' }, { status: 400 });
    }
    if (!Number.isInteger(raw.quantity) || (raw.quantity as number) <= 0) {
      return NextResponse.json({ error: `Некорректное количество для позиции ${raw.orderItemId}.` }, { status: 400 });
    }
    if (!Number.isFinite(raw.costPrice) || (raw.costPrice as number) < 0) {
      return NextResponse.json({ error: `Некорректная закупочная цена для позиции ${raw.orderItemId}.` }, { status: 400 });
    }
    items.push({ orderItemId: raw.orderItemId as string, quantity: raw.quantity as number, costPrice: raw.costPrice as number });
  }

  const invoiceNumber = (body.invoiceNumber || '').trim() || null;
  const comment = (body.comment || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplierCheck = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Поставщик не найден.' }, { status: 404 });
    }

    const orderItemIds = items.map((item) => item.orderItemId);
    const orderItemsResult = await client.query<OrderItemRow>(
      `
      SELECT id, order_id, product_id, article, brand, name, quantity, status, supplier_id
      FROM order_items
      WHERE id = ANY($1::uuid[])
      `,
      [orderItemIds]
    );
    const orderItemById = new Map(orderItemsResult.rows.map((row) => [row.id, row]));

    // ---- валидация КАЖДОЙ позиции до единой вставки в базу ----
    // (лучше отклонить весь запрос сразу с понятной ошибкой, чем
    // наполовину провести накладную)
    for (const item of items) {
      const orderItem = orderItemById.get(item.orderItemId);
      if (!orderItem) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `Позиция заказа ${item.orderItemId} не найдена.` }, { status: 404 });
      }
      if (orderItem.supplier_id !== supplierId) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Позиция «${orderItem.name || orderItem.article}» относится к другому поставщику.` },
          { status: 400 }
        );
      }
      if (orderItem.status !== 'ordered_from_supplier') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Позиция «${orderItem.name || orderItem.article}» не в статусе "Заказано у поставщика" (сейчас: ${orderItem.status}) — сначала оформите заказ поставщику.`,
          },
          { status: 400 }
        );
      }

      const alreadyReceived = await getAlreadyReceived(client, orderItem.id);
      const remaining = orderItem.quantity - alreadyReceived;
      if (item.quantity > remaining) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `По позиции «${orderItem.name || orderItem.article}» осталось принять не больше ${remaining} шт. (заказано ${orderItem.quantity}, уже принято ${alreadyReceived}), а указано ${item.quantity}.`,
          },
          { status: 400 }
        );
      }
    }

    // ---- сама накладная ----
    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.costPrice, 0);

    // Если все принятые позиции — из одного заказа клиента, привязываем
    // накладную к нему (удобно видеть в карточке заказа); если из
    // нескольких (обычная ситуация — один поставщик обычно везёт сразу
    // под несколько заказов) — оставляем order_id пустым
    const distinctOrderIds = new Set(items.map((item) => orderItemById.get(item.orderItemId)!.order_id));
    const singleOrderId = distinctOrderIds.size === 1 ? Array.from(distinctOrderIds)[0] : null;

    const invoiceResult = await client.query(
      `
      INSERT INTO supplier_invoices (supplier_id, invoice_number, total_amount, order_id, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [supplierId, invoiceNumber, totalAmount, singleOrderId, comment]
    );
    const invoiceId = invoiceResult.rows[0].id;

    await client.query(
      `
      INSERT INTO supplier_transactions (supplier_id, amount, type, invoice_id, comment, created_by)
      VALUES ($1, $2, 'goods_received', $3, $4, 'admin')
      `,
      [supplierId, totalAmount, invoiceId, comment]
    );

    for (const item of items) {
      const orderItem = orderItemById.get(item.orderItemId)!;

      const invoiceItemResult = await client.query(
        `
        INSERT INTO supplier_invoice_items (invoice_id, product_id, article, brand, name, quantity, cost_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [invoiceId, orderItem.product_id, orderItem.article, orderItem.brand, orderItem.name, item.quantity, item.costPrice]
      );
      const invoiceItemId = invoiceItemResult.rows[0].id;

      // product_id может быть пуст, если товар успели удалить из
      // каталога уже ПОСЛЕ того, как заказ клиента был оформлен (сам
      // order_items — "снимок" и не зависит от каталога, см. секцию 7
      // schema.sql). В этом случае физический приход на склад
      // зафиксировать некуда (products.stock ссылается на удалённый
      // товар) — пропускаем только эту часть, а позицию заказа всё
      // равно закрываем целиком, раз накладная её покрыла
      if (orderItem.product_id) {
        await client.query(
          `
          INSERT INTO stock_movements (product_id, quantity_change, reason, order_item_id, supplier_invoice_item_id)
          VALUES ($1, $2, 'supplier_receipt', $3, $4)
          `,
          [orderItem.product_id, item.quantity, orderItem.id, invoiceItemId]
        );
        await client.query('UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1', [
          orderItem.product_id,
          item.quantity,
        ]);
      }

      const alreadyReceived = await getAlreadyReceived(client, orderItem.id);
      const totalReceivedNow = orderItem.product_id ? alreadyReceived : orderItem.quantity; // без product_id считаем закрытой сразу целиком (см. комментарий выше)
      if (totalReceivedNow >= orderItem.quantity) {
        await client.query(`UPDATE order_items SET status = 'in_stock' WHERE id = $1`, [orderItem.id]);
      }
    }

    for (const orderId of distinctOrderIds) {
      await autoAdvanceOrderStatus(client, orderId);
    }

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM suppliers WHERE id = $1', [supplierId]);

    return NextResponse.json(
      {
        success: true,
        invoiceId,
        totalAmount,
        newSupplierBalance: parseFloat(balanceResult.rows[0].balance),
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при оформлении приходной накладной:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось оформить приход товара: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}

// Сколько всего уже реально принято на склад по этой позиции заказа
// РАНЕЕ (не считая текущей накладной, которая ещё не вставлена в
// момент валидации) — сумма всех stock_movements с этим order_item_id
// и reason='supplier_receipt'
async function getAlreadyReceived(client: PoolClient, orderItemId: string): Promise<number> {
  const result = await client.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(quantity_change), 0) AS total FROM stock_movements WHERE order_item_id = $1 AND reason = 'supplier_receipt'`,
    [orderItemId]
  );
  return parseInt(result.rows[0].total || '0', 10);
}
