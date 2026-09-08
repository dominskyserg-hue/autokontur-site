// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/images  (галерея ДОДАТКОВИХ фото товару)
//
// products.image_url — і далі ГОЛОВНЕ фото товару (не чіпаємо тут).
// Ця таблиця — лише ДОДАТКОВІ фото для галереї на картці товару
// (components/ProductGallery.tsx), кожне зі своїм підписом (label),
// з якого збирається унікальний alt для фото (див. schema.sql,
// таблиця product_images).
//
//   GET  /api/products/[id]/images  — список додаткових фото товару
//                                      за порядком показу
//   POST /api/products/[id]/images  — додати ОДНЕ нове фото: тіло
//                                      { imageUrl, label? }. imageUrl —
//                                      звичайне http(s)-посилання АБО
//                                      data:-URI файлу, завантаженого
//                                      з комп'ютера в адмінці (тоді
//                                      перекодовуємо в WebP і заливаємо
//                                      у Vercel Blob — той самий підхід,
//                                      що і для головного фото, див.
//                                      app/api/products/[id]/route.ts)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { convertToWebp } from '@/lib/imageProcessing';
import { saveImage } from '@/lib/imageStorage';

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PostImageRequestBody {
  imageUrl: string;
  label?: string;
}

// ------------------------------------------------------------
// GET — список додаткових фото товару
// ------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT id, image_url, label, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at`,
      [id]
    );

    return NextResponse.json({
      success: true,
      images: result.rows.map((row) => ({
        id: row.id,
        imageUrl: row.image_url,
        label: row.label,
        sortOrder: row.sort_order,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении галереи фото товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить фото товара: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST — добавить одно фото в галерею
// ------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PostImageRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.imageUrl || !body.imageUrl.trim()) {
    return NextResponse.json({ error: 'Не передана ссылка на фото (поле imageUrl).' }, { status: 400 });
  }

  const productExists = await pool.query('SELECT 1 FROM products WHERE id = $1', [id]);
  if (productExists.rows.length === 0) {
    return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
  }

  // Файл, загруженный с компьютера в админке, приходит как data:-URI —
  // перекодируем в WebP и заливаем в Vercel Blob (та же логика, что и
  // для главного фото в app/api/products/[id]/route.ts), обычную
  // http(s)-ссылку не трогаем
  let resolvedImageUrl = body.imageUrl.trim();
  if (resolvedImageUrl.startsWith('data:')) {
    const match = resolvedImageUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: 'Не удалось распознать загруженное изображение.' }, { status: 400 });
    }
    try {
      const webp = await convertToWebp(Buffer.from(match[1], 'base64'));
      resolvedImageUrl = await saveImage(webp);
    } catch (error) {
      console.error('Ошибка при сохранении загруженного вручную фото галереи:', error);
      return NextResponse.json({ error: 'Не удалось сохранить загруженное изображение.' }, { status: 500 });
    }
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO product_images (product_id, image_url, label, sort_order)
      VALUES (
        $1, $2, $3,
        COALESCE((SELECT MAX(sort_order) + 1 FROM product_images WHERE product_id = $1), 0)
      )
      RETURNING id, image_url, label, sort_order
      `,
      [id, resolvedImageUrl, body.label?.trim() || null]
    );

    const row = result.rows[0];
    return NextResponse.json(
      {
        success: true,
        image: { id: row.id, imageUrl: row.image_url, label: row.label, sortOrder: row.sort_order },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при добавлении фото в галерею товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось добавить фото: ' + message }, { status: 500 });
  }
}
