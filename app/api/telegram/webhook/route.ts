// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/telegram/webhook
//
// Сюди Telegram надсилає КОЖНЕ повідомлення, написане боту
// @dominatorparts_orders_bot (реєструється один раз через
// https://api.telegram.org/bot<ТОКЕН>/setWebhook — див. коментар у
// lib/telegramNotify.ts). Єдине, що нас тут цікавить — команда
// "/start <телефон>", якою бот дізнається, ЧИЙ це chat_id.
//
// Звідки береться "/start <телефон>": особистий кабінет покупця
// (components/CustomerDashboard.tsx) показує посилання-запрошення
// виду "https://t.me/dominatorparts_orders_bot?start=501234567" —
// коли покупець тисне на нього і потім "Start" у самому Telegram,
// клієнт Telegram сам надсилає боту повідомлення "/start 501234567".
// Це і є весь механізм: бот не може написати покупцю першим, тому
// покупець сам "знайомить" бота зі своїм акаунтом.
//
// БЕЗПЕКА: без перевірки нижче будь-хто, хто дізнається адресу цього
// роута (вона не секретна — звичайний URL сайту), міг би слати сюди
// підроблені запити виду "/start <чужий телефон>" зі СВОЇМ chat_id —
// і тоді сповіщення про замовлення чужої людини (склад, адреса,
// пізніше ТТН) почали б приходити ЙОМУ. Тому Telegram підписує кожен
// реальний запит заголовком X-Telegram-Bot-Api-Secret-Token (значення
// задається один раз при реєстрації вебхука) — звіряємо його з тим же
// детермінованим хешем, що рахує computeTelegramWebhookSecret()
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { computeTelegramWebhookSecret, sendTelegramMessageTo } from '@/lib/telegramNotify';

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

// Telegram-параметр "/start <тут>" — і сам deep-link (t.me/bot?start=...),
// і команда, яку клієнт Telegram надсилає у відповідь, обмежені набором
// символів [A-Za-z0-9_-], тому телефон передається як нормалізовані
// 9 цифр (lib/phoneNormalize.ts) — крапок/плюсів/пробілів там немає
function extractStartPayload(text: string): string | null {
  const match = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
  if (!match) return null;
  return match[1] || null;
}

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: { username?: string };
    text?: string;
  };
}

export async function POST(request: NextRequest) {
  const expectedSecret = computeTelegramWebhookSecret();
  const providedSecret = request.headers.get('x-telegram-bot-api-secret-token');

  // Якщо TELEGRAM_BOT_TOKEN взагалі не заданий на сервері — секрет
  // порахувати нема з чого, expectedSecret === null. У цьому випадку
  // вебхук теж не мав би бути зареєстрований у Telegram, тож такий
  // запит однаково підозрілий — відхиляємо
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid secret token' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text;

  // Не /start (звичайний текст, стікер тощо) — нам тут його обробляти
  // нема чим, Telegram все одно чекає 200 OK, інакше почне повторювати
  // доставку цього ж апдейту
  if (!message || !text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const payload = extractStartPayload(text);

  if (!payload) {
    // "/start" без телефону (або взагалі не команда старту) — швидше
    // за все, покупець написав боту напряму, а не через посилання з
    // кабінету. Пояснюємо, як підключити сповіщення правильно
    await sendTelegramMessageTo(
      chatId,
      'Щоб отримувати сповіщення про свої замовлення тут, перейдіть у свій Особистий кабінет на сайті → «Налаштування» → «Підключити Telegram-сповіщення».'
    );
    return NextResponse.json({ ok: true });
  }

  // payload — це нормалізовані 9 цифр телефону (див. extractStartPayload
  // вище й normalizePhone у lib/phoneNormalize.ts) — саме за ними
  // й порівнюються телефони скрізь у кабінеті покупця
  const phoneTail = payload.replace(/\D/g, '').slice(-9);
  if (phoneTail.length < 9) {
    await sendTelegramMessageTo(chatId, 'Не вдалося розпізнати номер телефону. Спробуйте перейти за посиланням із кабінету ще раз.');
    return NextResponse.json({ ok: true });
  }

  try {
    await pool.query(
      `
      INSERT INTO customer_telegram_links (phone, telegram_chat_id, telegram_username)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone)
      DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id, telegram_username = EXCLUDED.telegram_username
      `,
      [phoneTail, chatId, message.from?.username || null]
    );

    await sendTelegramMessageTo(
      chatId,
      'Готово! Тепер сюди приходитимуть сповіщення про ваші замовлення на DominatorParts — склад замовлення одразу після оформлення та номер ТТН Нової Пошти, коли ми відправимо посилку.'
    );
  } catch (error) {
    console.error('Ошибка при сохранении привязки Telegram-чата покупателя:', error);
  }

  return NextResponse.json({ ok: true });
}
