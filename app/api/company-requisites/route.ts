// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/company-requisites
//
// Юридические реквизиты продавца (ФОП/ООО) для печатных документов
// заказа — хранятся в той же таблице-синглтоне site_settings, что и
// название магазина/телефон (app/api/site-settings/route.ts), в
// колонках, добавленных секцией 30.1 schema.sql.
//
//   GET   — текущие реквизиты
//   PATCH — изменить любое из полей (логотип и печать/подпись
//           загружаются отдельно, см. app/api/company-requisites/upload-asset/route.ts,
//           здесь принимаются уже готовые ссылки logoUrl/stampUrl)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

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

interface PatchRequisitesBody {
  legalName?: string | null;
  taxId?: string | null;
  iban?: string | null;
  bankName?: string | null;
  legalAddress?: string | null;
  warehouseAddress?: string | null;
  directorName?: string | null;
  logoUrl?: string | null;
  stampUrl?: string | null;
}

const FIELDS: Array<{ key: keyof PatchRequisitesBody; column: string }> = [
  { key: 'legalName', column: 'legal_name' },
  { key: 'taxId', column: 'tax_id' },
  { key: 'iban', column: 'iban' },
  { key: 'bankName', column: 'bank_name' },
  { key: 'legalAddress', column: 'legal_address' },
  { key: 'warehouseAddress', column: 'warehouse_address' },
  { key: 'directorName', column: 'director_name' },
  { key: 'logoUrl', column: 'logo_url' },
  { key: 'stampUrl', column: 'stamp_url' },
];

function rowToRequisites(row: Record<string, unknown>) {
  return {
    legalName: row.legal_name,
    taxId: row.tax_id,
    iban: row.iban,
    bankName: row.bank_name,
    legalAddress: row.legal_address,
    warehouseAddress: row.warehouse_address,
    directorName: row.director_name,
    logoUrl: row.logo_url,
    stampUrl: row.stamp_url,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const result = await pool.query(
      `SELECT legal_name, tax_id, iban, bank_name, legal_address, warehouse_address,
              director_name, logo_url, stamp_url, updated_at
       FROM site_settings WHERE id = 1`
    );

    const row = result.rows[0] || {};
    return NextResponse.json({ success: true, requisites: rowToRequisites(row) });
  } catch (error) {
    console.error('Ошибка при получении реквизитов компании:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить реквизиты компании: ' + message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  let body: PatchRequisitesBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const present = FIELDS.filter((field) => body[field.key] !== undefined);
  if (present.length === 0) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле реквизитов для изменения.' },
      { status: 400 }
    );
  }

  // Динамически собираем SET-часть запроса — полей много и все
  // необязательные, поэтому проще собрать плейсхолдеры по факту
  // переданных полей, чем перечислять все 9 колонок с COALESCE
  const setClauses = present.map((field, index) => `${field.column} = $${index + 1}`);
  const values = present.map((field) => {
    const value = body[field.key];
    return typeof value === 'string' ? value.trim() || null : value;
  });

  try {
    const result = await pool.query(
      `
      INSERT INTO site_settings (id, ${present.map((f) => f.column).join(', ')})
      VALUES (1, ${present.map((_, i) => `$${i + 1}`).join(', ')})
      ON CONFLICT (id) DO UPDATE SET ${setClauses.join(', ')}, updated_at = now()
      RETURNING legal_name, tax_id, iban, bank_name, legal_address, warehouse_address,
                director_name, logo_url, stamp_url, updated_at
      `,
      values
    );

    return NextResponse.json({ success: true, requisites: rowToRequisites(result.rows[0]) });
  } catch (error) {
    console.error('Ошибка при обновлении реквизитов компании:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось обновить реквизиты компании: ' + message }, { status: 500 });
  }
}
