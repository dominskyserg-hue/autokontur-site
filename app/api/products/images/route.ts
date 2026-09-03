// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/images?ids=uuid1,uuid2,...
//
// Лёгкий "статус-чек" фото товаров — БЕЗ побочных эффектов: только
// читает текущее image_url из базы, ничего не запускает и не ставит
// в очередь (этим занимается GET /api/products, см. after() там же).
//
// Нужен для того, чтобы фото на витрине появлялось само, без
// повторного поиска: после того как GET /api/products поставил
// поиск фото в фон (components/StorefrontHome.tsx, runSearch), сама
// страница уже отрисована без фото — этот роут покупатель дёргает
// сам, с коротким интервалом, только по тем товарам, у которых
// фото ещё нет, пока оно не появится или не кончатся попытки.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Опрашивать больше десятка товаров разом смысла нет — на витрине
// это всегда товары ОДНОЙ страницы результатов пошуку (макс. 200,
// а на практике в разы менше), но обмежуємо явно, щоб через адресний
// рядок не попросили статус одразу на весь каталог
const MAX_IDS = 50;

export async function GET(request: NextRequest) {
  const idsParam = request.nextUrl.searchParams.get('ids') || '';
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Передайте хоча б один id у параметрі ids.' }, { status: 400 });
  }

  const invalid = ids.find((id) => !UUID_PATTERN.test(id));
  if (invalid) {
    return NextResponse.json({ error: `Некоректний id: ${invalid}` }, { status: 400 });
  }

  const limitedIds = ids.slice(0, MAX_IDS);

  try {
    const result = await pool.query('SELECT id, image_url FROM products WHERE id = ANY($1)', [limitedIds]);

    const images: Record<string, string | null> = {};
    for (const row of result.rows) {
      images[row.id] = row.image_url;
    }

    return NextResponse.json({ success: true, images });
  } catch (error) {
    console.error('Помилка при перевірці статусу фото товарів:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: `Не вдалося перевірити статус фото: ${message}` }, { status: 500 });
  }
}
