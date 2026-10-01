// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/order-status
//
// Публичная проверка статуса заказа для страницы "Де моє замовлення?"
// (app/zamovlennia/page.tsx). Личный кабинет сейчас выключен, а клиенты
// часто звонят с вопросом "где мой заказ" — здесь они видят это сами.
//
//   Тело запроса: { orderNumber: 142, phone: "+380501234567" }
//
// Заказ показываем ТОЛЬКО если совпали ОБА: номер заказа и телефон
// (последние 9 цифр, как и везде в проекте). По одному номеру чужой
// заказ не открыть, а перебор номеров ограничен rate limit
// (lib/rateLimit.ts) — не больше MAX_REQUESTS запросов с одного IP за
// LIMIT_WINDOW_SECONDS. Закупочные цены, поставщики и заметки менеджера
// сюда НЕ попадают — только то, что клиент и так видит в заказе.
//
// Если у заказа есть ТТН — заодно спрашиваем у Новой Почты, где посылка
// (lib/novaPoshta/tracking.ts). Ошибка Новой Почты не ломает ответ:
// тогда просто показываем номер ТТН без статуса.
//
//   Ответ: { success, order: { orderNumber, status, statusLabel,
//            createdAt, city, novaPoshtaAddress, items, totalAmount,
//            ttnNumber, tracking } }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/adminAuth';
import { getTtnStatus } from '@/lib/novaPoshta/tracking';

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

// Не больше 10 проверок за 10 минут с одного IP — нормальному клиенту
// хватает с запасом, а перебирать номера заказов становится бессмысленно
const MAX_REQUESTS = 10;
const LIMIT_WINDOW_SECONDS = 10 * 60;

// Телефон сравниваем по последним 9 цифрам (как в кабинете покупателя)
const PHONE_DIGITS = 9;

// Статусы заказа — понятным покупателю языком (украинский, как витрина)
const STATUS_LABELS: Record<string, string> = {
  new: 'Нове — скоро зателефонуємо для підтвердження',
  processing: 'В обробці',
  ordered_from_supplier: 'Замовлено у постачальника',
  in_stock: 'Деталі на нашому складі — готуємо до відправки',
  ready_for_pickup: 'Готове до видачі',
  shipped: 'Відправлено',
  cancelled: 'Скасовано',
};

interface RequestBody {
  orderNumber?: number | string;
  phone?: string;
}

export async function POST(request: NextRequest) {
  if (!(await rateLimit(`order-status:${await getClientIp()}`, MAX_REQUESTS, LIMIT_WINDOW_SECONDS))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний запит.' }, { status: 400 });
  }

  // Номер заказа: "№142", "142" или 142 — оставляем только цифры
  const orderNumber = parseInt(String(body.orderNumber ?? '').replace(/\D/g, ''), 10);
  const phoneTail = String(body.phone ?? '').replace(/\D/g, '').slice(-PHONE_DIGITS);

  if (!Number.isInteger(orderNumber) || orderNumber <= 0) {
    return NextResponse.json({ error: 'Вкажіть номер замовлення.' }, { status: 400 });
  }
  if (phoneTail.length < PHONE_DIGITS) {
    return NextResponse.json({ error: 'Вкажіть номер телефону, який ви залишали при замовленні.' }, { status: 400 });
  }

  try {
    const orderResult = await pool.query(
      `
      SELECT id, order_number, status, city, nova_poshta_address, ttn_number, customer_phone, created_at
      FROM orders
      WHERE order_number = $1 AND RIGHT(regexp_replace(customer_phone, '\\D', '', 'g'), 9) = $2
      `,
      [orderNumber, phoneTail]
    );

    // Одинаковый ответ и для "нет такого номера", и для "чужой телефон" —
    // чтобы нельзя было узнать, существует ли заказ с таким номером
    if (orderResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Замовлення не знайдено. Перевірте номер замовлення і телефон.' },
        { status: 404 }
      );
    }
    const row = orderResult.rows[0];

    // Позиции — без отменённых и возвращённых (их клиент уже не получит)
    const itemsResult = await pool.query(
      `
      SELECT article, brand, name, price, quantity
      FROM order_items
      WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned')
      ORDER BY created_at ASC
      `,
      [row.id]
    );
    const items = itemsResult.rows.map((item) => ({
      article: item.article,
      brand: item.brand,
      name: item.name,
      // NUMERIC из pg приходит строкой — переводим в число
      price: parseFloat(item.price),
      quantity: item.quantity,
    }));
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Где посылка — только если ТТН уже есть
    let tracking: { statusText: string; kind: string; warehouse: string | null; scheduledDelivery: string | null } | null =
      null;
    if (row.ttn_number) {
      try {
        const status = await getTtnStatus(row.ttn_number, row.customer_phone);
        tracking = {
          statusText: status.statusText,
          kind: status.kind,
          warehouse: status.warehouse,
          scheduledDelivery: status.scheduledDelivery,
        };
      } catch (error) {
        console.error('Не удалось получить статус ТТН для страницы статуса заказа:', error);
      }
    }

    return NextResponse.json({
      success: true,
      order: {
        orderNumber: row.order_number,
        status: row.status,
        statusLabel: STATUS_LABELS[row.status] ?? row.status,
        createdAt: row.created_at,
        city: row.city,
        novaPoshtaAddress: row.nova_poshta_address,
        items,
        totalAmount,
        ttnNumber: row.ttn_number,
        tracking,
      },
    });
  } catch (error) {
    console.error('Ошибка при проверке статуса заказа:', error);
    return NextResponse.json({ error: 'Сталася помилка, спробуйте пізніше.' }, { status: 500 });
  }
}
