// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders/[id]/items/[itemId]
// (например /api/orders/3fa85f64-.../items/9c6a1b2d-...)
//
// PATCH — ручное редактирование ОДНОЙ позиции внутри заказа:
// цена, по которой она продана (price), и/или поставщик, который
// её отгружает (supplierId). Нужно, например, если админ вручную
// поправляет цену клиенту или переназначает деталь другому
// поставщику после оформления заказа.
//
// Тело запроса — JSON, оба поля необязательны, но хотя бы одно
// должно быть передано:
//   { "price": 1250.5 }
//   { "supplierId": "3fa85f64-..." }
//   { "price": 1250.5, "supplierId": "3fa85f64-..." }
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
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PatchOrderItemRequestBody {
  price?: number;
  supplierId?: string;
}

// Next.js 15: params у Route Handler — это Promise, поэтому его
// нужно сначала дождаться через await
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
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
  const hasSupplier = body.supplierId !== undefined;

  if (!hasPrice && !hasSupplier) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле для изменения: price или supplierId.' },
      { status: 400 }
    );
  }

  if (hasPrice && (!Number.isFinite(body.price) || (body.price as number) < 0)) {
    return NextResponse.json(
      { error: 'Цена должна быть числом не меньше нуля.' },
      { status: 400 }
    );
  }

  if (hasSupplier && !isValidUuid(body.supplierId as string)) {
    return NextResponse.json(
      { error: 'supplierId должен быть корректным UUID.' },
      { status: 400 }
    );
  }

  try {
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
    const result = await pool.query(
      `
      UPDATE order_items
      SET
        price = COALESCE($3, price),
        supplier_id = COALESCE($4, supplier_id),
        supplier_name = COALESCE($5, supplier_name)
      WHERE id = $1 AND order_id = $2
      RETURNING id, article, brand, name, price, quantity, supplier_id, supplier_name
      `,
      [
        itemId,
        orderId,
        hasPrice ? body.price : null,
        hasSupplier ? body.supplierId : null,
        hasSupplier ? supplierName : null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Позиция с таким id не найдена в этом заказе.' },
        { status: 404 }
      );
    }

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      item: {
        id: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        // price — колонка NUMERIC, драйвер pg возвращает такие
        // значения строкой, явно переводим в число
        price: parseFloat(row.price),
        quantity: row.quantity,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
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
