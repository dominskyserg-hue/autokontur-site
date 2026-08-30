// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]  (например /api/products/3fa85f64-...)
//
// PATCH — ручное редактирование ОДНОГО товара: розничная цена
// (retail_price) и/или остаток (stock). Именно так администратор
// вручную поправляет цену или остаток прямо в каталоге, без
// повторной загрузки всего прайс-листа поставщика.
//
// Тело запроса — JSON, оба поля необязательны, но хотя бы одно
// должно быть передано:
//   { "retailPrice": 1250.5 }
//   { "stock": 12 }
//   { "retailPrice": 1250.5, "stock": 12 }
//
// DELETE — удалить товар насовсем (используется на странице
// поставщика, components/SupplierProductsScreen.tsx, когда админ
// убирает позицию из каталога вручную — например, если поставщик
// снял деталь с продажи, а перезагружать весь прайс не нужно)
//
// [id] в имени папки — это "динамический сегмент" маршрута Next.js:
// значение из адреса (/api/products/ЗДЕСЬ) попадает в params.id
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

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface PatchProductRequestBody {
  retailPrice?: number;
  stock?: number;
  // Ручная правка SEO-описания карточки товара. Передана — значит
  // админ переписал текст на экране "Товары"; ставим
  // meta_description_override = true, чтобы следующая загрузка
  // прайса от поставщика больше не затирала эту правку автогенерацией
  // (см. app/api/suppliers/parse-excel/route.ts)
  metaDescription?: string;
  // Фото товара — ссылка (вставлена вручную или найдена через Google)
  // либо data:-URI с картинкой, загруженной файлом. Пустая строка —
  // это осознанное "убрать фото", а не "поле не менялось" (то, что
  // "не менялось" — это когда поля вообще нет в теле запроса)
  imageUrl?: string;
}

// Next.js 15: params у Route Handler — это Promise, а не обычный
// объект (изменение по сравнению с более ранними версиями Next.js),
// поэтому его нужно сначала дождаться через await
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchProductRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const hasRetailPrice = body.retailPrice !== undefined;
  const hasStock = body.stock !== undefined;
  const hasMetaDescription = body.metaDescription !== undefined;
  const hasImageUrl = body.imageUrl !== undefined;

  if (!hasRetailPrice && !hasStock && !hasMetaDescription && !hasImageUrl) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле для изменения: retailPrice, stock, metaDescription или imageUrl.' },
      { status: 400 }
    );
  }

  if (hasRetailPrice && (!Number.isFinite(body.retailPrice) || (body.retailPrice as number) < 0)) {
    return NextResponse.json(
      { error: 'Розничная цена должна быть числом не меньше нуля.' },
      { status: 400 }
    );
  }

  if (hasStock && (!Number.isInteger(body.stock) || (body.stock as number) < 0)) {
    return NextResponse.json(
      { error: 'Остаток должен быть целым числом не меньше нуля.' },
      { status: 400 }
    );
  }

  try {
    // COALESCE($2, retail_price) — если retailPrice не передали,
    // подставляем null, и колонка остаётся прежней. Так одним и тем
    // же запросом можно обновить и любую комбинацию полей разом.
    // meta_description_override взводится в true ТОЛЬКО когда реально
    // пришло metaDescription — так ручная правка запоминается навсегда,
    // а не просто на один запрос.
    //
    // image_url собран через CASE, а не COALESCE — потому что "убрать
    // фото" означает записать НАСТОЯЩИЙ NULL, а COALESCE(NULL, ...)
    // в этом случае просто оставил бы старое фото нетронутым. $6 —
    // явный флаг "поле imageUrl вообще передавали в этом запросе"
    const result = await pool.query(
      `
      UPDATE products
      SET
        retail_price = COALESCE($2, retail_price),
        stock = COALESCE($3, stock),
        meta_description = COALESCE($4, meta_description),
        meta_description_override = meta_description_override OR $5::boolean,
        image_url = CASE WHEN $6::boolean THEN $7 ELSE image_url END,
        updated_at = now()
      WHERE id = $1
      RETURNING id, article, brand, name, cost_price, retail_price, stock, supplier_id, meta_description, image_url, updated_at
      `,
      [
        id,
        hasRetailPrice ? body.retailPrice : null,
        hasStock ? body.stock : null,
        hasMetaDescription ? body.metaDescription : null,
        hasMetaDescription,
        hasImageUrl,
        hasImageUrl ? (body.imageUrl?.trim() ? body.imageUrl.trim() : null) : null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      product: {
        id: row.id,
        article: row.article,
        brand: row.brand,
        name: row.name,
        metaDescription: row.meta_description,
        imageUrl: row.image_url,
        // cost_price/retail_price — колонки NUMERIC, драйвер pg
        // возвращает такие значения строкой, явно переводим в число
        costPrice: parseFloat(row.cost_price),
        retailPrice: parseFloat(row.retail_price),
        stock: row.stock,
        supplierId: row.supplier_id,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить товар: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// DELETE /api/products/[id] — удалить товар насовсем
// ------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось удалить товар: ' + message },
      { status: 500 }
    );
  }
}
