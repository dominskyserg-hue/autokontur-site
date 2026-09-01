// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/products/cross-references/conflicts/[id]
//
// Разрешение ОДНОГО конфликта кросс-номеров вручную администратором.
// Тело запроса: { "action": "merge" | "reject" }
//
//   "merge"  — администратор проверил и подтверждает: это ДЕЙСТВИТЕЛЬНО
//              одна и та же деталь. Обе группы (existing_group_a и
//              existing_group_b) объединяются в одну: все участники
//              группы B переезжают в группу A, группа B удаляется
//   "reject" — администратор считает связь ошибкой поставщика (опечатка
//              в номере, не тот аналог и т.п.) — группы остаются
//              раздельными, конфликт просто помечается отклонённым
//
// В обоих случаях запись в cross_reference_conflicts НЕ удаляется, а
// помечается status — так остаётся история, кто что решил и когда
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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface ResolveConflictBody {
  action?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id конфликта должен быть корректным UUID.' }, { status: 400 });
  }

  let body: ResolveConflictBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (body.action !== 'merge' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action должен быть "merge" или "reject".' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const conflictResult = await client.query(
      `SELECT id, existing_group_a, existing_group_b, status FROM cross_reference_conflicts WHERE id = $1`,
      [id]
    );

    if (conflictResult.rows.length === 0) {
      return NextResponse.json({ error: 'Конфликт с таким id не найден.' }, { status: 404 });
    }

    const conflict = conflictResult.rows[0];

    if (conflict.status !== 'pending') {
      return NextResponse.json(
        { error: 'Этот конфликт уже был решён ранее.' },
        { status: 409 }
      );
    }

    await client.query('BEGIN');

    if (body.action === 'merge') {
      // Переносим ВСЕХ участников группы B в группу A. UNIQUE
      // (brand, part_number) на cross_reference_members здесь не
      // мешает — конфликт по определению значит, что группы A и B
      // ЕЩЁ НЕ содержат общих (brand, part_number), иначе detected
      // как "already_linked", а не как конфликт
      await client.query(
        `UPDATE cross_reference_members SET group_id = $1 WHERE group_id = $2`,
        [conflict.existing_group_a, conflict.existing_group_b]
      );
      // Группа B теперь пуста — удаляем её (CASCADE тут уже нечего
      // каскадировать, участники уже переехали)
      await client.query(`DELETE FROM cross_reference_groups WHERE id = $1`, [conflict.existing_group_b]);

      await client.query(
        `UPDATE cross_reference_conflicts SET status = 'merged', resolved_at = now() WHERE id = $1`,
        [id]
      );
    } else {
      await client.query(
        `UPDATE cross_reference_conflicts SET status = 'rejected', resolved_at = now() WHERE id = $1`,
        [id]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true, status: body.action === 'merge' ? 'merged' : 'rejected' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при разрешении конфликта кроссов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось разрешить конфликт: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
