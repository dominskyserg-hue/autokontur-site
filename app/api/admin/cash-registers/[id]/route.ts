// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/cash-registers/[id]
//
//   PATCH /api/admin/cash-registers/[id]
//   Тело: { name?, isActive? } — переименование и/или
//   активация/деактивация кассы. Тип (cash/bank_account/card) и
//   баланс здесь намеренно не меняются: тип касс закреплён с
//   создания (переименование в "другой тип" кассы на самом деле
//   означает "заведите новую кассу"), а баланс — денормализация
//   поверх cash_movements и правится только через движения (см.
//   app/api/admin/cash-registers/entry, .../transfer)
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

interface PatchRequestBody {
  name?: string;
  isActive?: boolean;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Некорректный id кассы.' }, { status: 400 });
  }

  let body: PatchRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (body.name === undefined && body.isActive === undefined) {
    return NextResponse.json({ error: 'Укажите название и/или активность кассы для обновления.' }, { status: 400 });
  }

  const nextName = body.name !== undefined ? body.name.trim() : undefined;
  if (nextName !== undefined && !nextName) {
    return NextResponse.json({ error: 'Название кассы не может быть пустым.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `
      UPDATE cash_registers
      SET name = COALESCE($2, name), is_active = COALESCE($3, is_active), updated_at = now()
      WHERE id = $1
      RETURNING id, name, type, balance, is_active, created_at, updated_at
      `,
      [id, nextName ?? null, body.isActive ?? null]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Касса не найдена.' }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      register: {
        id: row.id,
        name: row.name,
        type: row.type,
        balance: parseFloat(row.balance),
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении кассы:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось обновить кассу: ' + message }, { status: 500 });
  }
}
