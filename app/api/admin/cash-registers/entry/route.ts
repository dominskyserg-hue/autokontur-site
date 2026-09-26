// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/cash-registers/entry
//
// Прочий доход/расход кассы, никак не связанный с конкретным клиентом
// или поставщиком — аренда, зарплата, логистика, взнос учредителя.
//
//   Тело запроса: { cashRegisterId, direction: 'income' | 'expense', amount, comment }
//   comment ОБЯЗАТЕЛЕН — в отличие от привязанных к заказу/поставщику
//   операций, у "прочего" расхода нет самоочевидного смысла, без
//   пояснения через месяц никто не вспомнит, что это была за выплата
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
const DIRECTIONS = ['income', 'expense'] as const;
type Direction = (typeof DIRECTIONS)[number];

interface EntryRequestBody {
  cashRegisterId?: string;
  direction?: string;
  amount?: number;
  comment?: string;
}

export async function POST(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  let body: EntryRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.cashRegisterId || !UUID_PATTERN.test(body.cashRegisterId)) {
    return NextResponse.json({ error: 'Укажите корректную кассу.' }, { status: 400 });
  }
  if (!body.direction || !DIRECTIONS.includes(body.direction as Direction)) {
    return NextResponse.json({ error: `direction должен быть одним из: ${DIRECTIONS.join(', ')}.` }, { status: 400 });
  }
  if (!Number.isFinite(body.amount) || (body.amount as number) <= 0) {
    return NextResponse.json({ error: 'Сумма должна быть положительным числом.' }, { status: 400 });
  }
  const comment = (body.comment || '').trim();
  if (!comment) {
    return NextResponse.json({ error: 'Укажите комментарий — на что расход или откуда доход.' }, { status: 400 });
  }

  const signedAmount = body.direction === 'expense' ? -(body.amount as number) : (body.amount as number);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const registerResult = await client.query('SELECT id, name, balance, is_active FROM cash_registers WHERE id = $1 FOR UPDATE', [
      body.cashRegisterId,
    ]);
    if (registerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса не найдена.' }, { status: 404 });
    }
    const register = registerResult.rows[0];
    if (!register.is_active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса деактивирована.' }, { status: 400 });
    }

    if (body.direction === 'expense' && parseFloat(register.balance) < (body.amount as number)) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Недостаточно средств в кассе «${register.name}»: остаток ${register.balance} грн, нужно ${body.amount} грн.` },
        { status: 400 }
      );
    }

    await client.query(
      `INSERT INTO cash_movements (cash_register_id, amount, type, comment, created_by) VALUES ($1, $2, $3, $4, 'admin')`,
      [body.cashRegisterId, signedAmount, body.direction, comment]
    );

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM cash_registers WHERE id = $1', [body.cashRegisterId]);

    return NextResponse.json({ success: true, newBalance: parseFloat(balanceResult.rows[0].balance) }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при записи прочего дохода/расхода кассы:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось записать операцию: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
