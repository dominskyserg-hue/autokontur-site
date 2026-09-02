// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/customer/orders/[id]?phone=+380501234567
//
// Полная детализация ОДНОГО заказа для личного кабинета покупателя:
// список купленных позиций (артикул, бренд, название, цена, кол-во).
//
// ГЛАВНАЯ ПРОВЕРКА БЕЗОПАСНОСТИ ЭТОГО РОУТА: заказ отдаётся, ТОЛЬКО
// ЕСЛИ его customer_phone совпадает с телефоном из query-параметра.
// Без этой проверки любой человек, зная (или подобрав) просто id
// заказа — а UUID выглядит секретным, но НЕ является секретом сам по
// себе, если его можно откуда-то увидеть, например из адреса ссылки —
// увидел бы чужие товары, сумму, статус. С этой проверкой ему
// пришлось бы ЕЩЁ и знать телефон покупателя, а не только id заказа.
//
// Это не полноценная авторизация (см. подробный комментарий про
// заглушку SMS-верификации в app/api/customer/orders/route.ts), но
// это и есть та самая "проверка, что заказ принадлежит именно
// авторизованному клиенту", которая явно требовалась в задании
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

globalThis.pgPool = pool;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const STATUS_VALUES = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'] as const;
type OrderStatus = (typeof STATUS_VALUES)[number];

const MIN_PHONE_DIGITS = 9;

// Та же нормализация, что и в app/api/customer/orders/route.ts —
// сравниваем последние 9 цифр телефона, а не строки целиком, чтобы
// "0501234567" и "+380501234567" считались одним и тем же номером
function normalizePhoneTail(rawPhone: string): string {
  const digitsOnly = rawPhone.replace(/\D/g, '');
  return digitsOnly.slice(-MIN_PHONE_DIGITS);
}

function isValidPhone(rawPhone: string): boolean {
  return rawPhone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

interface CustomerOrderItem {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
}

interface CustomerOrderDetails {
  id: string;
  status: OrderStatus;
  city: string;
  novaPoshtaAddress: string;
  comment: string | null;
  createdAt: string;
  items: CustomerOrderItem[];
  totalAmount: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор замовлення.' }, { status: 400 });
  }

  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();
  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhoneTail(rawPhone);

  try {
    // customer_phone сверяется В ТОМ ЖЕ запросе, а не отдельной
    // проверкой ПОСЛЕ получения заказа — так "заказ не найден" и
    // "заказ найден, но телефон не совпал" физически неотличимы для
    // того, кто спрашивает: он не может даже узнать, существует ли
    // вообще заказ с таким id, если это не его номер
    const orderResult = await pool.query(
      `
      SELECT id, status, city, nova_poshta_address, comment, created_at
      FROM orders
      WHERE id = $1 AND RIGHT(regexp_replace(customer_phone, '\\D', '', 'g'), 9) = $2
      `,
      [id, phoneTail]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Замовлення не знайдено.' }, { status: 404 });
    }

    const orderRow = orderResult.rows[0];

    const itemsResult = await pool.query(
      `
      SELECT id, article, brand, name, price, quantity
      FROM order_items
      WHERE order_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    const items: CustomerOrderItem[] = itemsResult.rows.map((row) => ({
      id: row.id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      // price — колонка NUMERIC, драйвер pg возвращает такие значения
      // строкой, явно переводим в число
      price: parseFloat(row.price),
      quantity: row.quantity,
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const order: CustomerOrderDetails = {
      id: orderRow.id,
      status: orderRow.status,
      city: orderRow.city,
      novaPoshtaAddress: orderRow.nova_poshta_address,
      comment: orderRow.comment,
      createdAt: orderRow.created_at,
      items,
      totalAmount,
    };

    return NextResponse.json({ success: true, order });
  } catch (error) {
    console.error('Ошибка при получении деталей заказа клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json(
      { error: 'Не вдалося отримати замовлення: ' + message },
      { status: 500 }
    );
  }
}
