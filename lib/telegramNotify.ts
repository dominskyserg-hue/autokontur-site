// ============================================================
// Відправка сповіщень у Telegram через Bot API — звичайний fetch()
// без бібліотек, прямий HTTP POST на api.telegram.org.
//
// Використовується у двох сценаріях:
//   1. sendTelegramMessage() — сповіщення ВЛАСНИКА магазину про нове
//      замовлення (app/api/orders/create/route.ts) — в один фіксований
//      чат TELEGRAM_CHAT_ID.
//   2. sendTelegramMessageTo() — персональне сповіщення КОНКРЕТНОГО
//      покупця (той самий бот, інший chat_id) — про склад щойно
//      оформленого замовлення (app/api/orders/create/route.ts) і про
//      ТТН, коли адмін його проставляє (app/api/orders/[id]/route.ts).
//      chat_id покупця береться з таблиці customer_telegram_links —
//      з'являється там лише після того, як покупець сам натиснув
//      посилання-запрошення в кабінеті і написав боту "/start"
//      (app/api/telegram/webhook/route.ts, components/CustomerDashboard.tsx)
//
// Як підключити (бот вже створений і токен вже заданий):
//   1. Написати @BotFather в Telegram, командою /newbot створити бота,
//      отримати токен виду "123456789:AAH...".
//   2. Задати TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID у змінних оточення
//      Vercel (Project Settings → Environment Variables) і в
//      .env.local для локальної розробки.
//   3. Зареєструвати вебхук (одноразово, окремим скриптом) —
//      https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=<адреса
//      app/api/telegram/webhook/route.ts>&secret_token=<computeTelegramWebhookSecret()>
//
// Якщо TELEGRAM_BOT_TOKEN не заданий — усі відправки тихо пропускаються:
// без токена бот в принципі не зможе написати. Помилка при цьому НЕ
// кидається — сповіщення додаткове, відсутність налаштування не
// повинна заважати оформленню замовлення
// ============================================================

import { createHash } from 'crypto';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Юзернейм бота — потрібен лише для побудови посилання-запрошення
// "https://t.me/<юзернейм>?start=<телефон>" у кабінеті покупця
// (components/CustomerDashboard.tsx). Не секрет, тому просто константа,
// без окремої змінної оточення
export const TELEGRAM_BOT_USERNAME = 'dominatorparts_orders_bot';

// Повертають id щойно надісланого повідомлення (або null, якщо
// відправка не відбулась — немає токена/chat_id чи Telegram повернув
// помилку). Потрібен app/api/telegram/webhook/route.ts: коли
// покупець пише боту напряму, його повідомлення пересилається сюди ж
// (sendTelegramMessage), і саме message_id ЦІЄЇ пересилки запам'ятовується
// (telegram_relay_messages, schema.sql) — щоб згодом, коли власник
// ВІДПОВІСТЬ на неї в Telegram (звичайною функцією "Reply"), бот зміг
// зрозуміти, якому саме покупцю адресована відповідь, і переслати
// текст саме йому
export async function sendTelegramMessage(text: string): Promise<number | null> {
  if (!TELEGRAM_CHAT_ID) return null;
  return sendTelegramMessageTo(TELEGRAM_CHAT_ID, text);
}

// Reply-клавіатура з кнопками головного меню бота (див. коментар
// "ГОЛОВНЕ МЕНЮ БОТА" в app/api/telegram/webhook/route.ts) —
// resize_keyboard: true означає, що Telegram-клієнт лишає ці кнопки
// під полем вводу постійно, а не ховає одразу після одного натискання.
// keyboard тут — рядки для зручності виклику (MAIN_MENU_KEYBOARD пишеться
// простим масивом підписів кнопок); у сам HTTP-запит до Telegram кожен
// рядок перетворюється на об'єкт { text: рядок } нижче — сирий Bot API
// (на відміну від деяких SDK) приймає лише таку форму, голий рядок
// замість об'єкта Telegram просто відхилить разом з усім повідомленням
export interface TelegramReplyKeyboard {
  keyboard: string[][];
  resize_keyboard: true;
}

// messageThreadId — необов'язковий id ТЕМИ форуму (supergroup із
// увімкненими Topics), якщо повідомлення потрібно надіслати не в
// загальний потік чату, а в конкретну тему — див. createForumTopic()
// і "Мій Гараж підтримки" в app/api/telegram/webhook/route.ts.
// replyMarkup — необов'язкова reply-клавіатура (кнопки головного меню)
export async function sendTelegramMessageTo(
  chatId: string | number,
  text: string,
  messageThreadId?: number,
  replyMarkup?: TelegramReplyKeyboard
): Promise<number | null> {
  if (!TELEGRAM_BOT_TOKEN) return null;

  const wireReplyMarkup = replyMarkup
    ? { keyboard: replyMarkup.keyboard.map((row) => row.map((label) => ({ text: label }))), resize_keyboard: true }
    : undefined;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Без parse_mode — навмисно: текст може містити ім'я/коментар
      // покупця (довільний ввід), а HTML/Markdown-розмітка Telegram
      // відхиляє ВЕСЬ запит цілком, якщо в тексті трапився "зайвий"
      // символ на кшталт "<" чи "*" — простий текст такого ризику не має
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        ...(wireReplyMarkup ? { reply_markup: wireReplyMarkup } : {}),
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('Telegram API повернув помилку при відправці сповіщення:', response.status, JSON.stringify(data));
      return null;
    }

    return data?.result?.message_id ?? null;
  } catch (error) {
    // Збій відправки в Telegram НЕ повинен ламати оформлення замовлення —
    // це додаткове сповіщення, а не критична частина покупки
    console.error('Не вдалося відправити сповіщення в Telegram:', error);
    return null;
  }
}

// Створює нову тему форуму (Topic) у supergroup з увімкненими Topics —
// один customer_chat_id отримує РІВНО одну тему, щоб листування з
// різними покупцями не змішувалось в один потік (telegram_support_topics,
// schema.sql). Група МАЄ бути supergroup з увімкненою опцією "Topics"
// (Group Info → Edit → Topics у самому Telegram — Bot API це не вміє
// увімкнути, лише користувач) і бот у ній — адміністратором із правом
// "Manage Topics". Повертає message_thread_id нової теми або null, якщо
// щось не так (немає прав, група не форум тощо) — виклик, що це
// викликав, тоді сам вирішує, як діяти далі (зазвичай — відкат на
// звичайну пересилку без теми)
export async function createForumTopic(chatId: string | number, name: string): Promise<number | null> {
  if (!TELEGRAM_BOT_TOKEN) return null;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Telegram обмежує назву теми 128 символами — обрізаємо про всяк
      // випадок, щоб довге ім'я/юзернейм покупця не завалило запит
      body: JSON.stringify({ chat_id: chatId, name: name.slice(0, 128) }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.error('Telegram API повернув помилку при створенні теми форуму:', response.status, JSON.stringify(data));
      return null;
    }

    return data?.result?.message_thread_id ?? null;
  } catch (error) {
    console.error('Не вдалося створити тему форуму в Telegram:', error);
    return null;
  }
}

// Чат власника (TELEGRAM_CHAT_ID) — той самий, куди приходять
// сповіщення про замовлення і пересилки повідомлень від покупців.
// Потрібен вебхуку, щоб відрізнити "власник відповідає на пересилку"
// від "покупець написав боту" — це різні гілки обробки одного й того
// самого апдейту (app/api/telegram/webhook/route.ts)
export function isOwnerChat(chatId: number): boolean {
  return TELEGRAM_CHAT_ID != null && String(chatId) === String(TELEGRAM_CHAT_ID);
}

// ------------------------------------------------------------
// СЕКРЕТ ВЕБХУКА — щоб app/api/telegram/webhook/route.ts міг
// відрізнити СПРАВЖНІ запити від Telegram від будь-кого стороннього,
// хто вгадає адресу вебхука (вона не є секретом сама по собі — це
// звичайний публічний URL сайту)
// ------------------------------------------------------------
// Навмисно НЕ окрема змінна оточення, а детермінований хеш від уже
// наявного TELEGRAM_BOT_TOKEN — і скрипт одноразової реєстрації
// вебхука (setWebhook), і сам роут-обробник рахують той самий хеш із
// того самого TELEGRAM_BOT_TOKEN, тому додаткового секрету заводити
// й десь окремо зберігати не потрібно. Telegram надсилає це значення
// назад у кожному запиті на вебхук у заголовку
// X-Telegram-Bot-Api-Secret-Token — роут звіряє його з цим же хешем
export function computeTelegramWebhookSecret(): string | null {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return createHash('sha256').update(`${TELEGRAM_BOT_TOKEN}:webhook`).digest('hex');
}
