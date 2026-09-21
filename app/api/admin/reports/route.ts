// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/reports
//
// Три финансовых отчёта разом (секция 28 schema.sql):
//   1. P&L — валовая выручка/себестоимость/прибыль за период, с
//      поправкой на возвраты за тот же период
//   2. Дебиторка/кредиторка — МОМЕНТАЛЬНЫЙ срез (не за период): сколько
//      клиенты должны нам и сколько мы должны поставщикам ПРЯМО СЕЙЧАС
//   3. Cash Flow — фактическое движение денег за период
//
// Важный нюанс по Cash Flow: знак amount в customer_transactions
// показывает эффект на ДОЛГ клиента (- уменьшает долг), а не
// направление денег — prepayment/cash_payment (деньги ПРИШЛИ) и
// return_refund (деньги УШЛИ обратно клиенту) оба хранятся с
// отрицательным amount, но это противоположные по факту денежные
// потоки. Поэтому направление здесь определяется по type, а не по
// знаку amount.
//
//   GET /api/admin/reports?from=YYYY-MM-DD&to=YYYY-MM-DD
//   По умолчанию — последние 30 дней, если from/to не переданы
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fromParam = params.get('from');
  const toParam = params.get('to');

  if (fromParam && !DATE_PATTERN.test(fromParam)) {
    return NextResponse.json({ error: 'Параметр from должен быть в формате YYYY-MM-DD.' }, { status: 400 });
  }
  if (toParam && !DATE_PATTERN.test(toParam)) {
    return NextResponse.json({ error: 'Параметр to должен быть в формате YYYY-MM-DD.' }, { status: 400 });
  }

  // По умолчанию — последние 30 дней (включая сегодня)
  const to = toParam || new Date().toISOString().slice(0, 10);
  const from = fromParam || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // Конец дня "to" — чтобы весь день to тоже попал в диапазон (иначе
  // BETWEEN с "to 00:00:00" отрезал бы текущий день)
  const toEndOfDay = `${to} 23:59:59`;

  try {
    // ---------------- P&L ----------------
    const pnlResult = await pool.query(
      `
      SELECT
        COALESCE(SUM(oi.price * oi.quantity), 0) AS gross_revenue,
        COALESCE(SUM(oi.cost_price * oi.quantity), 0) AS cogs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'shipped' AND o.shipped_at BETWEEN $1 AND $2
      `,
      [from, toEndOfDay]
    );

    const returnsResult = await pool.query(
      `
      SELECT
        COALESCE(SUM(oi.price * cri.quantity), 0) AS returned_revenue,
        COALESCE(SUM(oi.cost_price * cri.quantity), 0) AS returned_cogs
      FROM customer_return_items cri
      JOIN order_items oi ON oi.id = cri.order_item_id
      JOIN customer_returns cr ON cr.id = cri.return_id
      WHERE cr.status = 'completed' AND cr.created_at BETWEEN $1 AND $2
      `,
      [from, toEndOfDay]
    );

    const grossRevenue = parseFloat(pnlResult.rows[0].gross_revenue);
    const cogs = parseFloat(pnlResult.rows[0].cogs);
    const grossProfit = grossRevenue - cogs;
    const returnedRevenue = parseFloat(returnsResult.rows[0].returned_revenue);
    const returnedCogs = parseFloat(returnsResult.rows[0].returned_cogs);
    const netProfit = grossProfit - (returnedRevenue - returnedCogs);

    // ---------------- Дебиторка / кредиторка (моментальный срез) ----------------
    const receivableResult = await pool.query(`SELECT COALESCE(SUM(balance), 0) AS total FROM customers WHERE balance > 0`);
    const payableResult = await pool.query(`SELECT COALESCE(SUM(balance), 0) AS total FROM suppliers WHERE balance > 0`);

    const topDebtorsResult = await pool.query(
      `SELECT id, name, surname, phone, balance FROM customers WHERE balance > 0 ORDER BY balance DESC LIMIT 10`
    );
    const topCreditorsResult = await pool.query(
      `SELECT id, name, balance FROM suppliers WHERE balance > 0 ORDER BY balance DESC LIMIT 10`
    );

    // ---------------- Cash Flow (за период) ----------------
    const cashInResult = await pool.query(
      `SELECT COALESCE(SUM(-amount), 0) AS total FROM customer_transactions
       WHERE type IN ('prepayment', 'cash_payment') AND created_at BETWEEN $1 AND $2`,
      [from, toEndOfDay]
    );
    const cashOutToCustomersResult = await pool.query(
      `SELECT COALESCE(SUM(-amount), 0) AS total FROM customer_transactions
       WHERE type = 'return_refund' AND created_at BETWEEN $1 AND $2`,
      [from, toEndOfDay]
    );
    const cashOutToSuppliersResult = await pool.query(
      `SELECT COALESCE(SUM(-amount), 0) AS total FROM supplier_transactions
       WHERE type = 'payment_out' AND created_at BETWEEN $1 AND $2`,
      [from, toEndOfDay]
    );

    const cashIn = parseFloat(cashInResult.rows[0].total);
    const cashOutToCustomers = parseFloat(cashOutToCustomersResult.rows[0].total);
    const cashOutToSuppliers = parseFloat(cashOutToSuppliersResult.rows[0].total);

    return NextResponse.json({
      success: true,
      period: { from, to },
      pnl: {
        grossRevenue,
        cogs,
        grossProfit,
        returnedRevenue,
        returnedCogs,
        netProfit,
      },
      receivablesPayables: {
        totalReceivable: parseFloat(receivableResult.rows[0].total),
        totalPayable: parseFloat(payableResult.rows[0].total),
        topDebtors: topDebtorsResult.rows.map((r) => ({
          id: r.id,
          name: r.name,
          surname: r.surname,
          phone: r.phone,
          balance: parseFloat(r.balance),
        })),
        topCreditors: topCreditorsResult.rows.map((r) => ({
          id: r.id,
          name: r.name,
          balance: parseFloat(r.balance),
        })),
      },
      cashFlow: {
        cashIn,
        cashOutToCustomers,
        cashOutToSuppliers,
        netCashFlow: cashIn - cashOutToCustomers - cashOutToSuppliers,
      },
    });
  } catch (error) {
    console.error('Ошибка при формировании финансовых отчётов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сформировать отчёты: ' + message }, { status: 500 });
  }
}
