// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/announcements
//
// Объявления на витрине (акции, предупреждения о графике и т.п.).
// В отличие от site_settings их может быть несколько — админ
// добавляет по одному и включает/выключает каждое отдельно.
//
//   GET  /api/announcements              — список ВСЕХ объявлений
//                                           (для экрана "Настройки")
//   GET  /api/announcements?activeOnly=1 — только активные
//                                           (для самой витрины)
//   POST /api/announcements              — создать новое объявление
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

interface AnnouncementResponse {
  id: string;
  text: string;
  isActive: boolean;
  createdAt: string;
}

// ------------------------------------------------------------
// GET /api/announcements
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const activeOnly = request.nextUrl.searchParams.get('activeOnly');

    const result = await pool.query(
      activeOnly
        ? 'SELECT id, text, is_active, created_at FROM announcements WHERE is_active = true ORDER BY created_at DESC'
        : 'SELECT id, text, is_active, created_at FROM announcements ORDER BY created_at DESC'
    );

    const announcements: AnnouncementResponse[] = result.rows.map((row) => ({
      id: row.id,
      text: row.text,
      isActive: row.is_active,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ success: true, announcements });
  } catch (error) {
    console.error('Ошибка при получении списка объявлений:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список объявлений: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// POST /api/announcements — создать новое объявление
// ------------------------------------------------------------
interface CreateAnnouncementBody {
  text?: string;
}

export async function POST(request: NextRequest) {
  let body: CreateAnnouncementBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  if (!body.text || !body.text.trim()) {
    return NextResponse.json(
      { error: 'Текст объявления обязателен.' },
      { status: 400 }
    );
  }

  try {
    // Новое объявление сразу активно (is_active по умолчанию true в
    // schema.sql) — админ создаёт его именно для того, чтобы оно
    // сразу появилось на витрине, а не лежало выключенным
    const result = await pool.query(
      'INSERT INTO announcements (text) VALUES ($1) RETURNING id, text, is_active, created_at',
      [body.text.trim()]
    );

    const row = result.rows[0];

    return NextResponse.json(
      {
        success: true,
        announcement: {
          id: row.id,
          text: row.text,
          isActive: row.is_active,
          createdAt: row.created_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при создании объявления:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось создать объявление: ' + message },
      { status: 500 }
    );
  }
}
