// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/telegram/webhook
//
// Сюди Telegram надсилає КОЖНЕ повідомлення, написане боту
// @dominatorparts_orders_bot (реєструється один раз через
// https://api.telegram.org/bot<ТОКЕН>/setWebhook — див. коментар у
// lib/telegramNotify.ts). Тут кілька різних сценаріїв:
//
//   1. Команда "/start <телефон>" — якою бот дізнається, ЧИЙ це
//      chat_id, щоб надсилати покупцю персональні сповіщення про
//      замовлення (детально нижче).
//   2. Команда "/register_support" — власник магазину один раз
//      надсилає її у СВОЮ ЗАКРИТУ групу-форум (Group Info → Edit →
//      Topics), щоб бот запам'ятав: "ось куди створювати окрему тему
//      на кожного покупця". Bot API не вміє САМ створити групу чи
//      увімкнути Topics — це власник робить вручну в Telegram, а
//      команда лише повідомляє боту вже готовий chat_id
//   3. Звичайне повідомлення ВІД ПОКУПЦЯ — написав боту напряму
//      (кнопка "Telegram" у шапці сайту, components/StorefrontHome.tsx,
//      веде саме на t.me/dominatorparts_orders_bot без жодного
//      "/start"). Якщо групу-форум зареєстровано (крок 2) — бот
//      створює покупцю ОКРЕМУ тему там (і надалі всі його
//      повідомлення йдуть у ту саму тему, telegram_support_topics,
//      schema.sql); якщо ні — запасний варіант: пласка пересилка в
//      один спільний чат власника (telegram_relay_messages)
//   4. Відповідь ВІД ВЛАСНИКА — або в темі покупця в групі-форумі
//      (крок 3), або "Reply" на пересилку в запасному "пласкому"
//      варіанті — текст відповіді летить відповідному покупцю. Так
//      оператор відповідає покупцю прямо з Telegram, не заходячи на сайт
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
// детермінованим хешем, що рахує computeTelegramWebhookSecret().
// Так само "/register_support" приймається ЛИШЕ від власника (його
// особистий Telegram user id збігається з TELEGRAM_CHAT_ID) — інакше
// будь-хто, додавши бота у СВОЮ групу, міг би перехопити переписку
// з усіма покупцями на себе
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import {
  computeTelegramWebhookSecret,
  createForumTopic,
  isOwnerChat,
  sendTelegramMessage,
  sendTelegramMessageTo,
} from '@/lib/telegramNotify';
import { searchProductsForBot, type BotSearchResult } from '@/lib/productSearch';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';

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
  id: number;
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
    // на яке відповіли. Використовується лише в "пласкому" запасному
    // варіанті (без групи-форуму)
    reply_to_message?: { message_id: number };
    // Заповнене, коли повідомлення надіслано ВСЕРЕДИНІ теми форуму
    // (не в "Загальну" тему) — саме за цим id знаходимо, якому
    // покупцю адресована відповідь власника
    message_thread_id?: number;
  };
}

// Як підписати повідомлення в чаті/темі власника, щоб було зрозуміло,
// ХТО написав — юзернейм найзручніший (можна відкрити профіль),
// якщо його немає — просто ім'я з Telegram, а якщо і того немає —
// хоча б chat_id. Використовується і як підпис пересилки, і як назва
// теми форуму (createForumTopic)
function formatSenderLabel(from: TelegramFrom | undefined, chatId: number): string {
  if (from?.username) return `@${from.username}`;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ');
  return name || `chat_id ${chatId}`;
}

// ============================================================
// МОДЕЛЬ АВТОМАТИЧНИХ ВІДПОВІДЕЙ ПОКУПЦЮ — усе, що бот сам (без участі
// оператора) відповідає на ЗВИЧАЙНЕ повідомлення (не команду), звірене
// з тим, що реально сталось із запитом:
//
//   1. Пошук (searchProductsForBot нижче) ЩОСЬ ЗНАЙШОВ — покупець
//      одразу бачить готові варіанти (formatBotSearchReply). Це ОДНЕ
//      повідомлення, без додаткового "дякуємо, передано менеджеру" —
//      воно вже й так відповідає на запит, дублювати нема сенсу.
//   2. Пошук НІЧОГО не знайшов (NOT_FOUND_REPLY) — окремий текст,
//      чесний про те, що сталось ("не знайшла одразу"), а не той
//      самий безликий "дякуємо", що і при вдалому пошуку.
// В обох випадках повідомлення покупця ОДНАКОВО йде оператору (тема
// форуму чи пласка пересилка) — бот не підмінює живу підтримку, лише
// пришвидшує відповідь, коли може
// ============================================================
const BOT_SEARCH_LIMIT = 5;

function formatBotSearchReply(results: BotSearchResult[], totalCount: number): string {
  const lines = results.map((r, i) => {
    const url = `${SITE_URL}${buildProductPath(r.id, { brand: r.brand, article: r.article, name: r.name })}`;
    const stockLabel = r.stock > 0 ? 'в наявності' : 'під замовлення';
    const title = [r.brand, r.name].filter(Boolean).join(' — ') || r.article;
    return `${i + 1}. ${title}\n   Артикул: ${r.article} · ${r.retailPrice} грн · ${stockLabel}\n   ${url}`;
  });

  const header =
    totalCount > results.length
      ? `🔍 Знайшла ${totalCount} варіантів, ось найкращі ${results.length}:`
      : `🔍 Знайшла ${totalCount === 1 ? 'варіант' : 'варіанти'}:`;

  return `${header}\n\n${lines.join('\n\n')}\n\nЯкщо потрібна допомога з вибором — оператор також бачить ваше повідомлення і підключиться за потреби.`;
}

const NOT_FOUND_REPLY =
  'Поки що не знайшла точного варіанту автоматично — передала ваше повідомлення менеджеру, він перевірить наявність і підбере деталь вручну. Відповімо найближчим часом.';

// chat_id закритої групи-форуму (site_settings.telegram_staff_chat_id) —
// null, доки власник не надіслав туди "/register_support"
async function getStaffChatId(): Promise<number | null> {
  try {
    const result = await pool.query<{ telegram_staff_chat_id: string | null }>(
      'SELECT telegram_staff_chat_id FROM site_settings WHERE id = 1'
    );
    const raw = result.rows[0]?.telegram_staff_chat_id;
    return raw ? Number(raw) : null;
  } catch (error) {
    console.error('Ошибка при чтении staff-группы для Telegram:', error);
    return null;
  }
}

// Повертає message_thread_id теми ЦЬОГО покупця в групі-форумі —
// якщо тема вже була, бере готову з бази; якщо ні, створює нову
// (createForumTopic) і зберігає. null — якщо створити не вдалось
// (група не форум, бот не адмін тощо) — виклик тоді сам падає в
// запасний "плаский" варіант
async function findOrCreateSupportTopic(
  staffChatId: number,
  customerChatId: number,
  topicName: string
): Promise<number | null> {
  try {
    const existing = await pool.query<{ message_thread_id: string }>(
      'SELECT message_thread_id FROM telegram_support_topics WHERE customer_chat_id = $1',
      [customerChatId]
    );
    if (existing.rows[0]) return Number(existing.rows[0].message_thread_id);
  } catch (error) {
    console.error('Ошибка при поиске темы поддержки клиента:', error);
  }

  const topicId = await createForumTopic(staffChatId, topicName);
  if (!topicId) return null;

  try {
    await pool.query(
      `
      INSERT INTO telegram_support_topics (customer_chat_id, message_thread_id)
      VALUES ($1, $2)
      ON CONFLICT (customer_chat_id) DO UPDATE SET message_thread_id = EXCLUDED.message_thread_id
      `,
      [customerChatId, topicId]
    );
  } catch (error) {
    console.error('Ошибка при сохранении темы поддержки клиента:', error);
  }

  return topicId;
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

  // ---- "/register_support" — власник реєструє закриту групу-форум ----
  // ЛИШЕ в груповому чаті (chatId < 0) і ЛИШЕ від самого власника —
  // хтось інший, додавши бота у власну групу, не зможе перехопити
  // переписку з покупцями на себе
  if (/^\/register_support(?:@\w+)?$/.test(text)) {
    if (chatId < 0 && message.from && isOwnerChat(message.from.id)) {
      try {
        await pool.query(
          `
          INSERT INTO site_settings (id, telegram_staff_chat_id)
          VALUES (1, $1)
          ON CONFLICT (id) DO UPDATE SET telegram_staff_chat_id = EXCLUDED.telegram_staff_chat_id
          `,
          [chatId]
        );
        await sendTelegramMessageTo(
          chatId,
          '✅ Цю групу зареєстровано як групу підтримки. Переконайтесь, що в ній увімкнено Topics (Редагувати групу → Topics) і бот доданий адміністратором із правом «Управління темами» — інакше теми на кожного покупця просто не створюватимуться.'
        );
      } catch (error) {
        console.error('Ошибка при регистрации staff-группы для Telegram:', error);
      }
    }
    return NextResponse.json({ ok: true });
  }

  const staffChatId = await getStaffChatId();

  // ---- відповідь ВЛАСНИКА в темі покупця в групі-форумі ----
  if (staffChatId && chatId === staffChatId && message.message_thread_id) {
    try {
      const topicResult = await pool.query<{ customer_chat_id: string }>(
        'SELECT customer_chat_id FROM telegram_support_topics WHERE message_thread_id = $1',
        [message.message_thread_id]
      );
      const customerChatId = topicResult.rows[0]?.customer_chat_id;
      if (customerChatId) {
        await sendTelegramMessageTo(customerChatId, text);
      }
    } catch (error) {
      console.error('Ошибка при пересылке ответа оператора из темы клиенту:', error);
    }
    return NextResponse.json({ ok: true });
  }

  // ---- чат ВЛАСНИКА (запасний "плаский" варіант, без групи-форуму) ----
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
    // Спершу пробуємо знайти деталь по тексту самого повідомлення —
    // якщо покупець написав щось на кшталт "колодки передні мазда 6
    // 2008 2.0" чи просто назву запчастини, показуємо йому готові
    // варіанти одразу, не чекаючи на менеджера. Помилка пошуку (напр.
    // тимчасова недоступність бази) НЕ повинна ламати звичайну
    // пересилку повідомлення нижче — тому обгорнуто в try/catch
    let searchFound = false;
    try {
      const { results, totalCount } = await searchProductsForBot(pool, text, BOT_SEARCH_LIMIT);
      if (results.length > 0) {
        searchFound = true;
        await sendTelegramMessageTo(chatId, formatBotSearchReply(results, totalCount));
      }
    } catch (error) {
      console.error('Ошибка при поиске товара по сообщению клиента в Telegram-боте:', error);
    }

    // Автовідповідь покупцю ПРО ПЕРЕСИЛКУ — лише якщо пошук нічого не
    // показав: якщо показав (searchFound), formatBotSearchReply вище
    // вже й так відповів по суті, другого "дякуємо" не потрібно (див.
    // коментар "МОДЕЛЬ АВТОМАТИЧНИХ ВІДПОВІДЕЙ" вище)
    const autoReplyText = searchFound ? null : NOT_FOUND_REPLY;

    // Звичайне повідомлення (не команда "/start") — покупець написав
    // боту напряму, найімовірніше через кнопку "Telegram" у шапці
    // сайту. Якщо групу-форум зареєстровано — своя тема на покупця
    // (findOrCreateSupportTopic); якщо ні (або створення теми не
    // вдалось) — запасний "плаский" варіант, той самий, що й раніше
    const senderLabel = formatSenderLabel(message.from, chatId);

    if (staffChatId) {
      const topicId = await findOrCreateSupportTopic(staffChatId, chatId, senderLabel);
      if (topicId) {
        await sendTelegramMessageTo(staffChatId, text, topicId);
        if (autoReplyText) await sendTelegramMessageTo(chatId, autoReplyText);
        return NextResponse.json({ ok: true });
      }
    }

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

    if (autoReplyText) await sendTelegramMessageTo(chatId, autoReplyText);
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
