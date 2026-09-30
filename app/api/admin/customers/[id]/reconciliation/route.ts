// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/customers/[id]/reconciliation
//
// Акт сверки с клиентом за период (шаблон —
// lib/documents/reconciliationActTemplate.ts).
//
//   Параметры запроса:
//     from   — ГГГГ-ММ-ДД, начало периода (включительно)
//     to     — ГГГГ-ММ-ДД, конец периода (включительно)
//     format — "html" (по умолчанию): страница для печати в браузере
//              (Ctrl+P); "pdf": готовый PDF-файл на скачивание
//
// В акт попадают только операции, которые реально меняют баланс
// клиента (customer_transactions.affects_customer_balance = true) —
// ровно те, из которых складывается customers.balance. Дни считаются
// по киевскому времени, как и фильтр дат в списке заказов.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { getCompanyRequisites } from '@/lib/documents/companySettings';
import { renderReconciliationActHtml } from '@/lib/documents/reconciliationActTemplate';
import { renderHtmlToPdf } from '@/lib/documents/renderPdf';

export const runtime = 'nodejs';
// PDF рендерится headless-браузером — это дольше обычного ответа API
// (так же, как у остальных документов, см. documents/[docType]/download)
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id: customerId } = await context.params;
  if (!UUID_PATTERN.test(customerId)) {
    return NextResponse.json({ error: 'Некорректный id клиента.' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const dateFrom = (searchParams.get('from') || '').trim();
  const dateTo = (searchParams.get('to') || '').trim();
  const format = searchParams.get('format') === 'pdf' ? 'pdf' : 'html';

  if (!DATE_PATTERN.test(dateFrom) || !DATE_PATTERN.test(dateTo)) {
    return NextResponse.json({ error: 'Укажите период в формате ГГГГ-ММ-ДД (from и to).' }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: 'Дата начала периода позже даты конца.' }, { status: 400 });
  }

  try {
    const customerResult = await pool.query('SELECT name, surname, phone FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      return NextResponse.json({ error: 'Клиент не найден.' }, { status: 404 });
    }

    const [openingResult, rowsResult, company] = await Promise.all([
      // Сальдо на начало — сумма всех операций ДО первого дня периода
      pool.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS balance
        FROM customer_transactions
        WHERE customer_id = $1
          AND affects_customer_balance = true
          AND (created_at AT TIME ZONE 'Europe/Kyiv')::date < $2::date
        `,
        [customerId, dateFrom]
      ),
      pool.query(
        `
        SELECT ct.created_at, ct.type, ct.amount, ct.comment, o.order_number
        FROM customer_transactions ct
        LEFT JOIN orders o ON o.id = ct.order_id
        WHERE ct.customer_id = $1
          AND ct.affects_customer_balance = true
          AND (ct.created_at AT TIME ZONE 'Europe/Kyiv')::date BETWEEN $2::date AND $3::date
        ORDER BY ct.created_at ASC
        `,
        [customerId, dateFrom, dateTo]
      ),
      getCompanyRequisites(),
    ]);

    const html = renderReconciliationActHtml({
      company,
      customer: customerResult.rows[0],
      dateFrom,
      dateTo,
      // NUMERIC драйвер pg отдаёт строкой — переводим в число
      openingBalance: parseFloat(openingResult.rows[0].balance),
      rows: rowsResult.rows.map((row) => ({
        createdAt: row.created_at,
        type: row.type,
        amount: parseFloat(row.amount),
        orderNumber: row.order_number,
        comment: row.comment,
      })),
    });

    if (format === 'html') {
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const pdf = await renderHtmlToPdf(html);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="akt_zvirky_${dateFrom}_${dateTo}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Ошибка при формировании акта сверки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сформировать акт сверки: ' + message }, { status: 500 });
  }
}
