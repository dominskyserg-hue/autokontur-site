// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/telegram/webhook
//
// Сюди Telegram надсилає КОЖНЕ повідомлення, написане боту
// @dominatorparts_orders_bot (реєструється один раз через
// https://api.telegram.org/bot<ТОКЕН>/setWebhook — див. коментар у
// lib/telegramNotify.ts). Тут кілька різних сценаріїв:
//
//   1. Кнопка "📱 Поділитися номером" (request_contact) — так бот
//      дізнається, ЧИЙ це chat_id, щоб надсилати покупцю персональні
//      сповіщення про замовлення (детально нижче).
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
//   5. Кнопки ГОЛОВНОГО МЕНЮ (reply-клавіатура під полем вводу, див.
//      MAIN_MENU_KEYBOARD нижче) — "Пошук за авто", "Пошук за
//      артикулом", "Мої замовлення", "Зв'язок з оператором". Дві
//      кнопки пошуку лише підказують, що написати далі (сам пошук —
//      той самий, що і в кроці 3), "Мої замовлення" читає замовлення
//      покупця з тієї ж бази, що й Особистий кабінет на сайті
//
// Привязка номера (ИЗМЕНЕНО по аудиту безопасности): раньше номер
// брался из текста "/start <телефон>" (ссылка из кабинета) — и любой
// мог сам написать боту "/start <чужой номер>" и получать чужие
// уведомления. Теперь "/start" (с чем угодно после него, в т.ч. старые
// ссылки и новая t.me/бот?start=link) только показывает кнопку
// "📱 Поділитися номером". Номер принимается ТОЛЬКО из message.contact
// и только если contact.user_id === from.id (свой номер, а не
// пересланный чужой контакт). Если номер уже был привязан к другому
// чату — перепривязываем (номер подтверждён Telegram), но старому чату
// пишем "Ваш номер відв'язано від цього чату".
//
// БЕЗПЕКА ЗАПРОСОВ: без перевірки нижче будь-хто, хто дізнається адресу
// цього роута (вона не секретна — звичайний URL сайту), міг би слати
// сюди підроблені апдейти від імені Telegram. Тому Telegram підписує кожен
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
  type TelegramReplyKeyboard,
} from '@/lib/telegramNotify';
import { searchProductsForBot, type BotSearchResult } from '@/lib/productSearch';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import { normalizePhone } from '@/lib/phoneNormalize';

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
    // Заполнено, когда покупатель нажал кнопку "📱 Поділитися номером"
    // (request_contact). user_id — Telegram-аккаунт ВЛАДЕЛЬЦА контакта:
    // совпадает с from.id только если человек поделился СВОИМ номером,
    // а не переслал чужой контакт из записной книжки
    contact?: {
      phone_number: string;
      user_id?: number;
    };
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
// ГОЛОВНЕ МЕНЮ БОТА — reply-клавіатура з 4 кнопками, у стилі сайту
// (ті самі розділи, що й у шапці/Особистому кабінеті: пошук за
// автомобілем, пошук за артикулом, "Мої замовлення", зв'язок з
// підтримкою). Прикріплюється до КОЖНОГО повідомлення покупцю в цьому
// файлі — Telegram-клієнт лишає кнопки під полем вводу постійно,
// тому не важливо, з якого повідомлення покупець почав діалог
// (з "/start", з кнопки "Telegram" на сайті чи просто написав напряму).
//
// Дві кнопки пошуку ("за авто" і "за артикулом") НЕ заводять окремої
// гілки логіки — обидві лише підказують покупцю, що написати ДАЛІ
// звичайним повідомленням, а сам пошук (searchProductsForBot нижче)
// однаково розуміє і "Тойота Королла 2015 колодки передні", і голий
// артикул "0986424815" в одному й тому самому запиті. Розділ на дві
// кнопки — це підказка покупцю, а не два різних алгоритми
const BTN_SEARCH_CAR = '🔍 Пошук за авто';
const BTN_SEARCH_ARTICLE = '🔢 Пошук за артикулом';
const BTN_ORDERS = '📦 Мої замовлення';
const BTN_OPERATOR = '💬 Зв\'язок з оператором';

const MAIN_MENU_KEYBOARD: TelegramReplyKeyboard = {
  keyboard: [
    [BTN_SEARCH_CAR, BTN_SEARCH_ARTICLE],
    [BTN_ORDERS, BTN_OPERATOR],
  ],
  resize_keyboard: true,
};

// Клавиатура для ПРИВЯЗКИ номера: кнопка request_contact + то же меню.
// Привязка номера — ТОЛЬКО через эту кнопку: номер тогда присылает сам
// Telegram (подтверждённый номер аккаунта). Раньше номер брался из
// текста "/start <номер>" — и любой мог ввести чужой номер и начать
// получать чужие уведомления о заказах
const BTN_SHARE_PHONE = '📱 Поділитися номером';

const SHARE_PHONE_KEYBOARD: TelegramReplyKeyboard = {
  keyboard: [[{ text: BTN_SHARE_PHONE, request_contact: true }], ...MAIN_MENU_KEYBOARD.keyboard],
  resize_keyboard: true,
};

const SHARE_PHONE_PROMPT =
  'Щоб отримувати тут сповіщення про свої замовлення (склад замовлення, номер ТТН), натисніть кнопку «📱 Поділитися номером» нижче — номер має збігатися з тим, що ви вказували при оформленні замовлення.';

// Привязка ПОДТВЕРЖДЁННОГО Telegram номера к чату. Без ON CONFLICT DO
// UPDATE: сначала смотрим, не привязан ли номер к ДРУГОМУ чату. Раз
// номер подтверждён Telegram (contact.user_id === from.id), перепривязку
// разрешаем, но прежний чат явно уведомляем — молча номер не уходит
async function linkVerifiedPhone(chatId: number, phoneTail: string, username: string | null): Promise<void> {
  const existing = await pool.query<{ telegram_chat_id: string }>(
    'SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1',
    [phoneTail]
  );
  const previousChatId = existing.rows[0]?.telegram_chat_id ?? null;

  if (previousChatId === null) {
    await pool.query(
      'INSERT INTO customer_telegram_links (phone, telegram_chat_id, telegram_username) VALUES ($1, $2, $3)',
      [phoneTail, chatId, username]
    );
  } else {
    await pool.query(
      'UPDATE customer_telegram_links SET telegram_chat_id = $2, telegram_username = $3 WHERE phone = $1',
      [phoneTail, chatId, username]
    );
  }

  if (previousChatId !== null && String(previousChatId) !== String(chatId)) {
    await sendTelegramMessageTo(previousChatId, "Ваш номер відв'язано від цього чату.");
  }
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новий',
  processing: 'В обробці',
  ordered_from_supplier: 'Замовлено у постачальника',
  in_stock: 'На складі',
  ready_for_pickup: 'Готовий до видачі',
  shipped: 'Відправлено',
  cancelled: 'Скасовано',
};

// "Мої замовлення" — той самий принцип пошуку заказів за телефоном,
// що й в Особистому кабінеті (app/api/customer/orders/route.ts), лише
// телефон тут беремо не з форми входу, а з уже збереженої прив'язки
// chat_id → телефон (customer_telegram_links, заповнюється, коли покупець
// натискає "📱 Поділитися номером", див. linkVerifiedPhone). Один chat_id теоретично може бути
// прив'язаний до кількох телефонів (якщо покупець оформлював
// замовлення під різними номерами) — тому IN (...), а не "=" один
async function fetchOrdersForChat(
  chatId: number
): Promise<Array<{ id: string; orderNumber: number; status: string; itemsCount: number; totalAmount: number; createdAt: string }>> {
  const result = await pool.query(
    `
    SELECT o.id, o.order_number, o.status, o.created_at,
      COUNT(oi.id) AS items_count,
      COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE RIGHT(regexp_replace(o.customer_phone, '\\D', '', 'g'), 9) IN (
      SELECT phone FROM customer_telegram_links WHERE telegram_chat_id = $1
    )
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 10
    `,
    [chatId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    // order_number — колонка INTEGER, драйвер pg возвращает такие
    // значения обычным числом, а не строкой
    orderNumber: row.order_number,
    status: row.status,
    itemsCount: parseInt(row.items_count, 10),
    totalAmount: parseFloat(row.total_amount),
    createdAt: row.created_at,
  }));
}

function formatOrdersReply(
  orders: Array<{ id: string; orderNumber: number; status: string; itemsCount: number; totalAmount: number; createdAt: string }>
): string {
  if (orders.length === 0) {
    return 'Замовлень поки не знайдено. Якщо ви вже оформлювали замовлення на сайті — натисніть «📱 Поділитися номером» нижче (номер Telegram має збігатися з номером у замовленні).';
  }

  const lines = orders.map((o) => {
    const date = new Date(o.createdAt).toLocaleDateString('uk-UA');
    const statusLabel = STATUS_LABELS[o.status] || o.status;
    return `№${o.orderNumber} від ${date} — ${statusLabel}\n   ${o.itemsCount} поз. на ${o.totalAmount} грн`;
  });

  // Ссылки на Особистий кабінет нет — кабинет временно выключен
  // (CUSTOMER_CABINET_ENABLED, см. lib/customerCabinet.ts)
  return `📦 Ваші останні замовлення:\n\n${lines.join('\n\n')}\n\nСклад і деталі замовлення підкаже менеджер — кнопка «${BTN_OPERATOR}».`;
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

  // ---- покупатель поделился номером (кнопка request_contact) ----
  // Это сообщение без text, поэтому обрабатываем ДО проверки ниже.
  // Только личный чат с ботом (chat.id > 0) — в группах не привязываем
  if (message?.contact && message.chat.id > 0) {
    const contactChatId = message.chat.id;
    const contact = message.contact;

    // Номер принимаем ТОЛЬКО если человек поделился СВОИМ контактом:
    // пересланный чужой контакт имеет другой user_id (или вовсе без него)
    if (!message.from || !contact.user_id || contact.user_id !== message.from.id) {
      await sendTelegramMessageTo(contactChatId, 'Будь ласка, поділіться своїм власним номером.', undefined, SHARE_PHONE_KEYBOARD);
      return NextResponse.json({ ok: true });
    }

    // Тот же формат, что в заказах и кабинете: последние 9 цифр
    const phoneTail = normalizePhone(contact.phone_number);
    if (phoneTail.length < 9) {
      await sendTelegramMessageTo(contactChatId, 'Не вдалося розпізнати номер телефону. Спробуйте ще раз.', undefined, SHARE_PHONE_KEYBOARD);
      return NextResponse.json({ ok: true });
    }

    try {
      await linkVerifiedPhone(contactChatId, phoneTail, message.from.username || null);
      await sendTelegramMessageTo(
        contactChatId,
        'Готово! Тепер сюди приходитимуть сповіщення про ваші замовлення на DominatorParts — склад замовлення одразу після оформлення та номер ТТН Нової Пошти, коли ми відправимо посилку. А кнопками нижче можна одразу перевірити наявність деталі чи свої замовлення.',
        undefined,
        MAIN_MENU_KEYBOARD
      );
    } catch (error) {
      console.error('Ошибка при сохранении привязки Telegram-чата покупателя:', error);
      await sendTelegramMessageTo(contactChatId, 'Не вдалося зберегти номер — спробуйте, будь ласка, трохи пізніше.', undefined, SHARE_PHONE_KEYBOARD);
    }
    return NextResponse.json({ ok: true });
  }

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
    // ---- кнопки головного меню ----
    // Reply-кнопка, коли на неї натискають, приходить сюди як ЗВИЧАЙНЕ
    // текстове повідомлення з текстом самої кнопки — тому просто
    // звіряємо text з підписами кнопок. Обидві кнопки пошуку і кнопка
    // "Зв'язок з оператором" нічого не шукають і нікуди не пересилають
    // самі по собі — це лише підказка, що написати ДАЛІ; той наступний
    // текст покупця вже піде звичайним шляхом нижче (пошук і/або
    // пересилка оператору)
    if (text === BTN_SEARCH_CAR) {
      await sendTelegramMessageTo(
        chatId,
        'Напишіть одним повідомленням марку, модель, рік і яку деталь шукаєте — наприклад: «Тойота Королла 2015 колодки передні». Я одразу покажу, що є в наявності.',
        undefined,
        MAIN_MENU_KEYBOARD
      );
      return NextResponse.json({ ok: true });
    }

    if (text === BTN_SEARCH_ARTICLE) {
      await sendTelegramMessageTo(
        chatId,
        'Напишіть артикул деталі (свій або крос-номер іншого виробника) — знайду точну відповідність і аналоги.',
        undefined,
        MAIN_MENU_KEYBOARD
      );
      return NextResponse.json({ ok: true });
    }

    if (text === BTN_ORDERS) {
      try {
        const orders = await fetchOrdersForChat(chatId);
        // Заказов нет (часто — номер ещё не привязан) — сразу даём
        // кнопку "Поділитися номером"
        await sendTelegramMessageTo(
          chatId,
          formatOrdersReply(orders),
          undefined,
          orders.length === 0 ? SHARE_PHONE_KEYBOARD : MAIN_MENU_KEYBOARD
        );
      } catch (error) {
        console.error('Ошибка при получении заказов клиента в Telegram-боте:', error);
        await sendTelegramMessageTo(
          chatId,
          'Не вдалося перевірити замовлення — спробуйте, будь ласка, трохи пізніше або загляньте в Особистий кабінет на сайті.',
          undefined,
          MAIN_MENU_KEYBOARD
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (text === BTN_OPERATOR) {
      await sendTelegramMessageTo(
        chatId,
        'Напишіть, будь ласка, ваше питання одним повідомленням — одразу передам менеджеру.',
        undefined,
        MAIN_MENU_KEYBOARD
      );
      return NextResponse.json({ ok: true });
    }

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
        await sendTelegramMessageTo(chatId, formatBotSearchReply(results, totalCount), undefined, MAIN_MENU_KEYBOARD);
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
        if (autoReplyText) await sendTelegramMessageTo(chatId, autoReplyText, undefined, MAIN_MENU_KEYBOARD);
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

    if (autoReplyText) await sendTelegramMessageTo(chatId, autoReplyText, undefined, MAIN_MENU_KEYBOARD);
    return NextResponse.json({ ok: true });
  }

  // "/start" в любом виде ("/start", "/start link", старые ссылки
  // "/start <номер>") НИЧЕГО не привязывает: номер из текста команды
  // мог ввести кто угодно. Вместо этого — приветствие и кнопка
  // "📱 Поділитися номером" (привязка — в обработчике message.contact выше)
  await sendTelegramMessageTo(
    chatId,
    `Вітаю! Я можу одразу підказати, що є в наявності — скористайтесь кнопками нижче.\n\n${SHARE_PHONE_PROMPT}`,
    undefined,
    SHARE_PHONE_KEYBOARD
  );
  return NextResponse.json({ ok: true });
}
