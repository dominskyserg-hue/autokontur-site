// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/orders/create
//
// Создание заказа МЕНЕДЖЕРОМ из админ-панели (components/NewOrderScreen.tsx,
// экран "Новый заказ") — в отличие от app/api/orders/create/route.ts
// (тем пользуется витрина, он публичный и НАМЕРЕННО игнорирует
// цену/себестоимость из тела запроса, чтобы анонимный покупатель не
// мог подделать их через консоль браузера), этот роут живёт под
// /api/admin/* и защищён паролем админки на уровне middleware.ts —
// значит вызвать его может только авторизованный менеджер, и ему
// МОЖНО доверять цену продажи и закупочную цену, которые он вручную
// вписал в форму (например, согласовал с клиентом скидку по телефону,
// или знает реальную закупочную цену этой конкретной поставки).
//
//   POST /api/admin/orders/create
//   Тело запроса (JSON):
//   {
//     "customerName": "Іван", "customerSurname": "Петренко",
//     "customerPhone": "+380501234567",
//     "city": "Київ", "novaPoshtaAddress": "...", "comment": "...",
//     "items": [
//       { "id": "3fa85f64-...", "count": 2, "price": 199.99, "costPrice": 150 }
//     ]
//   }
//
// price/costPrice — ОБЯЗАТЕЛЬНЫ для каждой позиции (пришли из формы,
// где менеджер видит и может поправить оба значения ещё до отправки).
// Если по какой-то причине их не передали, подстраховываемся —
// подставляем актуальные значения из каталога (retail_price с учётом
// персональной скидки/наценки клиента / cost_price), той же логикой,
// что и в публичном app/api/orders/create/route.ts.
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { sendTelegramMessage, sendTelegramMessageTo } from '@/lib/telegramNotify';
import { normalizePhone } from '@/lib/phoneNormalize';
import { computeCustomerPrice, type CustomerPricingRule } from '@/lib/customerPricing';

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

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

interface OrderCreateItemInput {
  id?: string;
  count?: number;
  // Цена продажи и закупочная цена ЗА ОДНУ ШТУКУ — менеджер задаёт их
  // вручную в форме "Новый заказ", здесь только валидируются
  price?: number;
  costPrice?: number;
}

interface OrderCreateRequestBody {
  customerName?: string;
  customerSurname?: string;
  customerPhone?: string;
  city?: string;
  novaPoshtaAddress?: string;
  comment?: string;
  items?: OrderCreateItemInput[];
}

interface ProductSnapshotRow {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  cost_price: string;
  retail_price: string;
  supplier_id: string;
  supplier_name: string;
}

export async function POST(request: NextRequest) {
  let body: OrderCreateRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный формат запроса.' }, { status: 400 });
  }

  const customerName = (body.customerName || '').trim();
  const customerSurname = (body.customerSurname || '').trim();
  const customerPhone = (body.customerPhone || '').trim();
  const city = (body.city || '').trim();
  const novaPoshtaAddress = (body.novaPoshtaAddress || '').trim();
  const comment = (body.comment || '').trim() || null;

  if (!customerName) {
    return NextResponse.json({ error: 'Укажите имя клиента.' }, { status: 400 });
  }
  if (!customerSurname) {
    return NextResponse.json({ error: 'Укажите фамилию клиента.' }, { status: 400 });
  }
  if (!customerPhone || !isValidPhone(customerPhone)) {
    return NextResponse.json({ error: 'Укажите корректный номер телефона.' }, { status: 400 });
  }
  if (!city) {
    return NextResponse.json({ error: 'Укажите город доставки.' }, { status: 400 });
  }
  if (!novaPoshtaAddress) {
    return NextResponse.json({ error: 'Укажите адрес отделения Новой Почты.' }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'Корзина пуста — нечего оформлять.' }, { status: 400 });
  }

  // Проверяем и приводим к числу каждую позицию ДО начала транзакции
  const items: { id: string; count: number; price: number | null; costPrice: number | null }[] = [];
  for (const rawItem of body.items) {
    const id = rawItem.id;
    const count = rawItem.count;

    if (!id || !isValidUuid(id)) {
      return NextResponse.json({ error: 'У каждого товара в корзине должен быть корректный id.' }, { status: 400 });
    }
    if (!Number.isInteger(count) || (count as number) <= 0) {
      return NextResponse.json(
        { error: `Некорректное количество для товара ${id}: количество должно быть целым числом больше нуля.` },
        { status: 400 }
      );
    }

    let price: number | null = null;
    if (rawItem.price !== undefined) {
      if (!Number.isFinite(rawItem.price) || (rawItem.price as number) < 0) {
        return NextResponse.json({ error: `Цена продажи для товара ${id} указана некорректно.` }, { status: 400 });
      }
      price = rawItem.price as number;
    }

    let costPrice: number | null = null;
    if (rawItem.costPrice !== undefined) {
      if (!Number.isFinite(rawItem.costPrice) || (rawItem.costPrice as number) < 0) {
        return NextResponse.json({ error: `Закупочная цена для товара ${id} указана некорректно.` }, { status: 400 });
      }
      costPrice = rawItem.costPrice as number;
    }

    items.push({ id, count: count as number, price, costPrice });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ids = items.map((item) => item.id);
    const productsResult = await client.query<ProductSnapshotRow>(
      `
      SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.supplier_id, s.name AS supplier_name
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ANY($1::uuid[])
      `,
      [ids]
    );
    const productById = new Map(productsResult.rows.map((row) => [row.id, row]));

    const missingId = ids.find((id) => !productById.has(id));
    if (missingId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `Товар с id ${missingId} не найден в каталоге.` }, { status: 400 });
    }

    // Клиент как персистентная сущность (для личного баланса, секция 28
    // schema.sql) — тот же апсерт по нормализованному телефону, что и
    // в публичном app/api/orders/create/route.ts
    const normalizedPhone = normalizePhone(customerPhone);
    const customerResult = await client.query<{ id: string }>(
      `
      INSERT INTO customers (phone, name, surname)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone) DO UPDATE SET
        name = EXCLUDED.name,
        surname = EXCLUDED.surname,
        updated_at = now()
      RETURNING id
      `,
      [normalizedPhone, customerName, customerSurname]
    );
    const customerId = customerResult.rows[0].id;

    const orderResult = await client.query<{ id: string; order_number: number }>(
      `
      INSERT INTO orders (customer_id, customer_name, customer_surname, customer_phone, city, nova_poshta_address, comment, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'new')
      RETURNING id, order_number
      `,
      [customerId, customerName, customerSurname, customerPhone, city, novaPoshtaAddress, comment]
    );
    const orderId = orderResult.rows[0].id;
    const orderNumber = orderResult.rows[0].order_number;

    // Персональное правило цены клиента — подстраховка ТОЛЬКО для тех
    // позиций, где менеджер не переопределил цену вручную (см. ниже)
    const pricingRuleResult = await client.query<{ rule_type: 'discount' | 'markup'; percent: string }>(
      'SELECT rule_type, percent FROM customer_pricing_rules WHERE phone = $1',
      [normalizedPhone]
    );
    const pricingRuleRow = pricingRuleResult.rows[0];
    const pricingRule: CustomerPricingRule | null = pricingRuleRow
      ? { ruleType: pricingRuleRow.rule_type, percent: parseFloat(pricingRuleRow.percent) }
      : null;

    let totalAmount = 0;
    const summaryLines: string[] = [];
    for (const item of items) {
      const product = productById.get(item.id)!;

      // Цена продажи и закупочная цена — то, что реально вписал
      // менеджер в форму (может отличаться от каталога: скидка по
      // телефону, торг, актуальная закупочная цена этой поставки).
      // Если почему-то не передали — подстраховываемся каталожными
      // значениями, той же формулой, что и на витрине
      const unitPrice = item.price ?? computeCustomerPrice(parseFloat(product.cost_price), parseFloat(product.retail_price), pricingRule);
      const unitCostPrice = item.costPrice ?? parseFloat(product.cost_price);

      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [orderId, product.id, product.article, product.brand, product.name, unitPrice, unitCostPrice, item.count, product.supplier_id, product.supplier_name]
      );

      const lineTotal = unitPrice * item.count;
      totalAmount += lineTotal;
      summaryLines.push(`• ${product.name || product.article} ×${item.count} — ${lineTotal.toFixed(0)} грн`);
    }

    await client.query('COMMIT');

    after(async () => {
      try {
        await sendTelegramMessage(
          [
            `🛒 Новый заказ (оформлен менеджером)`,
            `${customerName} ${customerSurname}, ${customerPhone}`,
            `${city}, ${novaPoshtaAddress}`,
            comment ? `Комментарий: ${comment}` : null,
            '',
            ...summaryLines,
            '',
            `Итого: ${totalAmount.toFixed(0)} грн`,
          ]
            .filter((line) => line !== null)
            .join('\n')
        );
      } catch (error) {
        console.error('Ошибка при отправке Telegram-уведомления владельцу о заказе:', error);
      }

      try {
        const chatResult = await pool.query('SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1', [
          normalizedPhone,
        ]);
        const chatId = chatResult.rows[0]?.telegram_chat_id;
        if (chatId) {
          await sendTelegramMessageTo(
            chatId,
            [
              `Дякуємо за замовлення, ${customerName}!`,
              `Номер замовлення: №${orderNumber}`,
              '',
              ...summaryLines,
              '',
              `Разом: ${totalAmount.toFixed(0)} грн`,
              '',
              `Доставка: ${city}, ${novaPoshtaAddress}`,
            ].join('\n')
          );
        }
      } catch (error) {
        console.error('Ошибка при отправке личного Telegram-уведомления покупателю:', error);
      }
    });

    return NextResponse.json({ success: true, orderId, orderNumber });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при создании заказа менеджером:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось оформить заказ: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
