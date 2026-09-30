// ============================================================
// Персональное Telegram-уведомление покупателю о присвоенном номере
// ТТН — раньше жило только внутри PATCH /api/orders/[id] (когда
// админ вписывал номер вручную), теперь используется и там, и в
// app/api/orders/[id]/create-ttn/route.ts (когда ТТН создаётся через
// API Новой Пошти прямо из карточки заказа) — оба места должны
// уведомлять клиента одинаково, поэтому логика здесь, в одном месте
// ============================================================

import { Pool } from 'pg';
import { normalizePhone } from './phoneNormalize';
import { sendTelegramMessageTo } from './telegramNotify';

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

// Ссылка на отслеживание посылки на сайте Новой Почты — клиент сразу
// видит, где посылка, без ручного ввода номера
export function ttnTrackingUrl(ttnNumber: string): string {
  return `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(ttnNumber.replace(/\s+/g, ''))}`;
}

// Текст сообщения клиенту о ТТН — один и тот же для Telegram-бота и
// для ручной отправки (кнопки "Скопіювати" / "Viber" в окне заказа)
export function buildTtnMessage(orderNumber: number | string, ttnNumber: string): string {
  return [
    `Ваше замовлення №${orderNumber} відправлено Новою Поштою!`,
    `Номер ТТН: ${ttnNumber}`,
    `Відстежити: ${ttnTrackingUrl(ttnNumber)}`,
  ].join('\n');
}

// Подключил ли покупатель Telegram-уведомления (есть строка в
// customer_telegram_links) — показываем это менеджеру в окне заказа
export async function isCustomerTelegramLinked(customerPhone: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM customer_telegram_links WHERE phone = $1`, [
    normalizePhone(customerPhone),
  ]);
  return result.rows.length > 0;
}

// Результат отправки — чтобы кнопка "Надіслати ТТН" в окне заказа
// могла честно сказать менеджеру, ушло сообщение или нет
export type TtnNotifyResult = 'sent' | 'not_linked' | 'failed';

// Молча пропускает всё, если покупатель не подключал Telegram-
// уведомления (нет строки в customer_telegram_links) — это
// ДОПОЛНИТЕЛЬНОЕ уведомление, его отсутствие не должно ломать
// основной сценарий (сохранение ТТН)
export async function notifyCustomerTtnAssigned(
  orderId: string,
  customerPhone: string,
  ttnNumber: string
): Promise<TtnNotifyResult> {
  try {
    const chatResult = await pool.query(`SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1`, [
      normalizePhone(customerPhone),
    ]);
    const chatId = chatResult.rows[0]?.telegram_chat_id;
    if (!chatId) return 'not_linked';

    // Людський номер замовлення (order_number) — окремим запитом, а не
    // переданий викликачем: обидва місця, що викликають цю функцію
    // (app/api/orders/[id]/route.ts, app/api/orders/[id]/create-ttn/route.ts),
    // і так вже мають під рукою orderId, а міняти сигнатуру заради
    // одного зайвого параметра, який тут же й обчислюється, не варто
    const orderResult = await pool.query(`SELECT order_number FROM orders WHERE id = $1`, [orderId]);
    const orderNumber = orderResult.rows[0]?.order_number ?? orderId.slice(0, 8);

    // sendTelegramMessageTo возвращает id сообщения или null, если
    // Telegram его не принял (нет токена бота, клиент заблокировал бота)
    const messageId = await sendTelegramMessageTo(chatId, buildTtnMessage(orderNumber, ttnNumber));
    return messageId === null ? 'failed' : 'sent';
  } catch (error) {
    console.error('Ошибка при отправке Telegram-уведомления о ТТН:', error);
    return 'failed';
  }
}
