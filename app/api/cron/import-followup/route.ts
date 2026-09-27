// ============================================================
// API Route: POST /api/cron/import-followup
//
// "Хвост" импорта прайса (lib/importFollowup.ts): категории товаров
// поставщика, индекс "марка авто → товары", словарь украинских слов.
// Импорт (lib/priceListImport.ts) вызывает этот адрес и не ждёт работы:
// роут сразу отвечает 202, а сама работа идёт в after() — в ЭТОМ вызове
// функции, со своим лимитом 60 с, отдельно от импорта.
// Защита — только Authorization: Bearer CRON_SECRET (middleware.ts, как у cron)
// ============================================================

import { after, NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { runImportFollowup } from '@/lib/importFollowup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { supplierId?: string; timingId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некоректний запит' }, { status: 400 });
  }
  const supplierId = body.supplierId ?? '';
  const timingId = body.timingId && UUID_RE.test(body.timingId) ? body.timingId : null;
  if (!UUID_RE.test(supplierId)) {
    return NextResponse.json({ error: 'Некоректний запит' }, { status: 400 });
  }

  after(() => runImportFollowup(pool, supplierId, timingId));
  return NextResponse.json({ accepted: true }, { status: 202 });
}
