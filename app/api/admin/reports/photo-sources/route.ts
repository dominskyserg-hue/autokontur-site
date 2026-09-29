// ============================================================
// GET /api/admin/reports/photo-sources — сколько товаров с фото по каждому
// источнику (products.image_source, schema.sql): прайс поставщика, Bing,
// загружено вручную. Моментальный срез, без периода — по нему видно, как
// фото из Bing постепенно заменяются фото поставщиков и ручными
// (правило замены — lib/imageStorage.ts, deleteReplacedImages).
// Блок "Фото товаров" на странице "Отчёты" (components/PhotoSourcesPanel.tsx)
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    // Только активные товары — те, что видны на сайте. manual_upload и
    // manual_url на экране показываются вместе как "вручную", но отдаются
    // и по отдельности
    const result = await pool.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS with_photo,
        count(*) FILTER (WHERE image_source = 'supplier_price')::int AS supplier_price,
        count(*) FILTER (WHERE image_source = 'bing')::int AS bing,
        count(*) FILTER (WHERE image_source = 'manual_upload')::int AS manual_upload,
        count(*) FILTER (WHERE image_source = 'manual_url')::int AS manual_url,
        count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> ''
                          AND (image_source IS NULL OR image_source = 'unknown'))::int AS unknown
      FROM products
      WHERE is_active
    `);
    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      total: row.total,
      withPhoto: row.with_photo,
      bySource: {
        supplierPrice: row.supplier_price,
        bing: row.bing,
        manualUpload: row.manual_upload,
        manualUrl: row.manual_url,
        unknown: row.unknown,
      },
    });
  } catch (error) {
    console.error('Ошибка подсчёта фото по источникам:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось посчитать фото: ' + message }, { status: 500 });
  }
}
