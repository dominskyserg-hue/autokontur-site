// ============================================================
// API Route: GET /api/cron/rebuild-categories
//
// Ежедневная подстраховка: пересчёт категорий товаров, изменённых за
// последние 2 дня → таблица product_categories (lib/categoryAssignment.ts).
// После каждого импорта прайса категории и так пересчитываются для товаров
// этого поставщика — cron ловит случаи, когда фоновый пересчёт не успел.
// ПОЛНЫЙ пересчёт (40–60 секунд) сюда не ставим — не укладывается в
// maxDuration; его запускают вручную: npm run categories:rebuild — после
// изменения правил и после импорта данных TecDoc (узкие категории по авто)
// Защита — только Authorization: Bearer CRON_SECRET
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { recomputeProductCategories } from '@/lib/categoryAssignment';

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
    const result = await recomputeProductCategories(pool, { kind: 'updated_since_days', days: 2 });
    console.log(`Категории пересчитаны: товаров ${result.products}, назначений ${result.assignments}, ${result.ms} мс`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Ошибка пересчёта категорий:', error);
    return NextResponse.json({ error: 'Не удалось пересчитать категории' }, { status: 500 });
  }
}
