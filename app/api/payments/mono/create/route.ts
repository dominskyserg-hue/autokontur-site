// ============================================================
// POST /api/payments/mono/create — создать счёт на оплату картой (mono)
// для уже оформленного заказа и вернуть ссылку на страницу оплаты.
//
//   Тело запроса: { orderId, phone }
//
// Заказ находится ТОЛЬКО если совпали id заказа И телефон (последние 9
// цифр) — как на странице "Де моє замовлення?". Сумму сервер считает сам
// по позициям заказа (покупатель её не присылает, подменить нельзя).
// Если по заказу уже есть неоплаченный счёт — отдаём его ссылку, а не
// создаём второй. Уже оплаченный заказ повторно оплатить нельзя.
// Лимит: 10 запросов за 10 минут с одного IP.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getClientIp } from '@/lib/adminAuth';
import { rateLimit, RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { SITE_URL } from '@/lib/siteConfig';
import { createInvoice, ensureMonoTables, isMonoPayEnabled } from '@/lib/monoPay';

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

export async function POST(request: NextRequest) {
  if (!isMonoPayEnabled()) {
    return NextResponse.json({ error: 'Оплата карткою тимчасово недоступна.' }, { status: 503 });
  }
  if (!(await rateLimit(`mono-create:${await getClientIp()}`, 10, 10 * 60))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: { orderId?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний запит.' }, { status: 400 });
  }
  const orderId = String(body.orderId ?? '');
  const phoneTail = String(body.phone ?? '').replace(/\D/g, '').slice(-9);
  if (!UUID_PATTERN.test(orderId) || phoneTail.length < 9) {
    return NextResponse.json({ error: 'Некоректні дані замовлення.' }, { status: 400 });
  }

  try {
    await ensureMonoTables();

    const orderResult = await pool.query(
      `SELECT id, order_number, status FROM orders
       WHERE id = $1 AND RIGHT(regexp_replace(customer_phone, '\\D', '', 'g'), 9) = $2`,
      [orderId, phoneTail]
    );
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Замовлення не знайдено.' }, { status: 404 });
    }
    const order = orderResult.rows[0];
    if (order.status === 'cancelled') {
      return NextResponse.json({ error: 'Замовлення скасовано.' }, { status: 400 });
    }

    // Уже есть счёт по этому заказу?
    const existing = await pool.query(
      `SELECT invoice_id, status, page_url, paid_at, created_at FROM mono_invoices
       WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId]
    );
    if (existing.rows.length > 0) {
      const last = existing.rows[0];
      if (last.paid_at) {
        return NextResponse.json({ error: 'Це замовлення вже оплачено.' }, { status: 400 });
      }
      // Неоплаченный свежий счёт (< 23 ч, mono держит его сутки) — повторно используем
      const ageMs = Date.now() - new Date(last.created_at).getTime();
      if ((last.status === 'created' || last.status === 'processing') && last.page_url && ageMs < 23 * 60 * 60 * 1000) {
        return NextResponse.json({ success: true, pageUrl: last.page_url });
      }
    }

    // Сумма и состав — только по живым позициям заказа
    const itemsResult = await pool.query(
      `SELECT article, name, brand, price, quantity FROM order_items
       WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned') ORDER BY created_at ASC`,
      [orderId]
    );
    const items = itemsResult.rows.map((row) => ({
      article: row.article as string,
      name: ((row.name as string | null) || (row.article as string)),
      quantity: row.quantity as number,
      priceUah: parseFloat(row.price),
    }));
    const amountUah = items.reduce((sum, item) => sum + item.priceUah * item.quantity, 0);
    if (items.length === 0 || amountUah <= 0) {
      return NextResponse.json({ error: 'У замовленні немає позицій для оплати.' }, { status: 400 });
    }

    const invoice = await createInvoice({
      orderId,
      orderNumber: order.order_number,
      amountUah,
      redirectUrl: `${SITE_URL}/zamovlennia?n=${order.order_number}&paid=1`,
      webHookUrl: `${SITE_URL}/api/payments/mono/webhook`,
      items,
    });
    return NextResponse.json({ success: true, pageUrl: invoice.pageUrl });
  } catch (error) {
    // Подробности (ответ mono) — только в логи, покупателю — общий текст
    console.error('Не удалось создать счёт на оплату mono:', error);
    return NextResponse.json({ error: 'Не вдалося перейти до оплати. Спробуйте ще раз або оберіть оплату при отриманні.' }, { status: 502 });
  }
}
