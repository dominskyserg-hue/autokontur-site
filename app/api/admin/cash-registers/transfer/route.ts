// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/admin/cash-registers/transfer
//
// Перевод денег между двумя кассами/счетами (инкассация с кассы
// магазина в сейф, перевод с эквайринга на расчётный счёт и т.п.).
//
//   Тело запроса: { fromCashRegisterId, toCashRegisterId, amount, comment? }
//
// Одной транзакцией — два движения одной и той же суммы:
//   1. cash_movements для кассы-источника: amount = -amount,
//      type = 'transfer_out'
//   2. cash_movements для кассы-получателя: amount = +amount,
//      type = 'transfer_in'
// Оба триггером trg_cash_movements_update_balance пересчитывают свои
// балансы — сумма денег в системе в целом не меняется, просто
// перекладывается из одной кассы в другую.
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

interface TransferRequestBody {
  fromCashRegisterId?: string;
  toCashRegisterId?: string;
  amount?: number;
  comment?: string;
}

export async function POST(request: NextRequest) {
  let body: TransferRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.fromCashRegisterId || !UUID_PATTERN.test(body.fromCashRegisterId)) {
    return NextResponse.json({ error: 'Укажите корректную кассу-источник.' }, { status: 400 });
  }
  if (!body.toCashRegisterId || !UUID_PATTERN.test(body.toCashRegisterId)) {
    return NextResponse.json({ error: 'Укажите корректную кассу-получателя.' }, { status: 400 });
  }
  if (body.fromCashRegisterId === body.toCashRegisterId) {
    return NextResponse.json({ error: 'Касса-источник и касса-получатель не могут совпадать.' }, { status: 400 });
  }
  if (!Number.isFinite(body.amount) || (body.amount as number) <= 0) {
    return NextResponse.json({ error: 'Сумма перевода должна быть положительным числом.' }, { status: 400 });
  }

  const amount = body.amount as number;
  const comment = (body.comment || '').trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE — блокируем обе строки касс на время транзакции,
    // чтобы два одновременных перевода с одной и той же кассы не
    // смогли оба "увидеть" старый достаточный остаток и увести кассу
    // в минус (классическая гонка при проверке остатка без блокировки)
    const registersResult = await client.query(
      `SELECT id, name, balance, is_active FROM cash_registers WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[body.fromCashRegisterId, body.toCashRegisterId]]
    );

    const fromRegister = registersResult.rows.find((r) => r.id === body.fromCashRegisterId);
    const toRegister = registersResult.rows.find((r) => r.id === body.toCashRegisterId);

    if (!fromRegister) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса-источник не найдена.' }, { status: 404 });
    }
    if (!toRegister) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Касса-получатель не найдена.' }, { status: 404 });
    }
    if (!fromRegister.is_active || !toRegister.is_active) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Обе кассы должны быть активны.' }, { status: 400 });
    }

    if (parseFloat(fromRegister.balance) < amount) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Недостаточно средств в кассе «${fromRegister.name}»: остаток ${fromRegister.balance} грн, нужно ${amount} грн.` },
        { status: 400 }
      );
    }

    await client.query(
      `INSERT INTO cash_movements (cash_register_id, amount, type, comment, created_by) VALUES ($1, $2, 'transfer_out', $3, 'admin')`,
      [body.fromCashRegisterId, -amount, comment]
    );
    await client.query(
      `INSERT INTO cash_movements (cash_register_id, amount, type, comment, created_by) VALUES ($1, $2, 'transfer_in', $3, 'admin')`,
      [body.toCashRegisterId, amount, comment]
    );

    await client.query('COMMIT');

    const balancesResult = await pool.query('SELECT id, balance FROM cash_registers WHERE id = ANY($1::uuid[])', [
      [body.fromCashRegisterId, body.toCashRegisterId],
    ]);
    const balanceById = new Map(balancesResult.rows.map((r) => [r.id, parseFloat(r.balance)]));

    return NextResponse.json({
      success: true,
      newFromBalance: balanceById.get(body.fromCashRegisterId as string),
      newToBalance: balanceById.get(body.toCashRegisterId as string),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при переводе между кассами:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось выполнить перевод: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
