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

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_CHAT_ID) return;
  await sendTelegramMessageTo(TELEGRAM_CHAT_ID, text);
}

export async function sendTelegramMessageTo(chatId: string | number, text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) return;

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
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Telegram API повернув помилку при відправці сповіщення:', response.status, errorBody);
    }
  } catch (error) {
    // Збій відправки в Telegram НЕ повинен ламати оформлення замовлення —
    // це додаткове сповіщення, а не критична частина покупки
    console.error('Не вдалося відправити сповіщення в Telegram:', error);
  }
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
