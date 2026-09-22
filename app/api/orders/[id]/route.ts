// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders/[id]  (например /api/orders/3fa85f64-...)
//
//   GET   — полная информация об ОДНОМ заказе: данные клиента,
//           статус и ВЕСЬ состав заказа (список товаров из
//           order_items — артикул, бренд, название, цена на момент
//           покупки, количество)
//   PATCH — сменить статус заказа (например, "new" -> "processing")
//
// [id] в имени папки — "динамический сегмент" маршрута Next.js:
// значение из адреса (/api/orders/ЗДЕСЬ) попадает в params.id
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { notifyCustomerTtnAssigned } from '@/lib/orderNotifications';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

// ------------------------------------------------------------
// СТАТУСЫ ЗАКАЗА — тот же набор, что и в app/api/orders/route.ts
// и в CHECK-ограничении orders.status из schema.sql
// ------------------------------------------------------------
const STATUS_VALUES = [
  'new',
  'processing',
  'ordered_from_supplier',
  'in_stock',
  'ready_for_pickup',
  'shipped',
  'cancelled',
] as const;
type OrderStatus = (typeof STATUS_VALUES)[number];

function isValidStatus(value: string): value is OrderStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Одна позиция (товар) внутри заказа — "снимок" на момент покупки
// (см. комментарий у таблицы order_items в schema.sql: цена, артикул,
// бренд и название сохранены прямо в order_items, а не читаются из
// текущего каталога products — так старый заказ не "поплывёт", даже
// если товар потом подорожает или его переименуют)
// ITEM_STATUS_VALUES — статус ОТДЕЛЬНОЙ позиции заказа в закупочном
// цикле (секция 28.3 schema.sql), независим от status самого заказа:
// одна деталь уже на складе, другая ещё едет от поставщика. Используется
// на экране "Закупки" (components/ProcurementScreen.tsx) и в панели
// деталей заказа, чтобы менеджер видел, чего в заказе ещё не хватает
const ITEM_STATUS_VALUES = ['pending', 'ordered_from_supplier', 'in_stock', 'shipped', 'cancelled', 'returned'] as const;
type OrderItemStatus = (typeof ITEM_STATUS_VALUES)[number];

interface OrderItemResponse {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
  supplierId: string | null;
  supplierName: string | null;
  status: OrderItemStatus;
}

interface OrderDetailsResponse {
  id: string;
  // Человекочитаемый номер заказа (1, 2, 3...) — см. lib/orderUi.ts
  orderNumber: number;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  comment: string | null;
  ttnNumber: string | null;
  // Ref документа в самій Новій Пошті — тільки якщо ТТН створили
  // кнопкою "Створити ТТН" (POST /api/orders/[id]/create-ttn), а не
  // вписали вручну. Потрібен лише щоб фронтенд знав, чи можна
  // запропонувати кнопку "Друкувати маркування" (app/api/orders/[id]/ttn-label/route.ts)
  ttnRef: string | null;
  vin: string | null;
  carInfo: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
  totalAmount: number;
  // Сколько реально поступило деньгами по этому заказу — сумма
  // cash_movements, привязанных к заказу (секция 29 schema.sql):
  // оплаты/предоплаты плюс, минусом, возвраты наличными/картой.
  // Используется для бейджа оплаты рядом со статусом отгрузки в
  // карточке заказа (components/OrderDetailsModal.tsx)
  paidAmount: number;
}

// ------------------------------------------------------------
// GET /api/orders/[id] — полная информация о заказе
// ------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT id, order_number, customer_name, customer_surname, customer_phone, city, nova_poshta_address, comment,
             ttn_number, ttn_ref, vin, car_info, status, created_at, updated_at
      FROM orders
      WHERE id = $1
      `,
      [id]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }

    const orderRow = orderResult.rows[0];

    // Позиции заказа — отдельным запросом, отсортированы по времени
    // добавления, чтобы порядок в списке не "прыгал" между обновлениями
    const itemsResult = await pool.query(
      `
      SELECT id, article, brand, name, price, quantity, supplier_id, supplier_name, status
      FROM order_items
      WHERE order_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    const items: OrderItemResponse[] = itemsResult.rows.map((row) => ({
      id: row.id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      // price — колонка NUMERIC, драйвер pg возвращает такие значения
      // строкой, явно переводим в число
      price: parseFloat(row.price),
      quantity: row.quantity,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      status: row.status,
    }));

    // Общая сумма считается здесь же, в коде, из уже полученных
    // позиций — заказ обычно содержит немного строк, отдельный
    // SQL-запрос с SUM() ради этого не нужен
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Оплаченная сумма — сумма движений кассы по этому заказу.
    // Работает независимо от того, привязан ли к заказу customer_id
    // (cash_movements.order_id заполняется всегда, см.
    // app/api/admin/orders/[id]/payment/route.ts), в отличие от
    // customer_transactions, куда запись пишется только при наличии
    // клиента
    const paidResult = await pool.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS paid
      FROM cash_movements
      WHERE order_id = $1 AND type IN ('customer_payment', 'customer_prepayment', 'customer_refund')
      `,
      [id]
    );
    const paidAmount = parseFloat(paidResult.rows[0].paid);

    const order: OrderDetailsResponse = {
      id: orderRow.id,
      orderNumber: orderRow.order_number,
      customerName: orderRow.customer_name,
      customerSurname: orderRow.customer_surname,
      customerPhone: orderRow.customer_phone,
      city: orderRow.city,
      novaPoshtaAddress: orderRow.nova_poshta_address,
      comment: orderRow.comment,
      ttnNumber: orderRow.ttn_number,
      ttnRef: orderRow.ttn_ref,
      vin: orderRow.vin,
      carInfo: orderRow.car_info,
      status: orderRow.status,
      createdAt: orderRow.created_at,
      updatedAt: orderRow.updated_at,
      items,
      totalAmount,
      paidAmount,
    };

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Ошибка при получении заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить заказ: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// ФИНАЛЬНАЯ ОТГРУЗКА ЗАКАЗА — шаг 3 закупочного цикла (секция 28
// schema.sql). Вынесена из общей PATCH-логики ниже в отдельную функцию
// со своей транзакцией, потому что, в отличие от простой смены статуса,
// здесь сразу несколько взаимосвязанных действий, которые обязаны
// пройти либо все вместе, либо не пройти вообще:
//
//   1. Проверка: у ВСЕХ ещё не отменённых/не возвращённых позиций
//      заказа order_items.status = 'in_stock' — иначе отгружать нечего
//      отгружать (деталь всё ещё едет от поставщика). Если хоть одна
//      не готова — отгрузка целиком отклоняется с понятной ошибкой.
//   2. orders.status = 'shipped' (shipped_at проставит сам триггер
//      trg_orders_set_shipped_at — вручную его здесь не трогаем).
//   3. order_items.status = 'shipped' для всех позиций заказа.
//   4. Списание склада: stock_movements (reason='sale', -quantity) и
//      products.stock -= quantity по каждой позиции.
//   5. customer_transactions (type='shipment', +сумма заказа) — триггер
//      сам увеличит personal баланс клиента (customers.balance). Только
//      если у заказа вообще есть customer_id — у части старых заказов
//      (оформленных до того, как появилась таблица customers) его нет,
//      и это ожидаемая ситуация, а не ошибка: начисление на баланс для
//      них просто пропускается.
// ------------------------------------------------------------
async function shipOrder(orderId: string): Promise<NextResponse> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `SELECT id, customer_id, customer_name, customer_phone, status, ttn_number, created_at, updated_at
       FROM orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }

    const order = orderResult.rows[0];
    if (order.status === 'shipped') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ уже отгружен.' }, { status: 400 });
    }
    if (order.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Отменённый заказ нельзя отгрузить.' }, { status: 400 });
    }

    // 'cancelled'/'returned' позиции в проверку и в саму отгрузку не
    // попадают — отменённая позиция физически не отгружается, а
    // возвращённая уже была отгружена и возвращена раньше (возврат
    // возможен только после отгрузки, так что на этом шаге её тут
    // в принципе быть не должно, но на всякий случай исключаем)
    const itemsResult = await client.query<{
      id: string;
      product_id: string | null;
      article: string;
      name: string | null;
      price: string;
      quantity: number;
      status: string;
    }>(
      `SELECT id, product_id, article, name, price, quantity, status
       FROM order_items WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned')`,
      [orderId]
    );

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'В заказе нет позиций для отгрузки.' }, { status: 400 });
    }

    const notReady = itemsResult.rows.filter((row) => row.status !== 'in_stock');
    if (notReady.length > 0) {
      await client.query('ROLLBACK');
      const names = notReady.map((row) => row.name || row.article).join(', ');
      return NextResponse.json(
        {
          error: `Нельзя отгрузить заказ — ещё не все позиции на складе: ${names}. Сначала оформите их закупку у поставщика (экран "Закупки") или отметьте как имеющиеся на складе.`,
        },
        { status: 400 }
      );
    }

    let totalAmount = 0;
    for (const item of itemsResult.rows) {
      totalAmount += parseFloat(item.price) * item.quantity;

      // Товар мог быть удалён из каталога уже после оформления заказа
      // (order_items — самостоятельный "снимок", см. секцию 7
      // schema.sql) — тогда списывать физический остаток некуда,
      // пропускаем только эту часть, саму позицию всё равно отгружаем
      if (item.product_id) {
        await client.query(
          `INSERT INTO stock_movements (product_id, quantity_change, reason, order_item_id) VALUES ($1, $2, 'sale', $3)`,
          [item.product_id, -item.quantity, item.id]
        );
        await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [
          item.product_id,
          item.quantity,
        ]);
      }

      await client.query(`UPDATE order_items SET status = 'shipped' WHERE id = $1`, [item.id]);
    }

    // shipped_at выставит триггер trg_orders_set_shipped_at сам —
    // здесь его руками не трогаем
    await client.query(`UPDATE orders SET status = 'shipped', updated_at = now() WHERE id = $1`, [orderId]);

    if (order.customer_id) {
      await client.query(
        `
        INSERT INTO customer_transactions (customer_id, amount, type, order_id, affects_customer_balance, comment, created_by)
        VALUES ($1, $2, 'shipment', $3, true, 'Отгрузка заказа', 'admin')
        `,
        [order.customer_id, totalAmount, orderId]
      );
    }

    await client.query('COMMIT');

    const updatedResult = await pool.query(
      'SELECT id, customer_name, customer_phone, status, ttn_number, created_at, updated_at FROM orders WHERE id = $1',
      [orderId]
    );
    const row = updatedResult.rows[0];

    return NextResponse.json({
      success: true,
      order: {
        id: row.id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        status: row.status,
        ttnNumber: row.ttn_number,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при отгрузке заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось отгрузить заказ: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------
// PATCH /api/orders/[id] — сменить статус и/или ТТН заказа
// ------------------------------------------------------------
// ttnNumber — необязательное поле (номер накладной Новой Почты),
// добавлено вместе с отслеживанием посылки в личном кабинете клиента
// (components/CustomerDashboard.tsx). Можно передать оба поля сразу
// или только одно из них — то, что не передано, просто не меняется
// vin/carInfo — необов'язкові поля про автомобіль клієнта, вводяться
// вручну в картці замовлення (секція 30.2 schema.sql) і потрапляють у
// шапку друкованих документів (lib/documents/partials.ts,
// renderClientInfoGrid). Окремого екрану для них нема — той самий
// PATCH, що вже оновлює статус і ТТН
interface PatchOrderRequestBody {
  status?: string;
  ttnNumber?: string | null;
  vin?: string | null;
  carInfo?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchOrderRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  if (
    body.status === undefined &&
    body.ttnNumber === undefined &&
    body.vin === undefined &&
    body.carInfo === undefined
  ) {
    return NextResponse.json(
      { error: 'Укажите статус, номер ТТН, VIN и/или автомобиль для обновления.' },
      { status: 400 }
    );
  }

  if (body.status !== undefined && !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: `Укажите статус — один из: ${STATUS_VALUES.join(', ')}.` },
      { status: 400 }
    );
  }

  const nextStatus = body.status;
  const nextTtnNumber = body.ttnNumber !== undefined ? (body.ttnNumber || '').trim() || null : undefined;
  const nextVin = body.vin !== undefined ? (body.vin || '').trim().toUpperCase() || null : undefined;
  const nextCarInfo = body.carInfo !== undefined ? (body.carInfo || '').trim() || null : undefined;

  // Переход в 'shipped' — не просто смена значения в колонке status:
  // это финальная отгрузка со списанием склада и начислением на баланс
  // клиента, со своими проверками (см. shipOrder выше). ttnNumber в
  // этом же запросе не обрабатываем — на практике UI всегда сохраняет
  // его отдельной кнопкой (см. components/OrdersScreen.tsx), сюда он
  // одновременно со сменой статуса не приходит
  if (nextStatus === 'shipped') {
    return await shipOrder(id);
  }

  try {
    // Старое значение ТТН — нужно ДО обновления, чтобы понять, реально
    // ли админ только что ВПЕРВЫЕ проставил номер (или изменил его), а
    // не просто повторно сохранил статус без изменения ТТН — иначе
    // клиенту улетало бы одно и то же Telegram-уведомление про ТТН при
    // каждом сохранении карточки заказа
    const previousResult = await pool.query('SELECT ttn_number FROM orders WHERE id = $1', [id]);
    const previousTtnNumber: string | null = previousResult.rows[0]?.ttn_number ?? null;

    // COALESCE($N, колонка) — обновляет колонку, только если для неё
    // реально передали значение в запросе; параметр undefined (поле не
    // передали вовсе) превращается в null через pg, а COALESCE в этом
    // случае оставляет прежнее значение колонки как есть
    const result = await pool.query(
      `
      UPDATE orders
      SET status = COALESCE($2, status),
          ttn_number = CASE WHEN $3 THEN $4 ELSE ttn_number END,
          vin = CASE WHEN $5 THEN $6 ELSE vin END,
          car_info = CASE WHEN $7 THEN $8 ELSE car_info END,
          updated_at = now()
      WHERE id = $1
      RETURNING id, customer_name, customer_phone, status, ttn_number, vin, car_info, created_at, updated_at
      `,
      [
        id,
        nextStatus ?? null,
        nextTtnNumber !== undefined,
        nextTtnNumber ?? null,
        nextVin !== undefined,
        nextVin ?? null,
        nextCarInfo !== undefined,
        nextCarInfo ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }

    const row = result.rows[0];

    // Персональне сповіщення покупцю про ТТН — лише коли номер реально
    // З'ЯВИВСЯ або ЗМІНИВСЯ (не при кожному збереженні картки заказу),
    // і лише якщо покупець раніше підключив Telegram-сповіщення
    // (customer_telegram_links, app/api/telegram/webhook/route.ts).
    // Обгорнуто в after() з next/server — без цього "void"-виклик без
    // await міг обірватись разом із заморожуванням serverless-функції
    // одразу після return нижче, і сповіщення випадково не долітало б
    // (той самий фікс, що і в app/api/orders/create/route.ts)
    if (row.ttn_number && row.ttn_number !== previousTtnNumber) {
      after(() => notifyCustomerTtnAssigned(row.id, row.customer_phone, row.ttn_number));
    }

    return NextResponse.json({
      success: true,
      order: {
        id: row.id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        status: row.status,
        ttnNumber: row.ttn_number,
        vin: row.vin,
        carInfo: row.car_info,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить заказ: ' + message },
      { status: 500 }
    );
  }
}
