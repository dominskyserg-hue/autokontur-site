// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders/[id]/items/[itemId]
// (например /api/orders/3fa85f64-.../items/9c6a1b2d-...)
//
// DELETE — удалить позицию из заказа (клиент передумал, добавили по
// ошибке). Нельзя удалить уже отгруженную или возвращённую позицию —
// по ним уже прошли деньги и склад, для них есть оформление возврата.
//
// PATCH — ручное редактирование ОДНОЙ позиции внутри заказа: цена
// продажи (price), закупочная цена/себестоимость (costPrice — по ней
// считается валовая прибыль в отчётах), поставщик (supplierId),
// название позиции (name) и/или количество (quantity) — например,
// клиент решил докупить ещё одну единицу того же товара уже после
// оформления заказа. Название правится, например, когда прайс-лист
// поставщика был на русском и в заказ попало русское название детали —
// вместо того, чтобы менять его в каталоге товаров (это затронуло бы
// вообще все заказы с этим товаром), здесь правится только "снимок"
// в этом конкретном заказе.
//
// Тело запроса — JSON, все поля необязательны, но хотя бы одно
// должно быть передано:
//   { "price": 1250.5 }
//   { "costPrice": 900 }
//   { "supplierId": "3fa85f64-..." }
//   { "name": "Фільтр масляний" }
//   { "quantity": 3 }
//   { "productId": "...", "price": 1250 }  — ЗАМЕНИТЬ деталь на аналог
//     (другой артикул из каталога, кнопка "Замінити" в окне заказа):
//     артикул, бренд, название, поставщик и закупочная цена берутся от
//     нового товара, цена продажи — из тела запроса (или прежняя).
//     Только для позиций "Ожидает закупки": уже заказанную у поставщика
//     или лежащую на складе деталь так не заменить
//   { "price": 1250.5, "costPrice": 900, "supplierId": "3fa85f64-...", "name": "...", "quantity": 2 }
//
// ВАЖНО: order_items хранит "снимок" товара на момент покупки (см.
// комментарий в schema.sql) — supplier_name это ТЕКСТ, скопированный
// из suppliers.name на момент заказа, а не связь по внешнему ключу
// в реальном времени. Поэтому при смене supplierId мы здесь ЖЕ
// обновляем и supplier_name — иначе в заказе осталось бы старое имя
// поставщика при новом supplier_id, и они разъехались бы друг с другом
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { autoAdvanceOrderStatus } from '@/lib/orderStatusPipeline';
import { logOrderEvent, historyMoney, historyValue } from '@/lib/orderHistory';

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
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PatchOrderItemRequestBody {
  price?: number;
  costPrice?: number;
  supplierId?: string;
  name?: string;
  quantity?: number;
  // Заменить деталь позиции на другой товар каталога (аналог)
  productId?: string;
}

// Next.js 15: params у Route Handler — это Promise, поэтому его
// нужно сначала дождаться через await
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: orderId, itemId } = await params;

  if (!isValidUuid(orderId) || !isValidUuid(itemId)) {
    return NextResponse.json(
      { error: 'id заказа и id позиции должны быть корректными UUID.' },
      { status: 400 }
    );
  }

  let body: PatchOrderItemRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const hasPrice = body.price !== undefined;
  const hasCostPrice = body.costPrice !== undefined;
  const hasSupplier = body.supplierId !== undefined;
  const hasName = body.name !== undefined;
  const hasQuantity = body.quantity !== undefined;
  const hasProduct = body.productId !== undefined;

  if (!hasPrice && !hasCostPrice && !hasSupplier && !hasName && !hasQuantity && !hasProduct) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле для изменения: price, costPrice, supplierId, name или quantity.' },
      { status: 400 }
    );
  }

  if (hasName && !(body.name as string).trim()) {
    return NextResponse.json({ error: 'Название позиции не может быть пустым.' }, { status: 400 });
  }

  if (hasPrice && (!Number.isFinite(body.price) || (body.price as number) < 0)) {
    return NextResponse.json(
      { error: 'Цена должна быть числом не меньше нуля.' },
      { status: 400 }
    );
  }

  if (hasCostPrice && (!Number.isFinite(body.costPrice) || (body.costPrice as number) < 0)) {
    return NextResponse.json(
      { error: 'Закупочная цена должна быть числом не меньше нуля.' },
      { status: 400 }
    );
  }

  if (hasQuantity && (!Number.isInteger(body.quantity) || (body.quantity as number) <= 0)) {
    return NextResponse.json(
      { error: 'Кількість має бути цілим числом більше нуля.' },
      { status: 400 }
    );
  }

  if (hasSupplier && !isValidUuid(body.supplierId as string)) {
    return NextResponse.json(
      { error: 'supplierId должен быть корректным UUID.' },
      { status: 400 }
    );
  }

  if (hasProduct && !isValidUuid(body.productId as string)) {
    return NextResponse.json({ error: 'productId должен быть корректным UUID.' }, { status: 400 });
  }

  // ---- замена детали на аналог (другой товар каталога) ----
  if (hasProduct) {
    try {
      const currentResult = await pool.query(
        'SELECT article, brand, status FROM order_items WHERE id = $1 AND order_id = $2',
        [itemId, orderId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        return NextResponse.json({ error: 'Позиция с таким id не найдена в этом заказе.' }, { status: 404 });
      }
      if (current.status !== 'pending') {
        return NextResponse.json(
          { error: 'Замінити на аналог можна лише позицію, яку ще не замовляли у постачальника.' },
          { status: 400 }
        );
      }

      const productResult = await pool.query(
        `SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.supplier_id, s.name AS supplier_name
         FROM products p JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.id = $1`,
        [body.productId]
      );
      const product = productResult.rows[0];
      if (!product) {
        return NextResponse.json({ error: 'Товар-аналог не знайдено в каталозі.' }, { status: 404 });
      }

      const replaced = await pool.query(
        `
        WITH updated AS (
          UPDATE order_items
          SET product_id = $3, article = $4, brand = $5, name = $6, cost_price = $7,
              supplier_id = $8, supplier_name = $9, price = COALESCE($10, price)
          WHERE id = $1 AND order_id = $2
          RETURNING id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name, status
        )
        SELECT updated.*, s.contact_name AS supplier_contact_name
        FROM updated LEFT JOIN suppliers s ON s.id = updated.supplier_id
        `,
        [
          itemId,
          orderId,
          product.id,
          product.article,
          product.brand,
          product.name,
          product.cost_price,
          product.supplier_id,
          product.supplier_name,
          hasPrice ? body.price : null,
        ]
      );
      const row = replaced.rows[0];

      await logOrderEvent(
        orderId,
        `Позицію ${historyValue(current.brand)} ${current.article} замінено на аналог ${historyValue(row.brand)} ${row.article} ` +
          `(${row.supplier_name}, закупка ${historyMoney(row.cost_price)}, продаж ${historyMoney(row.price)})`
      );

      return NextResponse.json({
        success: true,
        item: {
          id: row.id,
          article: row.article,
          brand: row.brand,
          name: row.name,
          price: parseFloat(row.price),
          costPrice: parseFloat(row.cost_price),
          quantity: row.quantity,
          supplierId: row.supplier_id,
          supplierName: row.supplier_name,
          supplierContactName: row.supplier_contact_name,
          status: row.status,
        },
      });
    } catch (error) {
      console.error('Ошибка при замене позиции на аналог:', error);
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      return NextResponse.json({ error: 'Не вдалося замінити позицію: ' + message }, { status: 500 });
    }
  }

  try {
    // Прежние значения позиции — для истории изменений заказа
    // (lib/orderHistory.ts): запишем только то, что реально поменялось
    const previousResult = await pool.query(
      'SELECT article, price, cost_price, supplier_name, name, quantity FROM order_items WHERE id = $1 AND order_id = $2',
      [itemId, orderId]
    );
    const previous = previousResult.rows[0];

    // Если меняем поставщика — сначала узнаём его актуальное название:
    // supplier_name в order_items это отдельный текстовый "снимок",
    // а не то же самое, что и suppliers.name сейчас, поэтому его нужно
    // обновить явно, а не понадеяться на связь по supplier_id
    let supplierName: string | null = null;
    if (hasSupplier) {
      const supplierResult = await pool.query('SELECT name FROM suppliers WHERE id = $1', [
        body.supplierId,
      ]);
      if (supplierResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Поставщик с таким id не найден.' },
          { status: 404 }
        );
      }
      supplierName = supplierResult.rows[0].name;
    }

    // WHERE id = $1 AND order_id = $2 — проверяем не только id самой
    // позиции, но и что она принадлежит именно ЭТОМУ заказу из адреса,
    // а не какому-то другому (иначе через подмену itemId в адресе
    // можно было бы случайно отредактировать чужую позицию)
    // CTE, що змінює дані (UPDATE ... RETURNING), одразу приєднана до
    // suppliers — щоб повернути АКТУАЛЬНЕ contact_name одним запитом,
    // а не окремим додатковим SELECT після UPDATE
    const result = await pool.query(
      `
      WITH updated AS (
        UPDATE order_items
        SET
          price = COALESCE($3, price),
          cost_price = COALESCE($8, cost_price),
          supplier_id = COALESCE($4, supplier_id),
          supplier_name = COALESCE($5, supplier_name),
          name = COALESCE($6, name),
          quantity = COALESCE($7, quantity)
        WHERE id = $1 AND order_id = $2
        RETURNING id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name, status
      )
      SELECT updated.*, s.contact_name AS supplier_contact_name
      FROM updated
      LEFT JOIN suppliers s ON s.id = updated.supplier_id
      `,
      [
        itemId,
        orderId,
        hasPrice ? body.price : null,
        hasSupplier ? body.supplierId : null,
        hasSupplier ? supplierName : null,
        hasName ? (body.name as string).trim() : null,
        hasQuantity ? body.quantity : null,
        hasCostPrice ? body.costPrice : null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Позиция с таким id не найдена в этом заказе.' },
        { status: 404 }
      );
    }

    const row = result.rows[0];

    // ---- история: "Позиція 0986452041: ціна 280 грн → 300 грн; ..." ----
    if (previous) {
      const changes: string[] = [];
      if (parseFloat(previous.price) !== parseFloat(row.price)) {
        changes.push(`ціна ${historyMoney(previous.price)} → ${historyMoney(row.price)}`);
      }
      if (parseFloat(previous.cost_price) !== parseFloat(row.cost_price)) {
        changes.push(`закупка ${historyMoney(previous.cost_price)} → ${historyMoney(row.cost_price)}`);
      }
      if (previous.supplier_name !== row.supplier_name) {
        changes.push(`постачальник ${historyValue(previous.supplier_name)} → ${historyValue(row.supplier_name)}`);
      }
      if (previous.quantity !== row.quantity) {
        changes.push(`кількість ${previous.quantity} → ${row.quantity}`);
      }
      if (previous.name !== row.name) {
        changes.push(`назва «${historyValue(previous.name)}» → «${historyValue(row.name)}»`);
      }
      if (changes.length > 0) {
        await logOrderEvent(orderId, `Позиція ${row.article}: ${changes.join('; ')}`);
      }
    }

    return NextResponse.json({
      success: true,
      item: {
        id: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        // price/cost_price — колонки NUMERIC, драйвер pg возвращает
        // такие значения строкой, явно переводим в число
        price: parseFloat(row.price),
        costPrice: parseFloat(row.cost_price),
        quantity: row.quantity,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        supplierContactName: row.supplier_contact_name,
        status: row.status,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении позиции заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить позицию заказа: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// DELETE — удалить позицию из заказа
// ------------------------------------------------------------
// Какие позиции можно удалять: ещё не отгруженные и не возвращённые.
//   pending               — ещё ничего не заказывали: просто убираем;
//   ordered_from_supplier — уже заказали у поставщика: сам заказ
//                            поставщику отменять нужно вручную (звонком),
//                            об этом предупреждает окно подтверждения;
//   in_stock              — деталь уже на нашем складе: она там и
//                            остаётся (приход в stock_movements не
//                            трогаем, ссылка на позицию обнулится сама —
//                            ON DELETE SET NULL в schema.sql);
//   cancelled             — отменённая строка, удаляем без вопросов.
const DELETABLE_STATUSES = ['pending', 'ordered_from_supplier', 'in_stock', 'cancelled'];

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: orderId, itemId } = await params;

  if (!isValidUuid(orderId) || !isValidUuid(itemId)) {
    return NextResponse.json({ error: 'id заказа и id позиции должны быть корректными UUID.' }, { status: 400 });
  }

  try {
    const itemResult = await pool.query(
      `SELECT oi.article, oi.name, oi.price, oi.quantity, oi.status, o.status AS order_status
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.id = $1 AND oi.order_id = $2`,
      [itemId, orderId]
    );
    if (itemResult.rows.length === 0) {
      return NextResponse.json({ error: 'Позиция с таким id не найдена в этом заказе.' }, { status: 404 });
    }
    const item = itemResult.rows[0];

    if (item.order_status === 'shipped') {
      return NextResponse.json(
        { error: 'Заказ уже отгружен — удалить позицию нельзя. Оформите возврат (кнопка ↩).' },
        { status: 400 }
      );
    }
    if (!DELETABLE_STATUSES.includes(item.status)) {
      return NextResponse.json(
        { error: 'Позиция уже отгружена или возвращена — удалить её нельзя. Оформите возврат (кнопка ↩).' },
        { status: 400 }
      );
    }

    // Возвраты ссылаются на позицию с запретом удаления (ON DELETE
    // RESTRICT) — если по ней уже был возврат, база не даст её удалить,
    // и это правильно: иначе потерялась бы история денег
    // Удаление и пересчёт статуса заказа — одной транзакцией: если,
    // например, удалили последнюю позицию, которая ещё ехала от
    // поставщика, а остальные уже на складе, заказ сам перейдёт дальше
    // по цепочке (lib/orderStatusPipeline.ts) — как после приёмки товара
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM order_items WHERE id = $1 AND order_id = $2', [itemId, orderId]);
      await autoAdvanceOrderStatus(client, orderId);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await logOrderEvent(
      orderId,
      `Видалено позицію ${item.article}${item.name ? ` «${item.name}»` : ''}: ${item.quantity} шт × ${historyMoney(item.price)}`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении позиции заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось удалить позицию: ' + message }, { status: 500 });
  }
}
