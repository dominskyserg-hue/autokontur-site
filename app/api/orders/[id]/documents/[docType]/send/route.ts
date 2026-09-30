// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/documents/[docType]/send
//
// Кнопка "Надіслати клієнту в Telegram" в предпросмотре документа
// (components/PrintDocumentsPanel.tsx): отправляет клиенту уже
// сохранённый PDF (рахунок-фактура / видаткова накладна / акт
// повернення) через Telegram-бота магазина.
//
// Сам PDF сначала сохраняется обычной кнопкой (POST .../save — файл
// кладётся в Vercel Blob и ссылка записывается в order_documents).
// Здесь берём ИМЕННО эту ссылку из базы, а не из тела запроса — так
// через этот роут нельзя переслать клиенту произвольный файл.
//
//   Ответ: { success, result: 'sent' | 'not_linked' | 'failed' }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { normalizePhone } from '@/lib/phoneNormalize';
import { sendTelegramDocumentTo } from '@/lib/telegramNotify';
import { logOrderEvent } from '@/lib/orderHistory';

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

const DOC_TITLES: Record<string, string> = {
  invoice: 'Рахунок-фактура',
  delivery_note: 'Видаткова накладна',
  return_act: 'Акт повернення',
};

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string; docType: string }> }
) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id, docType } = await context.params;
  if (!UUID_PATTERN.test(id) || !DOC_TITLES[docType]) {
    return NextResponse.json({ error: 'Некорректный заказ или тип документа.' }, { status: 400 });
  }

  try {
    const docResult = await pool.query(
      `SELECT d.file_url, d.number, o.order_number, o.customer_phone
       FROM order_documents d
       JOIN orders o ON o.id = d.order_id
       WHERE d.order_id = $1 AND d.doc_type = $2`,
      [id, docType]
    );
    const doc = docResult.rows[0];
    if (!doc?.file_url) {
      return NextResponse.json(
        { error: 'Спочатку збережіть документ у замовлення (кнопка «Сохранить в заказ»).' },
        { status: 400 }
      );
    }

    const chatResult = await pool.query('SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1', [
      normalizePhone(doc.customer_phone || ''),
    ]);
    const chatId = chatResult.rows[0]?.telegram_chat_id;
    if (!chatId) {
      return NextResponse.json({ success: true, result: 'not_linked' });
    }

    const caption = `${DOC_TITLES[docType]} №${doc.number} до замовлення №${doc.order_number}`;
    const messageId = await sendTelegramDocumentTo(chatId, doc.file_url, caption);
    if (messageId === null) {
      return NextResponse.json({ success: true, result: 'failed' });
    }

    await logOrderEvent(id, `${DOC_TITLES[docType]} №${doc.number} надіслано клієнту в Telegram`);
    return NextResponse.json({ success: true, result: 'sent' });
  } catch (error) {
    console.error('Ошибка при отправке документа клиенту:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не вдалося надіслати документ: ' + message }, { status: 500 });
  }
}
