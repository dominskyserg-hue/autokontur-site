// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/url-import
//
//   POST — кнопка "Проверить ссылки сейчас" в панели администратора
//          (components/UrlImportPanel.tsx). Запускает ТУ ЖЕ самую
//          проверку, что и плановый cron
//          (app/api/cron/import-supplier-urls), но по нажатию кнопки.
//   GET  — последние записи журнала автозагрузки по URL
//          (url_import_log) для отображения в той же панели.
//
// Отдельного секрета не нужно — этот путь НЕ входит в белый список
// PUBLIC_API_ROUTES в middleware.ts, поэтому он и так уже защищён
// требованием админской cookie-сессии, как и /api/admin/email-import.
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { runUrlPriceImport } from '@/lib/urlPriceImport';
import { requireAdmin } from '@/lib/adminAuth';

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

// ------------------------------------------------------------
// POST — проверить ссылки прямо сейчас
// ------------------------------------------------------------
export async function POST() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const summary = await runUrlPriceImport(pool);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Ошибка ручной проверки ссылок на прайсы:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось проверить ссылки: ${message}` }, { status: 500 });
  }
}

// ------------------------------------------------------------
// GET — последние записи журнала для панели в админке
// ------------------------------------------------------------
const LOG_PAGE_SIZE = 30;

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const result = await pool.query(
      `
      SELECT id, supplier_id, supplier_name, price_url, status, added_count, updated_count, error_message, processed_at
      FROM url_import_log
      ORDER BY processed_at DESC
      LIMIT $1
      `,
      [LOG_PAGE_SIZE]
    );

    const entries = result.rows.map((row) => ({
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      priceUrl: row.price_url,
      status: row.status as 'imported' | 'error',
      addedCount: row.added_count,
      updatedCount: row.updated_count,
      errorMessage: row.error_message,
      processedAt: row.processed_at,
    }));

    return NextResponse.json({ success: true, entries });
  } catch (error) {
    console.error('Ошибка при получении журнала автозагрузки по URL:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось получить журнал: ${message}` }, { status: 500 });
  }
}
