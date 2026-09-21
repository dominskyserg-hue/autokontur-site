// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/cash-registers
//
// Кассы и расчётные счета (секция 29 schema.sql) — «где физически
// лежат деньги прямо сейчас», в отличие от customers.balance/
// suppliers.balance (секция 28), которые отвечают на вопрос «кто кому
// должен».
//
//   GET  /api/admin/cash-registers            — список всех касс
//        ?activeOnly=1                        — только активные
//                                                (для выпадающих
//                                                списков в формах
//                                                оплаты — закрытую
//                                                кассу выбрать нельзя)
//   POST /api/admin/cash-registers             — создать кассу
//        Тело: { name, type, openingBalance? }
//        openingBalance — необязательный начальный остаток: если
//        передан и не равен 0, сразу пишется в cash_movements
//        (type='income', comment='Начальный остаток') — баланс кассы
//        никогда не проставляется вручную, только через журнал
//        движений (тот же принцип, что и во всём финансовом модуле)
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

const REGISTER_TYPES = ['cash', 'bank_account', 'card'] as const;
type RegisterType = (typeof REGISTER_TYPES)[number];

interface CreateRegisterRequestBody {
  name?: string;
  type?: string;
  openingBalance?: number;
}

export async function GET(request: NextRequest) {
  const activeOnly = request.nextUrl.searchParams.get('activeOnly') === '1';

  try {
    const result = await pool.query(
      `
      SELECT id, name, type, balance, is_active, created_at, updated_at
      FROM cash_registers
      ${activeOnly ? 'WHERE is_active = true' : ''}
      ORDER BY is_active DESC, created_at ASC
      `
    );

    const registers = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      // NUMERIC из pg приходит строкой — явно переводим в число
      balance: parseFloat(row.balance),
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, registers });
  } catch (error) {
    console.error('Ошибка при получении списка касс:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список касс: ' + message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: CreateRegisterRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Укажите название кассы или счёта.' }, { status: 400 });
  }
  if (!body.type || !REGISTER_TYPES.includes(body.type as RegisterType)) {
    return NextResponse.json({ error: `Тип должен быть одним из: ${REGISTER_TYPES.join(', ')}.` }, { status: 400 });
  }

  const openingBalance = body.openingBalance;
  if (openingBalance !== undefined && !Number.isFinite(openingBalance)) {
    return NextResponse.json({ error: 'Начальный остаток должен быть числом.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO cash_registers (name, type) VALUES ($1, $2) RETURNING id, name, type, balance, is_active, created_at, updated_at`,
      [name, body.type]
    );
    const register = insertResult.rows[0];

    if (openingBalance) {
      await client.query(
        `INSERT INTO cash_movements (cash_register_id, amount, type, comment, created_by) VALUES ($1, $2, 'income', 'Начальный остаток', 'admin')`,
        [register.id, openingBalance]
      );
    }

    await client.query('COMMIT');

    const balanceResult = await pool.query('SELECT balance FROM cash_registers WHERE id = $1', [register.id]);

    return NextResponse.json(
      {
        success: true,
        register: {
          id: register.id,
          name: register.name,
          type: register.type,
          balance: parseFloat(balanceResult.rows[0].balance),
          isActive: register.is_active,
          createdAt: register.created_at,
          updatedAt: register.updated_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при создании кассы:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось создать кассу: ' + message }, { status: 500 });
  } finally {
    client.release();
  }
}
