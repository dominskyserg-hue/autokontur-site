// ============================================================
// API Route для Next.js App Router. Адрес: /api/site-pages
//
// Контент трёх статичных информационных страниц (Про нас, Доставка,
// Контакти) — редактируется в админ-панели (экран "Настройки", см.
// components/SitePagesManager.tsx), показывается на публичных
// сторінках app/about, app/delivery, app/contacts (они читают базу
// НАПРЯМУЮ, серверним компонентом — так само, як app/category/[slug],
// без звернення до цього API; цей роут потрібен ТІЛЬКИ адмін-панелі).
//
//   GET   /api/site-pages         — отримати всі три сторінки
//   PATCH /api/site-pages         — оновити одну сторінку (за slug)
//
// Роут НЕ входить у PUBLIC_API_ROUTES у middleware.ts — тобто без
// авторизації адміна недоступний за замовчуванням (це саме те, що
// потрібно: редагувати контент може тільки адмін)
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

const VALID_SLUGS = ['about', 'delivery', 'contacts'] as const;
type PageSlug = (typeof VALID_SLUGS)[number];

function isValidSlug(value: unknown): value is PageSlug {
  return typeof value === 'string' && (VALID_SLUGS as readonly string[]).includes(value);
}

interface PatchSitePageBody {
  slug?: string;
  title?: string;
  content?: string;
}

// ------------------------------------------------------------
// GET /api/site-pages — усі три сторінки одразу (для екрана
// "Настройки" в адмінці — там усі три редагуються в одному місці)
// ------------------------------------------------------------
export async function GET() {
  try {
    const result = await pool.query(
      'SELECT slug, title, content, updated_at FROM site_pages ORDER BY slug'
    );

    return NextResponse.json({
      success: true,
      pages: result.rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        content: row.content,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении содержимого страниц:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить содержимое страниц: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// PATCH /api/site-pages — оновити title/content ОДНІЄЇ сторінки
// ------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  let body: PatchSitePageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  if (!isValidSlug(body.slug)) {
    return NextResponse.json(
      { error: `slug должен быть одним из: ${VALID_SLUGS.join(', ')}.` },
      { status: 400 }
    );
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return NextResponse.json({ error: 'Заголовок страницы не может быть пустым.' }, { status: 400 });
  }
  // content НАМЕРЕННО может быть пустой строкой — так страница
  // просто покажет заглушку "ще не заповнено" на витрине, это не
  // ошибка, а нормальное переходное состояние до заполнения
  const content = typeof body.content === 'string' ? body.content : '';

  try {
    const result = await pool.query(
      `
      UPDATE site_pages
      SET title = $2, content = $3, updated_at = now()
      WHERE slug = $1
      RETURNING slug, title, content, updated_at
      `,
      [body.slug, body.title.trim(), content]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Страница с таким slug не найдена.' }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      page: { slug: row.slug, title: row.title, content: row.content, updatedAt: row.updated_at },
    });
  } catch (error) {
    console.error('Ошибка при сохранении содержимого страницы:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось сохранить содержимое страницы: ' + message },
      { status: 500 }
    );
  }
}
