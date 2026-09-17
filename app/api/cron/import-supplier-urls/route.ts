// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/cron/import-supplier-urls
//
// Вызывается по расписанию Vercel Cron (см. vercel.json) — проходит по
// всем поставщикам с заполненным price_url, скачивает Excel-прайс по
// ссылке и подхватывает его. Вся логика — в lib/urlPriceImport.ts,
// здесь только приём HTTP-запроса.
//
// Защита от постороннего вызова — секрет в заголовке Authorization,
// точно так же, как в app/api/cron/import-supplier-emails/route.ts.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { runUrlPriceImport } from '@/lib/urlPriceImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Скачивание нескольких файлов подряд (по одному на поставщика) может
// занять больше стандартных 10с — тот же лимит, что и у соседнего
// cron-роута import-supplier-emails
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
    const summary = await runUrlPriceImport(pool);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Ошибка автозагрузки прайсов по URL:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось проверить ссылки: ${message}` }, { status: 500 });
  }
}
