// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/rates
//
// Это НОВЫЙ роут — отвечает за ГЛОБАЛЬНЫЕ курсы валют (таблица
// global_exchange_rates из schema.sql). До этого курс валюты
// хранился в каждом поставщике отдельно (suppliers.exchange_rate) —
// теперь курс общий для всей валюты: один курс USD используется
// сразу для ВСЕХ поставщиков, у которых выбрана валюта USD.
//
//   GET  /api/rates  — получить список всех сохранённых курсов
//   POST /api/rates  — обновить один курс или сразу несколько.
//                       Тело запроса может быть:
//                         { currency: 'USD', rate: 95.5 }             — один курс
//                         [{ currency: 'USD', rate: 95.5 },
//                          { currency: 'EUR', rate: 101.2 }]          — сразу несколько
//                       Именно вторая форма используется виджетом
//                       "Глобальные курсы валют" в интерфейсе — там
//                       одна кнопка "Обновить" сохраняет курсы USD
//                       и EUR одним запросом.
//
// Курс каждой валюты используется дальше в
// app/api/suppliers/parse-excel/route.ts при разборе прайс-листа.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Этот блок специально написан ТОЧНО так же, как в
// app/api/suppliers/route.ts и app/api/suppliers/parse-excel/route.ts,
// и использует то же имя глобальной переменной (globalThis.pgPool) —
// поэтому все три файла работают с ОДНИМ И ТЕМ ЖЕ объектом Pool,
// а не создают три разных подключения к базе
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

// Один курс валюты в том виде, в котором фронтенд его присылает
interface RateInput {
  currency: string;
  rate: number;
}

// Один курс валюты в том виде, в котором мы отдаём его обратно
// на фронтенд
interface RateResponse {
  currency: string;
  rate: number;
  updatedAt: string;
}

// ------------------------------------------------------------
// ВАЛИДАЦИЯ
// ------------------------------------------------------------

// Код валюты — три латинские буквы (тот же формат, что и у
// suppliers.currency в app/api/suppliers/route.ts)
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

// Проверяет один элемент { currency, rate } и возвращает текст
// ошибки, либо null, если всё в порядке
function validateRateInput(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return 'Каждый курс должен быть объектом вида { currency, rate }';
  }

  const { currency, rate } = item as Record<string, unknown>;

  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency.trim())) {
    return 'Валюта должна быть кодом из 3 латинских букв, например USD или EUR';
  }

  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return 'Курс валюты должен быть положительным числом';
  }

  return null;
}

// Тело запроса POST может прийти и как один объект, и как массив
// объектов — эта функция всегда приводит его к массиву, чтобы
// дальше по коду обрабатывать оба случая одинаково
function normalizeRequestBody(body: unknown): RateInput[] {
  const items = Array.isArray(body) ? body : [body];

  return items.map((item) => {
    const { currency, rate } = item as { currency: string; rate: number };
    return { currency: currency.trim().toUpperCase(), rate };
  });
}

// ------------------------------------------------------------
// GET /api/rates — список всех сохранённых глобальных курсов
// ------------------------------------------------------------
export async function GET() {
  try {
    // ORDER BY currency — чтобы список на фронтенде не "прыгал"
    // между обновлениями страницы, а всегда шёл в одном порядке
    const result = await pool.query(
      'SELECT currency, rate, updated_at FROM global_exchange_rates ORDER BY currency'
    );

    const rates: RateResponse[] = result.rows.map((row) => ({
      currency: row.currency,
      // rate — колонка NUMERIC, драйвер pg возвращает такие значения
      // строкой (чтобы не терять точность при преобразовании в float),
      // поэтому здесь явно переводим её в обычное число
      rate: parseFloat(row.rate),
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, rates });
  } catch (error) {
    console.error('Ошибка при получении глобальных курсов валют:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить курсы валют: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// POST /api/rates — обновить один курс или сразу несколько
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  // Тело может быть одним объектом { currency, rate } или массивом
  // таких объектов — проверяем КАЖДЫЙ элемент до того, как начнём
  // что-либо записывать в базу, чтобы не получить ситуацию "курс
  // USD обновился, а курс EUR — нет, потому что была опечатка"
  const rawItems = Array.isArray(body) ? body : [body];
  if (rawItems.length === 0) {
    return NextResponse.json(
      { error: 'Не передано ни одного курса для обновления.' },
      { status: 400 }
    );
  }

  for (const item of rawItems) {
    const validationError = validateRateInput(item);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  const items = normalizeRequestBody(body);

  // Берём отдельное подключение из пула на всё время транзакции —
  // если курсов несколько (например, USD и EUR разом из виджета),
  // они должны обновиться либо все вместе, либо ни один: иначе при
  // сбое между двумя запросами можно получить наполовину обновлённые
  // курсы, а это как раз то, чего мы хотели избежать, сделав курсы
  // глобальными
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updatedRows = [];
    for (const item of items) {
      // ON CONFLICT (currency) DO UPDATE — то самое "обновить, если
      // уже есть, или создать, если ещё нет" (Upsert), про которое
      // и шла речь в задании. currency — PRIMARY KEY таблицы
      // global_exchange_rates, поэтому конфликт определяется по нему
      const result = await client.query(
        `
        INSERT INTO global_exchange_rates (currency, rate)
        VALUES ($1, $2)
        ON CONFLICT (currency)
        DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()
        RETURNING currency, rate, updated_at
        `,
        [item.currency, item.rate]
      );
      updatedRows.push(result.rows[0]);
    }

    await client.query('COMMIT');

    const rates: RateResponse[] = updatedRows.map((row) => ({
      currency: row.currency,
      rate: parseFloat(row.rate),
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, rates });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при обновлении курсов валют:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить курсы валют: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
