// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/cron/fetch-product-images
//
// Це і є "фонова черга" з завдання: викликається НЕ покупцем і НЕ
// адміном вручну, а розкладом Vercel Cron (див. vercel.json в
// корені проєкту) — раз на певний інтервал бере невелику пачку
// товарів БЕЗ фото, шукає їм фото (lib/productImagePipeline.ts) і
// зберігає результат у базу. Покупець на сайті ніколи не чекає на
// пошук фото наживо — він або вже є в базі, або показується заглушка
// (див. components/ProductImage.tsx).
//
// Захист від публічного виклику: без правильного секрету в заголовку
// Authorization будь-хто в інтернеті міг би смикати цей ендпоінт і
// змушувати сервер бомбардувати Bing запитами — тому перевіряємо
// CRON_SECRET (Vercel Cron сам додає цей заголовок автоматично, якщо
// секрет заданий у змінних середовища проєкту, див. .env.example)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { processBatch, type ProductToProcess } from '@/lib/productImagePipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// За замовчуванням serverless-функція Vercel обривається за 10с
// (Hobby) — для пачки з кількома завантаженнями фото й затримками
// між ними цього замало. maxDuration піднімає ліміт (на Hobby можна
// до 60с, на Pro — більше; якщо ваш тариф не дозволяє стільки,
// зменшіть BATCH_SIZE нижче замість цього значення)
export const maxDuration = 60;

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: globalThis кешує Pool у межах ОДНОГО "теплого"
    // інстансу функції — але одразу після деплою Vercel піднімає
    // кілька свіжих інстансів одночасно, і кожен створює власний Pool
    // заново. Тому ліміт на один Pool лишаємо низьким: сумарний ліміт
    // Supabase-пулера (сесійний режим) — лише 15 з'єднань на весь
    // проєкт
    max: 3,
  });

globalThis.pgPool = pool;

// Скільки товарів обробляти за один виклик cron. Свідомо мало —
// разом із затримками між запитами (2-5с на товар, див.
// lib/productImagePipeline.ts) пачка з 8 товарів займає приблизно
// 8 × 3.5с ≈ 30с, з запасом укладається в maxDuration = 60с
const BATCH_SIZE = 8;

// Через скільки днів можна повторити спробу для товару, якому фото
// НЕ знайшли минулого разу — без цього один і той самий "провальний"
// товар намагався б обробитись щоразу заново на кожному тику cron
const RETRY_AFTER_DAYS = 7;

export async function GET(request: NextRequest) {
  // ---- перевірка секрету ----
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ---- вибірка товарів, яким потрібне фото ----
    // image_url IS NULL — фото ще не знайдено (ні вручну, ні
    // автоматично). image_search_attempted_at перевіряє, що ми не
    // намагались нещодавно й провалились — див. RETRY_AFTER_DAYS вище
    const result = await pool.query<ProductToProcess>(
      `
      SELECT id, article, brand, name
      FROM products
      WHERE image_url IS NULL
        AND (image_search_attempted_at IS NULL OR image_search_attempted_at < now() - $1::interval)
      ORDER BY updated_at DESC
      LIMIT $2
      `,
      [`${RETRY_AFTER_DAYS} days`, BATCH_SIZE]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: true, message: 'Немає товарів, яким потрібне фото.', processed: 0 });
    }

    const summary = await processBatch(pool, result.rows);

    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    console.error('Помилка фонового пошуку фото товарів:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: `Не вдалося обробити чергу: ${message}` }, { status: 500 });
  }
}
