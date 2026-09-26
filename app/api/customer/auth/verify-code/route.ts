// ============================================================
// POST /api/customer/auth/verify-code   { phone, code }
//
// Шаг 2 входа: проверка одноразового кода из Telegram.
//   - берём последний неиспользованный и непросроченный код номера;
//   - каждая попытка сначала увеличивает attempts (атомарно в базе, чтобы
//     параллельные запросы не обошли лимит); после 5 неверных код сгорает;
//   - сравнение хешей — crypto.timingSafeEqual;
//   - верный код: used_at = now(), новая сессия (токен 32 байта, в базе
//     sha256), cookie customer_session на 30 дней, и покупателю в
//     Telegram — "Виконано вхід..." (если это был не он — узнает сразу).
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { getClientIp } from '@/lib/adminAuth';
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_SECONDS,
  checkCustomerWriteLimit,
  createCustomerSession,
  customerSessionCookieOptions,
  hashLoginCode,
  loginCodeHashesMatch,
} from '@/lib/customerAuth';
import { CUSTOMER_CABINET_DISABLED_MESSAGE, isCustomerCabinetEnabled } from '@/lib/customerCabinet';
import { normalizePhone } from '@/lib/phoneNormalize';
import { RATE_LIMIT_MESSAGE } from '@/lib/rateLimit';
import { sendTelegramMessageTo } from '@/lib/telegramNotify';

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

const MAX_ATTEMPTS = 5;
const CODE_EXPIRED = 'Код більше не дійсний, запросіть новий';

export async function POST(request: NextRequest) {
  if (!isCustomerCabinetEnabled()) {
    return NextResponse.json({ error: CUSTOMER_CABINET_DISABLED_MESSAGE }, { status: 403 });
  }
  if (!(await checkCustomerWriteLimit())) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  let body: { phone?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний запит.' }, { status: 400 });
  }

  const phone = normalizePhone(String(body.phone || ''));
  const code = String(body.code || '').replace(/\D/g, '');
  if (phone.length < 9 || code.length !== 6) {
    return NextResponse.json({ error: 'Вкажіть номер телефону і 6-значний код.' }, { status: 400 });
  }

  try {
    const found = await pool.query<{ id: string; code_hash: string }>(
      `SELECT id, code_hash FROM customer_login_codes
       WHERE phone = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );
    const row = found.rows[0];
    if (!row) return NextResponse.json({ error: CODE_EXPIRED }, { status: 400 });

    // Попытку засчитываем ДО сравнения и только если лимит не исчерпан
    const counted = await pool.query<{ attempts: number }>(
      `UPDATE customer_login_codes SET attempts = attempts + 1
       WHERE id = $1 AND attempts < $2 AND used_at IS NULL
       RETURNING attempts`,
      [row.id, MAX_ATTEMPTS]
    );
    const attempts = counted.rows[0]?.attempts;
    if (attempts === undefined) return NextResponse.json({ error: CODE_EXPIRED }, { status: 400 });

    const providedHash = hashLoginCode(code);
    if (!providedHash) {
      return NextResponse.json({ error: 'SESSION_SECRET не налаштовано' }, { status: 500 });
    }

    if (!loginCodeHashesMatch(providedHash, row.code_hash)) {
      const left = MAX_ATTEMPTS - attempts;
      return NextResponse.json(
        { error: left > 0 ? `Невірний код. Залишилось спроб: ${left}.` : CODE_EXPIRED },
        { status: 400 }
      );
    }

    // Гасим код (WHERE used_at IS NULL — один код не даст две сессии)
    const used = await pool.query('UPDATE customer_login_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL', [row.id]);
    if (used.rowCount === 0) return NextResponse.json({ error: CODE_EXPIRED }, { status: 400 });

    const token = await createCustomerSession(phone, await getClientIp(), request.headers.get('user-agent'));

    // Уведомление о входе — после ответа, чтобы не задерживать покупателя
    after(async () => {
      try {
        const link = await pool.query<{ telegram_chat_id: string }>(
          'SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1',
          [phone]
        );
        const chatId = link.rows[0]?.telegram_chat_id;
        if (chatId) {
          await sendTelegramMessageTo(chatId, 'Виконано вхід в особистий кабінет. Якщо це були не ви — напишіть нам.');
        }
      } catch (error) {
        console.error('Не удалось отправить уведомление о входе в кабинет:', error);
      }
    });

    const response = NextResponse.json({ success: true, phone: `+380${phone}` });
    response.cookies.set(CUSTOMER_SESSION_COOKIE, token, customerSessionCookieOptions(CUSTOMER_SESSION_TTL_SECONDS));
    // Старая cookie с телефоном (прежний "вход") больше нигде не читается — стираем
    response.cookies.set('customer_phone', '', { path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    console.error('Ошибка при проверке кода входа покупателя:', error);
    return NextResponse.json({ error: 'Сталася помилка, спробуйте пізніше' }, { status: 500 });
  }
}
