// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/orders/[id]/stock-availability
//
// Для позиций заказа, которые ещё не заказаны у поставщика (статус
// 'pending'), — есть ли такая деталь свободной на НАШЕМ складе
// (lib/warehouseStock.ts). Окно заказа показывает у такой позиции
// "У нас на складі: N шт" и кнопку "Взяти зі складу".
//
//   Ответ: { success, availability: { [orderItemId]: [{ productId,
//            supplierName, brand, available, costPrice }] } }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';
import { getWarehouseAvailability, type WarehouseAvailability } from '@/lib/warehouseStock';

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

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const itemsResult = await pool.query(
      `SELECT id, article FROM order_items WHERE order_id = $1 AND status = 'pending'`,
      [id]
    );
    const articles = Array.from(new Set(itemsResult.rows.map((row) => row.article as string)));
    const stock = await getWarehouseAvailability(pool, articles);

    // Раскладываем найденное по позициям заказа (по артикулу)
    const availability: Record<string, WarehouseAvailability[]> = {};
    for (const item of itemsResult.rows) {
      const matches = stock.filter((s) => s.article === item.article);
      if (matches.length > 0) availability[item.id] = matches;
    }

    return NextResponse.json({ success: true, availability });
  } catch (error) {
    console.error('Ошибка при проверке остатков склада для заказа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось проверить склад: ' + message }, { status: 500 });
  }
}
