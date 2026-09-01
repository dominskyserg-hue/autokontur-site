// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: PATCH /api/vin-requests/[id]
//
// Сменить статус заявки "Підбір за VIN" — 'new' -> 'done', когда
// администратор связался с покупателем и подобрал деталь
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

const STATUS_VALUES = ['new', 'done'] as const;
type VinRequestStatus = (typeof STATUS_VALUES)[number];
function isValidStatus(value: string): value is VinRequestStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

interface PatchVinRequestBody {
  status?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id заявки должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchVinRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.status || !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: `Укажите статус — один из: ${STATUS_VALUES.join(', ')}.` },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `
      UPDATE vin_requests
      SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, vin_code, customer_phone, description, status, created_at, updated_at
      `,
      [id, body.status]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Заявка с таким id не найдена.' }, { status: 404 });
    }

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      vinRequest: {
        id: row.id,
        vinCode: row.vin_code,
        customerPhone: row.customer_phone,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении статуса заявки на подбор по VIN:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить статус заявки: ' + message },
      { status: 500 }
    );
  }
}
