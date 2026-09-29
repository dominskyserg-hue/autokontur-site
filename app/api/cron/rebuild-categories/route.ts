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
// Заодно — ежедневная чистка служебных таблиц входа и rate limit
// (переехала сюда из отключённого cron fetch-product-images)
// Защита — только Authorization: Bearer CRON_SECRET
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';
import { Pool } from 'pg';
import { recomputeProductCategories } from '@/lib/categoryAssignment';
import { recomputeProductGroupsSafely } from '@/lib/productGroups';
import { cleanupAdminAuthTables } from '@/lib/adminAuth';
import { cleanupCustomerAuthTables } from '@/lib/customerAuth';
import { cleanupRateLimits } from '@/lib/rateLimit';

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

  // Ежедневная чистка служебных таблиц: входы в админку (истёкшие сессии,
  // попытки старше суток), кабинет покупателя (коды старше суток, истёкшие
  // сессии) и счётчики rate limit. Раньше жила в cron fetch-product-images —
  // он отключён (поиск фото через Bing не используем). Отдельный try —
  // сбой чистки не должен мешать пересчёту категорий
  try {
    const admin = await cleanupAdminAuthTables();
    const customer = await cleanupCustomerAuthTables();
    const limits = await cleanupRateLimits();
    console.log(
      `Чистка: admin_sessions ${admin.sessions}, admin_login_attempts ${admin.attempts}, ` +
        `customer_login_codes ${customer.codes}, customer_sessions ${customer.sessions}, rate_limits ${limits}`
    );
  } catch (error) {
    console.error('Ошибка при чистке служебных таблиц:', error);
  }

  try {
    // Группы бренд+артикул (lib/productGroups.ts) — сначала, категории зависят от них
    await recomputeProductGroupsSafely(pool);
    const result = await recomputeProductCategories(pool, { kind: 'updated_since_days', days: 2 });
    console.log(`Категории пересчитаны: товаров ${result.products}, назначений ${result.assignments}, ${result.ms} мс`);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Ошибка пересчёта категорий:', error);
    return NextResponse.json({ error: 'Не удалось пересчитать категории' }, { status: 500 });
  }
}
