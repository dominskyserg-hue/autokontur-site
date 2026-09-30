// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/export?kind=...
//
// Выгрузка списков админки в Excel (.xlsx) — для бухгалтера или
// своего анализа. Кнопки "Скачать Excel" стоят на соответствующих
// экранах и передают сюда те же фильтры, что сейчас выбраны на экране
// — поэтому в файл попадает ровно то, что видно в списке (но целиком,
// без разбивки на страницы).
//
//   kind=orders   — заказы (components/OrdersScreen.tsx)
//                   фильтры: status, unpaid=1, search, dateFrom, dateTo
//   kind=debtors  — клиенты, которые должны нам (components/CustomersScreen.tsx)
//                   фильтр: search
//   kind=cash     — движения денег по кассам (components/TreasuryScreen.tsx)
//                   фильтры: registerId, type, dateFrom, dateTo
//
// Формулы сумм и оплат — те же, что в самих списках
// (app/api/orders/route.ts, app/api/admin/cash-registers/movements/route.ts),
// чтобы цифры в Excel совпадали с экраном.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import * as XLSX from 'xlsx';
import { requireAdmin } from '@/lib/adminAuth';
import { STATUS_LABELS, type OrderStatus } from '@/lib/orderUi';

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
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Страховка от слишком огромного файла: больше этого в Excel всё равно
// неудобно смотреть, а функция Vercel может не успеть его собрать
const MAX_ROWS = 20000;

// Названия операций касс — те же, что на экране "Кассы и счета"
const CASH_TYPE_LABELS: Record<string, string> = {
  customer_prepayment: 'Предоплата от клиента',
  customer_payment: 'Оплата заказа клиентом',
  customer_refund: 'Возврат денег клиенту',
  supplier_payment: 'Оплата поставщику',
  transfer_out: 'Перевод — списание',
  transfer_in: 'Перевод — зачисление',
  expense: 'Прочий расход',
  income: 'Прочий доход',
};

// Дата и время по-киевски в виде "30.09.2026 14:05" — понятно в Excel
function formatDateTimeKyiv(value: string | Date): string {
  return new Date(value).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Превращает массив строк-объектов в файл .xlsx. Ширину колонок
// подбираем по самому длинному значению — иначе в Excel всё слипается
function buildWorkbook(sheetName: string, rows: Record<string, string | number | null>[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  sheet['!cols'] = headers.map((header) => ({
    wch: Math.min(60, Math.max(header.length, ...rows.map((row) => String(row[header] ?? '').length)) + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ------------------------------------------------------------
// ЗАКАЗЫ
// ------------------------------------------------------------
async function exportOrders(params: URLSearchParams) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const status = (params.get('status') || '').trim();
  const search = (params.get('search') || '').trim();
  const dateFrom = (params.get('dateFrom') || '').trim();
  const dateTo = (params.get('dateTo') || '').trim();

  if (status) {
    if (!(status in STATUS_LABELS)) throw new RangeError('Неизвестный статус заказа.');
    values.push(status);
    conditions.push(`o.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(o.customer_name ILIKE $${values.length} OR o.customer_surname ILIKE $${values.length} OR o.customer_phone ILIKE $${values.length})`
    );
  }
  if (dateFrom) {
    if (!DATE_PATTERN.test(dateFrom)) throw new RangeError('Дата должна быть в формате ГГГГ-ММ-ДД.');
    values.push(dateFrom);
    conditions.push(`(o.created_at AT TIME ZONE 'Europe/Kyiv')::date >= $${values.length}::date`);
  }
  if (dateTo) {
    if (!DATE_PATTERN.test(dateTo)) throw new RangeError('Дата должна быть в формате ГГГГ-ММ-ДД.');
    values.push(dateTo);
    conditions.push(`(o.created_at AT TIME ZONE 'Europe/Kyiv')::date <= $${values.length}::date`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const unpaidOnly = params.get('unpaid') === '1';

  const result = await pool.query(
    `
    SELECT * FROM (
      SELECT
        o.order_number,
        o.created_at,
        o.customer_name,
        o.customer_surname,
        o.customer_phone,
        o.city,
        o.nova_poshta_address,
        o.ttn_number,
        o.status,
        COALESCE((SELECT SUM(oi.price * oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0) AS total_amount,
        COALESCE(
          (SELECT SUM(cm.amount) FROM cash_movements cm
           WHERE cm.order_id = o.id AND cm.type IN ('customer_payment', 'customer_prepayment', 'customer_refund')),
          0
        ) AS paid_amount
      FROM orders o
      ${whereSql}
    ) AS t
    ${unpaidOnly ? "WHERE status <> 'cancelled' AND paid_amount < total_amount" : ''}
    ORDER BY created_at DESC
    LIMIT ${MAX_ROWS}
    `,
    values
  );

  const rows = result.rows.map((row) => {
    const total = parseFloat(row.total_amount);
    const paid = parseFloat(row.paid_amount);
    return {
      '№ заказа': row.order_number,
      Дата: formatDateTimeKyiv(row.created_at),
      Клиент: `${row.customer_name} ${row.customer_surname || ''}`.trim(),
      Телефон: row.customer_phone,
      Доставка: row.city ? `${row.city}, ${row.nova_poshta_address}` : '',
      ТТН: row.ttn_number || '',
      Статус: STATUS_LABELS[row.status as OrderStatus] || row.status,
      'Сумма, грн': total,
      'Оплачено, грн': paid,
      'Осталось оплатить, грн': Math.max(0, Math.round((total - paid) * 100) / 100),
    };
  });

  return { rows, sheetName: 'Заказы', fileName: 'zakazy' };
}

// ------------------------------------------------------------
// ДОЛЖНИКИ
// ------------------------------------------------------------
async function exportDebtors(params: URLSearchParams) {
  const search = (params.get('search') || '').trim();
  const values: unknown[] = [];
  let searchSql = '';
  if (search) {
    values.push(`%${search}%`);
    searchSql = 'AND (c.phone ILIKE $1 OR c.name ILIKE $1 OR c.surname ILIKE $1)';
  }

  // Дата последней оплаты — полезно видеть, "как давно клиент не платил"
  const result = await pool.query(
    `
    SELECT
      c.name,
      c.surname,
      c.phone,
      c.email,
      c.balance,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id)::int AS order_count,
      (SELECT MAX(ct.created_at) FROM customer_transactions ct
       WHERE ct.customer_id = c.id AND ct.type IN ('prepayment', 'cash_payment')) AS last_payment_at
    FROM customers c
    WHERE c.balance > 0 ${searchSql}
    ORDER BY c.balance DESC
    LIMIT ${MAX_ROWS}
    `,
    values
  );

  const rows = result.rows.map((row) => ({
    Клиент: `${row.name} ${row.surname || ''}`.trim(),
    Телефон: row.phone,
    Email: row.email || '',
    'Долг, грн': parseFloat(row.balance),
    Заказов: row.order_count,
    'Последняя оплата': row.last_payment_at ? formatDateTimeKyiv(row.last_payment_at) : 'не было',
  }));

  return { rows, sheetName: 'Должники', fileName: 'dolzhniki' };
}

// ------------------------------------------------------------
// ДВИЖЕНИЯ ПО КАССАМ
// ------------------------------------------------------------
async function exportCash(params: URLSearchParams) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  const registerId = params.get('registerId');
  const type = params.get('type');
  const dateFrom = params.get('dateFrom');
  const dateTo = params.get('dateTo');

  if (registerId) {
    if (!UUID_PATTERN.test(registerId)) throw new RangeError('Некорректный id кассы.');
    values.push(registerId);
    conditions.push(`cm.cash_register_id = $${values.length}`);
  }
  if (type) {
    if (!(type in CASH_TYPE_LABELS)) throw new RangeError('Неизвестный тип операции.');
    values.push(type);
    conditions.push(`cm.type = $${values.length}`);
  }
  // Даты — так же, как в самой ленте движений на экране
  // (app/api/admin/cash-registers/movements/route.ts)
  if (dateFrom) {
    if (!DATE_PATTERN.test(dateFrom)) throw new RangeError('Дата должна быть в формате ГГГГ-ММ-ДД.');
    values.push(dateFrom);
    conditions.push(`cm.created_at >= $${values.length}::date`);
  }
  if (dateTo) {
    if (!DATE_PATTERN.test(dateTo)) throw new RangeError('Дата должна быть в формате ГГГГ-ММ-ДД.');
    values.push(dateTo);
    conditions.push(`cm.created_at < ($${values.length}::date + interval '1 day')`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `
    SELECT cm.created_at, cr.name AS register_name, cm.type, cm.amount, cm.comment, o.order_number
    FROM cash_movements cm
    JOIN cash_registers cr ON cr.id = cm.cash_register_id
    LEFT JOIN orders o ON o.id = cm.order_id
    ${whereSql}
    ORDER BY cm.created_at DESC
    LIMIT ${MAX_ROWS}
    `,
    values
  );

  const rows = result.rows.map((row) => {
    const amount = parseFloat(row.amount);
    return {
      Дата: formatDateTimeKyiv(row.created_at),
      Касса: row.register_name,
      Операция: CASH_TYPE_LABELS[row.type] || row.type,
      // Приход и расход — в разных колонках, так их удобно суммировать
      'Приход, грн': amount > 0 ? amount : null,
      'Расход, грн': amount < 0 ? -amount : null,
      Заказ: row.order_number ? `№${row.order_number}` : '',
      Комментарий: row.comment || '',
    };
  });

  return { rows, sheetName: 'Движения касс', fileName: 'kassy' };
}

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const params = request.nextUrl.searchParams;
  const kind = params.get('kind');

  try {
    let exported;
    if (kind === 'orders') exported = await exportOrders(params);
    else if (kind === 'debtors') exported = await exportDebtors(params);
    else if (kind === 'cash') exported = await exportCash(params);
    else return NextResponse.json({ error: 'kind должен быть orders, debtors или cash.' }, { status: 400 });

    // Пустой список — всё равно отдаём файл, но с одной строкой-пояснением,
    // чтобы Excel не открывал совсем пустой лист без заголовков
    const rows = exported.rows.length > 0 ? exported.rows : [{ Результат: 'По выбранным фильтрам ничего не найдено' }];
    const file = buildWorkbook(exported.sheetName, rows);

    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }); // ГГГГ-ММ-ДД
    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${exported.fileName}_${today}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    // RangeError — это наша же понятная ошибка проверки фильтров (400),
    // всё остальное — непредвиденный сбой (500)
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Ошибка при выгрузке в Excel:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сформировать файл: ' + message }, { status: 500 });
  }
}
