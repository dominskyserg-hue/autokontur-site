// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/assign
//
// Кто ведёт заказ. Тело запроса: { managerId: string | null }
//   managerId = id вошедшего — "Взять в работу"
//   managerId = id другого    — "Передать менеджеру"
//   managerId = null          — "Снять с себя" (заказ снова ничей)
//
// Правила:
//   - Незанятый заказ любой менеджер может взять только на СЕБЯ.
//     Взятие атомарное (UPDATE ... WHERE assigned_manager_id IS NULL):
//     если двое нажали одновременно, второй получит 409, а не
//     перехватит заказ
//   - Передать другому или снять с себя может текущий ответственный
//     или владелец
//   - Назначить незанятый заказ другому человеку может только владелец
//   - Принимающий должен быть активным сотрудником
//
// Каждое действие пишется в историю заказа (lib/orderHistory.ts).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCurrentAdmin } from '@/lib/adminAuth';
import { ensureOrderAssignmentColumns } from '@/lib/orderAssignment';
import { logOrderEvent } from '@/lib/orderHistory';

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: { managerId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const targetId = body.managerId === null ? null : typeof body.managerId === 'string' ? body.managerId : undefined;
  if (targetId === undefined || (targetId !== null && !UUID_PATTERN.test(targetId))) {
    return NextResponse.json({ error: 'managerId должен быть UUID менеджера или null.' }, { status: 400 });
  }

  const isOwner = admin.role === 'owner';

  const client = await pool.connect();
  try {
    await ensureOrderAssignmentColumns();
    await client.query('BEGIN');

    // FOR UPDATE — на время проверки и записи никто другой не поменяет
    // ответственного этого заказа
    const orderResult = await client.query<{ order_number: number; assigned_manager_id: string | null; assigned_name: string | null }>(
      `
      SELECT o.order_number, o.assigned_manager_id, u.name AS assigned_name
      FROM orders o
      LEFT JOIN admin_users u ON u.id = o.assigned_manager_id
      WHERE o.id = $1
      FOR UPDATE OF o
      `,
      [id]
    );
    const order = orderResult.rows[0];
    if (!order) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }

    const currentId = order.assigned_manager_id;
    const isCurrentAssignee = currentId !== null && currentId === admin.id;

    if (currentId === targetId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Цей менеджер уже веде це замовлення.' }, { status: 409 });
    }

    // ---- права ----
    if (currentId === null) {
      // Заказ ничей: взять на себя может любой, назначить другого — владелец
      if (targetId !== admin.id && !isOwner) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Призначити замовлення іншому може лише власник.' }, { status: 403 });
      }
    } else if (!isCurrentAssignee && !isOwner) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Замовлення вже веде ${order.assigned_name || 'інший менеджер'}. Передати його може лише він або власник.` },
        { status: 409 }
      );
    }

    // ---- принимающий должен существовать и быть активным ----
    let targetName: string | null = null;
    if (targetId !== null) {
      const target = await client.query<{ name: string }>(
        'SELECT name FROM admin_users WHERE id = $1 AND is_active = true',
        [targetId]
      );
      if (target.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Менеджера не знайдено або його вимкнено.' }, { status: 400 });
      }
      targetName = target.rows[0].name;
    }

    await client.query('UPDATE orders SET assigned_manager_id = $2, assigned_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END WHERE id = $1', [
      id,
      targetId,
    ]);
    await client.query('COMMIT');

    // ---- история заказа ----
    let message: string;
    if (targetId === null) {
      message = `Знято замовлення з менеджера ${order.assigned_name || '—'}`;
    } else if (targetId === admin.id) {
      message = currentId
        ? `Забрано замовлення в роботу (раніше вів(ла) ${order.assigned_name || '—'})`
        : 'Взято замовлення в роботу';
    } else {
      message = `Замовлення передано менеджеру ${targetName}`;
    }
    await logOrderEvent(id, message);

    return NextResponse.json({
      success: true,
      assignedManager: targetId === null ? null : { id: targetId, name: targetName },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Ошибка при назначении менеджера на заказ:', error);
    return NextResponse.json({ error: 'Не вдалося змінити відповідального менеджера.' }, { status: 500 });
  } finally {
    client.release();
  }
}
