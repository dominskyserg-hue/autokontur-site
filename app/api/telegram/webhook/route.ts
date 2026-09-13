// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/telegram/webhook
//
// Сюди Telegram надсилає КОЖНЕ повідомлення, написане боту
// @dominatorparts_orders_bot (реєструється один раз через
// https://api.telegram.org/bot<ТОКЕН>/setWebhook — див. коментар у
// lib/telegramNotify.ts). Тут три різних сценарії:
//
//   1. Команда "/start <телефон>" — якою бот дізнається, ЧИЙ це
//      chat_id (детально нижче).
//   2. Звичайне повідомлення ВІД ПОКУПЦЯ — написав боту напряму
//      (кнопка "Telegram" у шапці сайту, components/StorefrontHome.tsx,
//      веде саме на t.me/dominatorparts_orders_bot без жодного
//      "/start"). Пересилається в чат власника (той самий, куди
//      приходять сповіщення про нові замовлення, sendTelegramMessage) —
//      і ЗАПАМ'ЯТОВУЄТЬСЯ (telegram_relay_messages, schema.sql), щоб
//      можна було розпізнати відповідь на нього, див. пункт 3
//   3. Відповідь ВІД ВЛАСНИКА на пересилку з пункту 2 — власник
//      натискає "Reply" на переслане повідомлення прямо в Telegram;
//      апдейт приходить з заповненим message.reply_to_message.message_id,
//      за яким у telegram_relay_messages знаходиться chat_id покупця —
//      і текст відповіді летить ЙОМУ. Так оператор відповідає покупцю
//      прямо з Telegram, не заходячи на сайт
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
import { computeTelegramWebhookSecret, isOwnerChat, sendTelegramMessage, sendTelegramMessageTo } from '@/lib/telegramNotify';

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

interface TelegramFrom {
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    from?: TelegramFrom;
    text?: string;
    // Заповнене, коли це повідомлення — відповідь на інше (власник
    // натиснув "Reply" в Telegram). message_id — id ТОГО повідомлення,
    // на яке відповіли
    reply_to_message?: { message_id: number };
  };
}

// Як підписати повідомлення в чаті власника (sendTelegramMessage), щоб
// було зрозуміло, ХТО написав — юзернейм найзручніший (можна відкрити
// профіль і відповісти напряму), якщо його немає — просто ім'я з
// Telegram, а якщо і того немає — хоча б chat_id
function formatSenderLabel(from: TelegramFrom | undefined, chatId: number): string {
  if (from?.username) return `@${from.username}`;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ');
  return name || `chat_id ${chatId}`;
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

  // Не текстове повідомлення (стікер, фото тощо) — нам тут його
  // обробляти нема чим, Telegram все одно чекає 200 OK, інакше почне
  // повторювати доставку цього ж апдейту
  if (!message || !text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;

  // ---- чат ВЛАСНИКА (той самий, куди приходять усі сповіщення) ----
  // Тут нас цікавить ЛИШЕ "Reply" на пересилку від покупця — решту
  // повідомлень власника (нотатки собі, звичайне листування з ботом
  // без відповіді на конкретне повідомлення) ніяк не обробляємо й не
  // пересилаємо саме собі — раніше це давало безглузде "Дякуємо! Ваше
  // повідомлення передано менеджеру" у відповідь на власні повідомлення
  if (isOwnerChat(chatId)) {
    const replyToId = message.reply_to_message?.message_id;
    if (!replyToId) {
      return NextResponse.json({ ok: true });
    }

    try {
      const relayResult = await pool.query<{ customer_chat_id: string }>(
        'SELECT customer_chat_id FROM telegram_relay_messages WHERE admin_message_id = $1',
        [replyToId]
      );
      const customerChatId = relayResult.rows[0]?.customer_chat_id;
      if (customerChatId) {
        await sendTelegramMessageTo(customerChatId, text);
      }
    } catch (error) {
      console.error('Ошибка при пересылке ответа оператора клиенту:', error);
    }

    return NextResponse.json({ ok: true });
  }

  // ---- усе, що нижче, — повідомлення ВІД ПОКУПЦЯ ----
  const isStartCommand = /^\/start(?:@\w+)?/.test(text);

  if (!isStartCommand) {
    // Звичайне повідомлення (не команда "/start") — покупець написав
    // боту напряму, найімовірніше через кнопку "Telegram" у шапці
    // сайту. Пересилаємо в чат власника (той самий, куди приходять
    // сповіщення про замовлення), запам'ятовуємо message_id цієї
    // пересилки (щоб розпізнати відповідь на неї вище) і підтверджуємо
    // покупцю, що його прочитають — сам бот діалог не веде, відповідає
    // вже людина, коли відповість "Reply" на пересилку в Telegram
    const senderLabel = formatSenderLabel(message.from, chatId);
    const relayedMessageId = await sendTelegramMessage(`💬 Повідомлення від ${senderLabel} у Telegram-боті:\n\n${text}`);

    if (relayedMessageId) {
      try {
        await pool.query(
          `
          INSERT INTO telegram_relay_messages (admin_message_id, customer_chat_id)
          VALUES ($1, $2)
          ON CONFLICT (admin_message_id) DO UPDATE SET customer_chat_id = EXCLUDED.customer_chat_id
          `,
          [relayedMessageId, chatId]
        );
      } catch (error) {
        console.error('Ошибка при сохранении пересылки сообщения от клиента:', error);
      }
    }

    await sendTelegramMessageTo(chatId, 'Дякуємо! Ваше повідомлення передано менеджеру, ми відповімо найближчим часом.');
    return NextResponse.json({ ok: true });
  }

  const payload = extractStartPayload(text);

  if (!payload) {
    // "/start" без телефону — покупець відкрив бота напряму (не через
    // посилання-запрошення з кабінету). Пояснюємо, як підключити
    // сповіщення правильно
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
