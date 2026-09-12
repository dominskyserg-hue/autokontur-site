// ============================================================
// Відправка сповіщень у Telegram через Bot API — звичайний fetch()
// без бібліотек, прямий HTTP POST на api.telegram.org. Використовується
// для миттєвого сповіщення власника про нове замовлення з вітрини
// (app/api/orders/create/route.ts) — раніше на нове замовлення взагалі
// нічого не сигналізувало.
//
// Як підключити:
//   1. Написати @BotFather в Telegram, командою /newbot створити бота,
//      отримати токен виду "123456789:AAH...".
//   2. Написати створеному боту БУДЬ-ЯКЕ повідомлення (боти не можуть
//      самі написати першими) або додати його в груповий чат.
//   3. Дізнатись chat_id: відкрити
//      https://api.telegram.org/bot<ТОКЕН>/getUpdates і знайти
//      "chat":{"id": ...} у відповіді.
//   4. Задати TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID у змінних оточення
//      Vercel (Project Settings → Environment Variables) і в
//      .env.local для локальної розробки.
//
// Якщо хоча б одна змінна не задана — відправка тихо пропускається:
// без токена бот в принципі не зможе написати, а без chat_id нема
// кому писати. Помилка при цьому НЕ кидається — сповіщення додаткове,
// відсутність налаштування не повинна заважати оформленню замовлення
// ============================================================

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Без parse_mode — навмисно: текст може містити ім'я/коментар
      // покупця (довільний ввід), а HTML/Markdown-розмітка Telegram
      // відхиляє ВЕСЬ запит цілком, якщо в тексті трапився "зайвий"
      // символ на кшталт "<" чи "*" — простий текст такого ризику не має
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
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
