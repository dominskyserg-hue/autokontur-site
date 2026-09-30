// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/warehouse/[productId]
//
//   GET  — история движения одного товара по складу (лента
//          stock_movements, новые сверху) + текущий остаток.
//          Отвечает на вопрос "куда делась деталь": видно каждую
//          продажу, приход, возврат и ручную операцию с номером заказа.
//
//   POST — ручная операция со складом:
//          {
//            quantityChange: number,   // + приход, − расход (не 0)
//            reason: 'adjustment' | 'defect_writeoff',
//            comment: string           // обязательно: ПОЧЕМУ
//          }
//          'adjustment'      — исправить остаток после пересчёта
//                              (можно и +, и −)
//          'defect_writeoff' — списать брак (только −)
//
// Остаток на складе = сумма stock_movements.quantity_change (см.
// app/api/admin/warehouse/route.ts). products.stock меняем тоже —
// так же, как это делают остальные складские роуты (приход, продажа,
// возврат), чтобы не было расхождения с их логикой.
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Сколько последних движений показывать в истории — у обычной
// детали их единицы, у ходовой за год могут быть сотни
const HISTORY_LIMIT = 200;

// ------------------------------------------------------------
// АВТОМИГРАЦИЯ: колонка stock_movements.comment
// ------------------------------------------------------------
// Колонка для причины ручной операции добавлена в конец schema.sql.
// Чтобы не нужно было отдельно заходить в базу и выполнять SQL руками,
// роут сам проверяет её наличие при первом обращении и, если её нет,
// добавляет. Сначала — лёгкая проверка через information_schema, и
// только если колонки нет — ALTER TABLE (он на мгновение блокирует
// таблицу, поэтому не запускаем его каждый раз "на всякий случай").
// Результат запоминаем в памяти, чтобы проверка шла один раз на запуск
// функции, а не на каждый запрос
let commentColumnReady: Promise<void> | null = null;

function ensureCommentColumn(): Promise<void> {
  if (!commentColumnReady) {
    commentColumnReady = (async () => {
      const check = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'stock_movements' AND column_name = 'comment'`
      );
      if (check.rows.length === 0) {
        await pool.query('ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS comment TEXT');
      }
    })().catch((error) => {
      // Не получилось — забываем результат, чтобы следующий запрос
      // попробовал ещё раз, а не упирался в одну и ту же ошибку вечно
      commentColumnReady = null;
      throw error;
    });
  }
  return commentColumnReady;
}

async function getBalance(productId: string): Promise<number> {
  const result = await pool.query(
    'SELECT COALESCE(SUM(quantity_change), 0)::int AS balance FROM stock_movements WHERE product_id = $1',
    [productId]
  );
  return result.rows[0].balance;
}

// ------------------------------------------------------------
// GET — история движения товара
// ------------------------------------------------------------
export async function GET(_request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { productId } = await context.params;
  if (!UUID_PATTERN.test(productId)) {
    return NextResponse.json({ error: 'Некорректный id товара.' }, { status: 400 });
  }

  try {
    await ensureCommentColumn();
    const productResult = await pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, s.name AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1
      `,
      [productId]
    );
    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    // Номер заказа находим по цепочке ссылок: у продажи и прихода под
    // заказ есть order_item_id, у возврата клиента — строка возврата,
    // которая тоже ведёт к позиции заказа
    const movementsResult = await pool.query(
      `
      SELECT
        sm.id,
        sm.quantity_change,
        sm.reason,
        sm.comment,
        sm.created_at,
        o.id AS order_id,
        o.order_number,
        si.invoice_number
      FROM stock_movements sm
      LEFT JOIN customer_return_items cri ON cri.id = sm.customer_return_item_id
      LEFT JOIN order_items oi ON oi.id = COALESCE(sm.order_item_id, cri.order_item_id)
      LEFT JOIN orders o ON o.id = oi.order_id
      LEFT JOIN supplier_invoice_items sii ON sii.id = sm.supplier_invoice_item_id
      LEFT JOIN supplier_invoices si ON si.id = sii.invoice_id
      WHERE sm.product_id = $1
      ORDER BY sm.created_at DESC
      LIMIT ${HISTORY_LIMIT}
      `,
      [productId]
    );

    const product = productResult.rows[0];

    return NextResponse.json({
      success: true,
      product: {
        productId: product.id,
        article: product.article,
        brand: product.brand,
        name: product.name,
        supplierName: product.supplier_name,
      },
      balance: await getBalance(productId),
      movements: movementsResult.rows.map((row) => ({
        id: row.id,
        quantityChange: row.quantity_change,
        reason: row.reason,
        comment: row.comment,
        createdAt: row.created_at,
        orderId: row.order_id,
        orderNumber: row.order_number,
        invoiceNumber: row.invoice_number,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении истории склада:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить историю товара: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST — ручная корректировка остатка или списание брака
// ------------------------------------------------------------
interface AdjustRequestBody {
  quantityChange?: number;
  reason?: string;
  comment?: string;
}

export async function POST(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { productId } = await context.params;
  if (!UUID_PATTERN.test(productId)) {
    return NextResponse.json({ error: 'Некорректный id товара.' }, { status: 400 });
  }

  let body: AdjustRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const quantityChange = body.quantityChange;
  const reason = body.reason;
  const comment = (body.comment || '').trim();

  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    return NextResponse.json({ error: 'Количество должно быть целым числом, не равным нулю.' }, { status: 400 });
  }
  if (reason !== 'adjustment' && reason !== 'defect_writeoff') {
    return NextResponse.json({ error: 'Неизвестный тип операции.' }, { status: 400 });
  }
  if (reason === 'defect_writeoff' && (quantityChange as number) > 0) {
    return NextResponse.json({ error: 'Списание брака может только уменьшать остаток.' }, { status: 400 });
  }
  if (!comment) {
    return NextResponse.json(
      { error: 'Напишите причину (например, «пересчёт 30.09» или «треснул корпус»).' },
      { status: 400 }
    );
  }

  try {
    await ensureCommentColumn();
  } catch (error) {
    console.error('Не удалось добавить колонку stock_movements.comment:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось подготовить таблицу склада: ' + message }, { status: 500 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE — блокируем строку товара до конца транзакции: если два
    // человека одновременно спишут одну и ту же деталь, второй подождёт
    // первого и увидит уже новый остаток, а не уйдёт в минус
    const productResult = await client.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [productId]);
    if (productResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Товар не найден.' }, { status: 404 });
    }

    const balanceResult = await client.query(
      'SELECT COALESCE(SUM(quantity_change), 0)::int AS balance FROM stock_movements WHERE product_id = $1',
      [productId]
    );
    const currentBalance: number = balanceResult.rows[0].balance;

    if (currentBalance + (quantityChange as number) < 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `На складе сейчас ${currentBalance} шт. — нельзя списать ${Math.abs(quantityChange as number)} шт.` },
        { status: 400 }
      );
    }

    await client.query(
      `
      INSERT INTO stock_movements (product_id, quantity_change, reason, comment)
      VALUES ($1, $2, $3, $4)
      `,
      [productId, quantityChange, reason, comment]
    );

    // GREATEST(0, ...) — products.stock не должен уходить в минус, даже
    // если прайс поставщика перед этим записал туда меньшее число
    await client.query('UPDATE products SET stock = GREATEST(0, stock + $2), updated_at = now() WHERE id = $1', [
      productId,
      quantityChange,
    ]);

    await client.query('COMMIT');

    return NextResponse.json({ success: true, balance: currentBalance + (quantityChange as number) }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при ручной операции со складом:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сохранить операцию: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
