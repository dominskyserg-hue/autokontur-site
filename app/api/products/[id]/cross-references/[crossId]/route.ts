// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/cross-references/[crossId]
//
// DELETE — удалить один кросс-номер товара насовсем. [id] — id
// самого товара, [crossId] — id строки в product_cross_references.
// Оба проверяются вместе (crossId должен принадлежать ИМЕННО этому
// товару) — так через подмену [id] в адресе нельзя удалить чужой
// кросс-номер, даже зная его id
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; crossId: string }> }
) {
  const { id, crossId } = await params;

  if (!isValidUuid(id) || !isValidUuid(crossId)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `DELETE FROM product_cross_references WHERE id = $1 AND product_id = $2 RETURNING id`,
      [crossId, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Кросс-номер с таким id у этого товара не найден.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении кросс-номера:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось удалить кросс-номер: ' + message },
      { status: 500 }
    );
  }
}
