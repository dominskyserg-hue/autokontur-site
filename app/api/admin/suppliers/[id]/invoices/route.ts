// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/suppliers/[id]/invoices
//
// Запись приходной накладной от поставщика — ТОЛЬКО финансовая
// сторона (сумма, номер накладной), без построчного состава товаров.
// Это осознанное упрощение: сам остаток на складе (products.stock) в
// этом проекте обновляется автоматически при импорте прайс-листа
// поставщика (lib/priceListImport.ts, запускается по расписанию —
// см. app/api/cron/import-supplier-*), а не построчным приёмом
// накладной вручную. Эта форма нужна для ДРУГОГО — зафиксировать факт
// "нам привезли товар на сумму X, наш долг перед поставщиком вырос
// на эту сумму", когда сама накладная не сопровождается прайс-листом
// (например, разовая доставка под конкретный заказ).
//
// Вставляет ОДНОВРЕМЕННО supplier_invoices (сама накладная) и
// supplier_transactions с type='goods_received' — триггер
// trg_supplier_transactions_update_balance сам увеличит suppliers.balance
//
//   POST /api/admin/suppliers/[id]/invoices
//   Тело запроса: { invoiceNumber?: string, totalAmount: number, comment?: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CreateInvoiceRequestBody {
  invoiceNumber?: string;
  totalAmount?: number;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = await context.params;

  if (!UUID_PATTERN.test(supplierId)) {
    return NextResponse.json({ error: 'Некорректный id поставщика.' }, { status: 400 });
  }

  let body: CreateInvoiceRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!Number.isFinite(body.totalAmount) || (body.totalAmount as number) <= 0) {
    return NextResponse.json({ error: 'Сумма накладной должна быть положительным числом.' }, { status: 400 });
  }

  const invoiceNumber = (body.invoiceNumber || '').trim() || null;
  const comment = (body.comment || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplierCheck = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Поставщик не найден.' }, { status: 404 });
    }

    const invoiceResult = await client.query(
      `INSERT INTO supplier_invoices (supplier_id, invoice_number, total_amount, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, invoice_number, total_amount, comment, created_at`,
      [supplierId, invoiceNumber, body.totalAmount, comment]
    );
    const invoice = invoiceResult.rows[0];

    await client.query(
      `INSERT INTO supplier_transactions (supplier_id, amount, type, invoice_id, comment, created_by)
       VALUES ($1, $2, 'goods_received', $3, $4, 'admin')`,
      [supplierId, body.totalAmount, invoice.id, comment]
    );

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM suppliers WHERE id = $1', [supplierId]);

    return NextResponse.json(
      {
        success: true,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          totalAmount: parseFloat(invoice.total_amount),
          comment: invoice.comment,
          createdAt: invoice.created_at,
        },
        newBalance: parseFloat(balanceResult.rows[0].balance),
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при записи приходной накладной:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось записать накладную: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
