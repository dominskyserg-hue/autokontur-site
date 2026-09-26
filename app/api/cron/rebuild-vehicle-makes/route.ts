// ============================================================
// API Route: GET /api/cron/rebuild-vehicle-makes
//
// Щотижнева ПОВНА перебудова таблиці product_vehicle_makes ("марка авто ->
// товари" для пошуку, lib/vehicleMakeIndex.ts). Після кожного імпорту прайсу
// таблиця й так оновлюється для товарів цього постачальника — cron лише
// підстраховує (напр. після імпорту TecDoc чи ручних правок товарів).
// Захист — той самий CRON_SECRET, що й у решти /api/cron/* (middleware.ts)
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { rebuildAllVehicleMakes } from '@/lib/vehicleMakeIndex';

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
  // Своя проверка секрета (не только в middleware.ts): ТОЛЬКО
  // Authorization: Bearer CRON_SECRET, cookie админа не принимается
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await rebuildAllVehicleMakes(pool);
    return NextResponse.json({ success: true, rows });
  } catch (error) {
    console.error('Ошибка перестройки product_vehicle_makes:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось перестроить таблицу: ' + message }, { status: 500 });
  }
}
