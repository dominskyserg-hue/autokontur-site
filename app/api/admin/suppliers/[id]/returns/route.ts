// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/suppliers/[id]/returns
//
// Возврат товара поставщику (брак или невостребованное) — секция 28
// schema.sql. Одной транзакцией:
//   1. Находим товар по артикулу У ЭТОГО поставщика (себестоимость
//      берём из каталога, а не вводим вручную — тот же принцип
//      доверия каталогу, что и в приходной накладной)
//   2. supplier_returns + supplier_return_items
//   3. stock_movements (расход) + products.stock уменьшается
//   4. supplier_transactions с type='supplier_return', отрицательная
//      сумма — наш долг перед поставщиком УМЕНЬШАЕТСЯ (мы отдали товар
//      обратно, значит должны меньше)
//
//   POST /api/admin/suppliers/[id]/returns
//   Тело запроса: { article: string, quantity: number, reason: 'defect' | 'unclaimed', comment?: string }
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
const REASONS = ['defect', 'unclaimed'] as const;
type Reason = (typeof REASONS)[number];

interface CreateSupplierReturnRequestBody {
  article?: string;
  quantity?: number;
  reason?: string;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = await context.params;

  if (!UUID_PATTERN.test(supplierId)) {
    return NextResponse.json({ error: 'Некорректный id поставщика.' }, { status: 400 });
  }

  let body: CreateSupplierReturnRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const article = (body.article || '').trim();
  if (!article) {
    return NextResponse.json({ error: 'Укажите артикул товара.' }, { status: 400 });
  }
  if (!Number.isInteger(body.quantity) || (body.quantity as number) <= 0) {
    return NextResponse.json({ error: 'Количество должно быть целым числом больше нуля.' }, { status: 400 });
  }
  if (!body.reason || !REASONS.includes(body.reason as Reason)) {
    return NextResponse.json({ error: `Причина должна быть одной из: ${REASONS.join(', ')}.` }, { status: 400 });
  }

  const comment = (body.comment || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const supplierCheck = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supplierCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Поставщик не найден.' }, { status: 404 });
    }

    const productResult = await client.query(
      'SELECT id, cost_price, stock FROM products WHERE supplier_id = $1 AND article = $2',
      [supplierId, article]
    );
    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: `Товар с артикулом "${article}" у этого поставщика не найден.` }, { status: 404 });
    }
    const product = productResult.rows[0];

    if ((body.quantity as number) > product.stock) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `На складе только ${product.stock} шт. этого товара — нельзя вернуть больше.` },
        { status: 400 }
      );
    }

    const returnResult = await client.query(
      `INSERT INTO supplier_returns (supplier_id, reason, status, comment)
       VALUES ($1, $2, 'completed', $3)
       RETURNING id`,
      [supplierId, body.reason, comment]
    );
    const returnId = returnResult.rows[0].id;

    await client.query(
      `INSERT INTO supplier_return_items (return_id, product_id, article, quantity, cost_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [returnId, product.id, article, body.quantity, product.cost_price]
    );

    await client.query(
      `INSERT INTO stock_movements (product_id, quantity_change, reason, supplier_return_item_id)
       SELECT $1, $2, 'supplier_return', id FROM supplier_return_items WHERE return_id = $3`,
      [product.id, -(body.quantity as number), returnId]
    );

    await client.query('UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1', [
      product.id,
      body.quantity,
    ]);

    const returnAmount = parseFloat(product.cost_price) * (body.quantity as number);

    await client.query(
      `INSERT INTO supplier_transactions (supplier_id, amount, type, return_id, comment, created_by)
       VALUES ($1, $2, 'supplier_return', $3, $4, 'admin')`,
      [supplierId, -returnAmount, returnId, comment]
    );

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM suppliers WHERE id = $1', [supplierId]);

    return NextResponse.json(
      { success: true, returnId, returnAmount, newBalance: parseFloat(balanceResult.rows[0].balance) },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при оформлении возврата поставщику:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось оформить возврат: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
