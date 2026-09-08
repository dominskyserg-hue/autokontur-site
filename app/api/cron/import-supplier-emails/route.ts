// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/cron/import-supplier-emails
//
// Вызывается по расписанию Vercel Cron (см. vercel.json) — проверяет
// почтовый ящик магазина, ищет свежие письма от заведённых поставщиков
// и подхватывает Excel-прайсы из вложений. Вся логика — в
// lib/emailPriceImport.ts, здесь только приём HTTP-запроса.
//
// Защита от постороннего вызова — секрет в заголовке Authorization,
// точно так же, как в app/api/cron/fetch-product-images/route.ts (см.
// подробный комментарий там и .env.example, переменная CRON_SECRET).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { runEmailPriceImport } from '@/lib/emailPriceImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// IMAP-подключение + скачивание нескольких писем с вложениями может
// занять больше стандартных 10с — поднимаем лимит, как и в соседнем
// cron-роуте fetch-product-images (см. подробности там)
export const maxDuration = 60;

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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runEmailPriceImport(pool);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Ошибка автозагрузки прайсов по email:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось проверить почту: ${message}` }, { status: 500 });
  }
}
