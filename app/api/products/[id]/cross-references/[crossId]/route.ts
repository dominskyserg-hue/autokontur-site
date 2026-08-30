// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/cross-references/[crossId]
//
// DELETE — убрать одну деталь из группы взаимозаменяемости товара
// [id]. [crossId] — id строки в cross_reference_members (ДРУГОГО
// участника той же группы, не самого товара).
//
// Если после удаления в группе остаётся 0 или 1 участник — группа
// теряет смысл (кросс — это связь МЕЖДУ детьми, в одиночку "группа"
// не нужна), поэтому она удаляется целиком вместе с последним
// оставшимся участником. Так у товара, для которого удалили
// единственный кросс-номер, список кросс-номеров снова становится
// пустым, а не "группой из одного себя самого"
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

  const client = await pool.connect();
  try {
    // Группа ТОВАРА [id] — удалять разрешено только участника ИМЕННО
    // этой группы, даже если кто-то подставит в адрес чужой crossId
    const myMemberResult = await client.query(
      `SELECT group_id FROM cross_reference_members WHERE product_id = $1`,
      [id]
    );
    if (myMemberResult.rows.length === 0) {
      return NextResponse.json({ error: 'У этого товара нет группы кросс-номеров.' }, { status: 404 });
    }
    const groupId = myMemberResult.rows[0].group_id;

    await client.query('BEGIN');

    const deleteResult = await client.query(
      `DELETE FROM cross_reference_members WHERE id = $1 AND group_id = $2 RETURNING id`,
      [crossId, groupId]
    );

    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Кросс-номер с таким id не найден в группе этого товара.' },
        { status: 404 }
      );
    }

    // Сколько участников осталось в группе (в том числе сам товар)
    const remainingResult = await client.query(
      `SELECT COUNT(*) FROM cross_reference_members WHERE group_id = $1`,
      [groupId]
    );
    const remainingCount = parseInt(remainingResult.rows[0].count, 10);

    // 1 (или 0) участник — группа больше не связывает никого ни с кем,
    // удаляем её целиком (ON DELETE CASCADE заберёт и последнего
    // участника вместе с ней)
    if (remainingCount <= 1) {
      await client.query(`DELETE FROM cross_reference_groups WHERE id = $1`, [groupId]);
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при удалении кросс-номера:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось удалить кросс-номер: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
