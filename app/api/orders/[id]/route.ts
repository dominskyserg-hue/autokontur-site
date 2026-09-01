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

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// СТАТУСЫ ЗАКАЗА — тот же набор, что и в app/api/orders/route.ts
// и в CHECK-ограничении orders.status из schema.sql
// ------------------------------------------------------------
const STATUS_VALUES = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'] as const;
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
interface OrderItemResponse {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
  supplierId: string | null;
  supplierName: string | null;
}

interface OrderDetailsResponse {
  id: string;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  comment: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItemResponse[];
  totalAmount: number;
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
      SELECT id, customer_name, customer_surname, customer_phone, city, nova_poshta_address, comment,
             status, created_at, updated_at
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
      SELECT id, article, brand, name, price, quantity, supplier_id, supplier_name
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
    }));

    // Общая сумма считается здесь же, в коде, из уже полученных
    // позиций — заказ обычно содержит немного строк, отдельный
    // SQL-запрос с SUM() ради этого не нужен
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order: OrderDetailsResponse = {
      id: orderRow.id,
      customerName: orderRow.customer_name,
      customerSurname: orderRow.customer_surname,
      customerPhone: orderRow.customer_phone,
      city: orderRow.city,
      novaPoshtaAddress: orderRow.nova_poshta_address,
      comment: orderRow.comment,
      status: orderRow.status,
      createdAt: orderRow.created_at,
      updatedAt: orderRow.updated_at,
      items,
      totalAmount,
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
// PATCH /api/orders/[id] — сменить статус заказа
// ------------------------------------------------------------
interface PatchOrderRequestBody {
  status?: string;
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

  if (!body.status || !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: `Укажите статус — один из: ${STATUS_VALUES.join(', ')}.` },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `
      UPDATE orders
      SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, customer_name, customer_phone, status, created_at, updated_at
      `,
      [id, body.status]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      order: {
        id: row.id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении статуса заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить статус заказа: ' + message },
      { status: 500 }
    );
  }
}
