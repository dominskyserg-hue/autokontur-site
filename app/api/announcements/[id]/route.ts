// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/announcements/[id]
//
//   PATCH  — изменить текст и/или включить/выключить объявление
//   DELETE — удалить объявление насовсем
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

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

globalThis.pgPool = pool;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PatchAnnouncementBody {
  text?: string;
  isActive?: boolean;
}

// Next.js 15: params у Route Handler — это Promise, поэтому его
// нужно сначала дождаться через await
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id объявления должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchAnnouncementBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const hasText = body.text !== undefined;
  const hasIsActive = body.isActive !== undefined;

  if (!hasText && !hasIsActive) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле для изменения: text или isActive.' },
      { status: 400 }
    );
  }

  if (hasText && !body.text?.trim()) {
    return NextResponse.json({ error: 'Текст объявления не может быть пустым.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `
      UPDATE announcements
      SET
        text = COALESCE($2, text),
        is_active = COALESCE($3, is_active)
      WHERE id = $1
      RETURNING id, text, is_active, created_at
      `,
      [id, hasText ? body.text!.trim() : null, hasIsActive ? body.isActive : null]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Объявление с таким id не найдено.' }, { status: 404 });
    }

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      announcement: {
        id: row.id,
        text: row.text,
        isActive: row.is_active,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении объявления:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить объявление: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// DELETE /api/announcements/[id]
// ------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id объявления должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query('DELETE FROM announcements WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Объявление с таким id не найдено.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении объявления:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось удалить объявление: ' + message },
      { status: 500 }
    );
  }
}
