// ============================================================
// Ночной полный пересчёт своей применимости product_vehicles_own
// (lib/ownVehicles.ts): марка и модель авто из бренда, названия,
// OEM-номеров в кроссах наших поставщиков и полей прайса. После импорта
// прайса пересчитываются только товары поставщика (lib/importFollowup.ts),
// а ночью — весь каталог: так подхватываются новые кроссы и правки
// словаря моделей. Пишется только разница, ~25 с на весь каталог.
// Ручной запуск: npm run own-vehicles:rebuild
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { rebuildOwnVehicles } from '@/lib/ownVehicles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

declare global {
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
    const result = await rebuildOwnVehicles(pool);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Ошибка пересчёта product_vehicles_own:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось пересчитать свою применимость: ' + message }, { status: 500 });
  }
}
