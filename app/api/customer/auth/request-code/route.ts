// ============================================================
// POST /api/customer/auth/request-code   { phone }
//
// Шаг 1 входа в Особистий кабінет: одноразовый код в Telegram.
//   - номер нормализуем до последних 9 цифр (как в заказах);
//   - нет привязки Telegram для номера → { status: "need_telegram", botUrl }:
//     покупатель открывает бота и жмёт "📱 Поділитися номером";
//   - есть → 6-значный код (crypto.randomInt), в базу — только
//     sha256(код + SESSION_SECRET), сам код — в чат покупателя;
//     ответ { status: "code_sent" }.
// Лимиты: не больше 3 кодов на номер за 15 минут и не больше 10
// запросов с одного IP (x-real-ip) за 15 минут, иначе 429.
// ============================================================

import { randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getClientIp } from '@/lib/adminAuth';
import { hashLoginCode } from '@/lib/customerAuth';
import { CUSTOMER_CABINET_DISABLED_MESSAGE, isCustomerCabinetEnabled } from '@/lib/customerCabinet';
import { normalizePhone } from '@/lib/phoneNormalize';
import { rateLimit } from '@/lib/rateLimit';
import { sendTelegramMessageTo, TELEGRAM_BOT_USERNAME } from '@/lib/telegramNotify';

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

const CODE_TTL_MINUTES = 5;
const MAX_CODES_PER_PHONE = 3;
const MAX_REQUESTS_PER_IP = 10;
const LIMIT_WINDOW_SECONDS = 15 * 60;
const TOO_MANY = 'Забагато спроб, спробуйте пізніше';

export async function POST(request: NextRequest) {
  if (!isCustomerCabinetEnabled()) {
    return NextResponse.json({ error: CUSTOMER_CABINET_DISABLED_MESSAGE }, { status: 403 });
  }

  const ip = await getClientIp();
  if (!(await rateLimit(`login-code-ip:${ip}`, MAX_REQUESTS_PER_IP, LIMIT_WINDOW_SECONDS))) {
    return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  }

  let body: { phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний запит.' }, { status: 400 });
  }

  const phone = normalizePhone(String(body.phone || ''));
  if (phone.length < 9) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  try {
    const link = await pool.query<{ telegram_chat_id: string }>(
      'SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1',
      [phone]
    );
    const chatId = link.rows[0]?.telegram_chat_id;
    if (!chatId) {
      // Номер ещё не подтверждён в боте — "start=login": после привязки
      // бот скажет вернуться на сайт и нажать "Надіслати код"
      return NextResponse.json({ status: 'need_telegram', botUrl: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=login` });
    }

    const recent = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM customer_login_codes WHERE phone = $1 AND created_at > now() - interval '15 minutes'",
      [phone]
    );
    if ((recent.rows[0]?.count ?? 0) >= MAX_CODES_PER_PHONE) {
      return NextResponse.json({ error: TOO_MANY }, { status: 429 });
    }

    // 000000–999999, всегда 6 цифр (ведущие нули сохраняем)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = hashLoginCode(code);
    if (!codeHash) {
      return NextResponse.json({ error: 'SESSION_SECRET не налаштовано' }, { status: 500 });
    }

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO customer_login_codes (phone, code_hash, expires_at, ip)
       VALUES ($1, $2, now() + make_interval(mins => $3), $4)
       RETURNING id`,
      [phone, codeHash, CODE_TTL_MINUTES, ip]
    );

    const sentMessageId = await sendTelegramMessageTo(
      chatId,
      `Код для входу на dominatorparts.com.ua: ${code}. Діє ${CODE_TTL_MINUTES} хвилин. Нікому його не повідомляйте.`
    );
    if (!sentMessageId) {
      // Не дошло до Telegram — код никто не увидит, сразу его гасим
      await pool.query('UPDATE customer_login_codes SET used_at = now() WHERE id = $1', [inserted.rows[0].id]);
      return NextResponse.json({ error: 'Не вдалося надіслати код у Telegram, спробуйте пізніше.' }, { status: 502 });
    }

    return NextResponse.json({ status: 'code_sent' });
  } catch (error) {
    console.error('Ошибка при отправке кода входа покупателю:', error);
    return NextResponse.json({ error: 'Сталася помилка, спробуйте пізніше' }, { status: 500 });
  }
}
