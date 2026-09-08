// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/images/[imageId]  (ОДНО фото галереї)
//
//   PATCH  — змінити підпис (label) фото — саме з нього збирається
//            унікальний alt для картинки, див. components/ProductGallery.tsx
//   DELETE — прибрати фото з галереї товару насовсім
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PatchImageRequestBody {
  label?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const { id, imageId } = await params;

  if (!isValidUuid(id) || !isValidUuid(imageId)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchImageRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (body.label === undefined) {
    return NextResponse.json({ error: 'Передайте поле label для изменения.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `
      UPDATE product_images
      SET label = $3
      WHERE id = $1 AND product_id = $2
      RETURNING id, image_url, label, sort_order
      `,
      [imageId, id, body.label.trim() || null]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Фото с таким id не найдено у этого товара.' }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      image: { id: row.id, imageUrl: row.image_url, label: row.label, sortOrder: row.sort_order },
    });
  } catch (error) {
    console.error('Ошибка при изменении подписи фото галереи:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сохранить подпись: ' + message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const { id, imageId } = await params;

  if (!isValidUuid(id) || !isValidUuid(imageId)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      'DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING id',
      [imageId, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Фото с таким id не найдено у этого товара.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении фото галереи:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось удалить фото: ' + message }, { status: 500 });
  }
}
