// ============================================================
// API Route: GET /api/cron/rebuild-dsa-feed
//
// Раз в сутки, после утренних автоимпортов прайсов (vercel.json), пересобирает
// фид страниц для динамической рекламы Google Ads — /feeds/dsa-pages.csv
// (lib/dsaPageFeed.ts). Вручную: npm run dsa-feed:rebuild
// Защита — только Authorization: Bearer CRON_SECRET
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { rebuildDsaFeed } from '@/lib/dsaPageFeed';

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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await rebuildDsaFeed(pool);
    console.log(`Фид DSA пересобран: ${result.total} строк, ${result.ms} мс`, result.byLabel);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Ошибка пересборки фида DSA:', error);
    return NextResponse.json({ error: 'Не удалось пересобрать фид DSA' }, { status: 500 });
  }
}
