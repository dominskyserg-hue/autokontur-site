// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/email-import
//
//   POST — кнопка "Проверить почту сейчас" в панели администратора
//          (components/EmailImportPanel.tsx). Запускает ТУ ЖЕ самую
//          проверку почты, что и плановый cron
//          (app/api/cron/import-supplier-emails), но по нажатию
//          кнопки, а не по расписанию — например, чтобы сразу увидеть
//          результат после того, как поставщик прислал прайс.
//   GET  — последние записи журнала автозагрузки (email_import_log)
//          для отображения в той же панели: кто прислал прайс, что
//          подхватилось, а что не удалось сопоставить или разобрать.
//
// Отдельного секрета не нужно: этот путь НЕ входит в белый список
// PUBLIC_API_ROUTES в middleware.ts, поэтому он и так уже защищён
// требованием админской cookie-сессии — как и все прочие
// административные роуты (/api/suppliers и т.п.)
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { runEmailPriceImport } from '@/lib/emailPriceImport';

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
// POST — проверить почту прямо сейчас
// ------------------------------------------------------------
export async function POST() {
  try {
    const summary = await runEmailPriceImport(pool);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Ошибка ручной проверки почты:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось проверить почту: ${message}` }, { status: 500 });
  }
}

// ------------------------------------------------------------
// GET — последние записи журнала для панели в админке
// ------------------------------------------------------------
const LOG_PAGE_SIZE = 30;

export async function GET() {
  try {
    const result = await pool.query(
      `
      SELECT
        message_id, supplier_id, supplier_name, from_address, subject,
        status, added_count, updated_count, error_message, received_at, processed_at
      FROM email_import_log
      ORDER BY processed_at DESC
      LIMIT $1
      `,
      [LOG_PAGE_SIZE]
    );

    const entries = result.rows.map((row) => ({
      messageId: row.message_id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      fromAddress: row.from_address,
      subject: row.subject,
      status: row.status as 'imported' | 'error' | 'unmatched' | 'skipped',
      addedCount: row.added_count,
      updatedCount: row.updated_count,
      errorMessage: row.error_message,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
    }));

    return NextResponse.json({ success: true, entries });
  } catch (error) {
    console.error('Ошибка при получении журнала автозагрузки почты:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: `Не удалось получить журнал: ${message}` }, { status: 500 });
  }
}
