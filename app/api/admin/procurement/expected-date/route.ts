// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/procurement/expected-date
//
// Изменить ожидаемую дату поставки у уже заказанных у поставщика
// позиций (вкладка "Ожидают приёмки" на экране "Закупки"). Нужна,
// когда поставщик позвонил и перенёс срок — или дату забыли указать
// при заказе.
//
//   Тело запроса: { orderItemIds: string[], expectedDate: 'YYYY-MM-DD' | null }
//   null — убрать дату (опоздание больше не считается)
//
// Меняются только позиции в статусе 'ordered_from_supplier'.
// Колонка expected_at — см. lib/orderItemColumns.ts
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { ensureOrderItemProcurementColumns } from '@/lib/orderItemColumns';
import { logOrderEvent } from '@/lib/orderHistory';

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
// Дата в формате YYYY-MM-DD (так её отдаёт <input type="date">)
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface RequestBody {
  orderItemIds?: string[];
  expectedDate?: string | null;
}

// "2026-10-05" -> "05.10.2026" — для записи в историю заказа
function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

export async function POST(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const orderItemIds = body.orderItemIds;
  if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
    return NextResponse.json({ error: 'Не выбрано ни одной позиции.' }, { status: 400 });
  }
  if (orderItemIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'Некорректный id позиции заказа.' }, { status: 400 });
  }

  const expectedDate = body.expectedDate ? String(body.expectedDate) : null;
  if (expectedDate && (!DATE_PATTERN.test(expectedDate) || Number.isNaN(Date.parse(expectedDate)))) {
    return NextResponse.json({ error: 'Дата должна быть в формате ГГГГ-ММ-ДД.' }, { status: 400 });
  }

  try {
    await ensureOrderItemProcurementColumns();

    const result = await pool.query(
      `
      UPDATE order_items
      SET expected_at = $2::date
      WHERE id = ANY($1::uuid[]) AND status = 'ordered_from_supplier'
      RETURNING id, order_id, article
      `,
      [orderItemIds, expectedDate]
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Выбранные позиции уже не ждут приёмки — возможно, их уже приняли.' },
        { status: 400 }
      );
    }

    // Запись в историю каждого затронутого заказа (никогда не бросает ошибку)
    const articlesByOrder = new Map<string, string[]>();
    for (const row of result.rows) {
      const list = articlesByOrder.get(row.order_id) ?? [];
      list.push(row.article);
      articlesByOrder.set(row.order_id, list);
    }
    for (const [orderId, articles] of articlesByOrder) {
      await logOrderEvent(
        orderId,
        expectedDate
          ? `Очікувана дата поставки ${articles.join(', ')}: ${formatDate(expectedDate)}`
          : `Очікувану дату поставки ${articles.join(', ')} прибрано`
      );
    }

    return NextResponse.json({ success: true, updatedCount: result.rows.length });
  } catch (error) {
    console.error('Ошибка при изменении ожидаемой даты поставки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось изменить дату: ' + message }, { status: 500 });
  }
}
