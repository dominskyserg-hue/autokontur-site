// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/products/offers?article=...&brand=...
//
// Все предложения одного артикула у ВСЕХ поставщиков — для окна
// заказа (components/OrderDetailsModal.tsx): при редактировании
// позиции менеджер видит, у кого ещё есть эта деталь, по какой цене
// закупки, по какой цене в прайсе и сколько на складе, и одним
// нажатием подставляет нужного поставщика и цену.
//
//   article — артикул позиции (чистим так же, как при загрузке прайса:
//             верхний регистр, без пробелов, дефисов и знаков)
//   brand   — необязательно: предложения с тем же брендом показываем
//             первыми (один и тот же артикул бывает у разных
//             производителей — это разные детали)
//
//   Ответ: { success, offers: [{ productId, supplierId, supplierName,
//            brand, name, costPrice, retailPrice, stock }] }
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAdmin } from '@/lib/adminAuth';

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

// Больше предложений по одному артикулу почти не бывает, а длинный
// список в окне заказа всё равно неудобно смотреть
const MAX_OFFERS = 30;

// Та же очистка артикула, что и при разборе прайса поставщика
// (cleanArticle в app/api/suppliers/parse-excel/route.ts) — иначе
// "0 986-452 041" из заказа не совпал бы с "0986452041" в каталоге
function cleanArticle(value: string): string {
  return value
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// Бренд сравниваем без регистра, пробелов и знаков: "Hyundai/Kia" и
// "HYUNDAI KIA" — один и тот же бренд
function normalizeBrand(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9А-ЯЁІЇЄҐ]/g, '');
}

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const article = cleanArticle(request.nextUrl.searchParams.get('article') || '');
  const brand = normalizeBrand(request.nextUrl.searchParams.get('brand') || '');

  if (!article) {
    return NextResponse.json({ error: 'Не указан артикул.' }, { status: 400 });
  }

  try {
    // Сортировка: сначала тот же бренд, потом то, что есть в наличии,
    // потом самое дешёвое по закупке
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.supplier_id,
        s.name AS supplier_name,
        p.brand,
        p.name,
        p.cost_price,
        p.retail_price,
        p.stock
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.article = $1
      ORDER BY
        (regexp_replace(upper(COALESCE(p.brand, '')), '[^A-Z0-9А-ЯЁІЇЄҐ]', '', 'g') = $2) DESC,
        (p.stock > 0) DESC,
        p.cost_price ASC
      LIMIT ${MAX_OFFERS}
      `,
      [article, brand]
    );

    return NextResponse.json({
      success: true,
      offers: result.rows.map((row) => ({
        productId: row.id,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        brand: row.brand,
        name: row.name,
        // NUMERIC драйвер pg отдаёт строкой — переводим в число
        costPrice: parseFloat(row.cost_price),
        retailPrice: parseFloat(row.retail_price),
        stock: row.stock,
        sameBrand: brand ? normalizeBrand(row.brand || '') === brand : false,
      })),
    });
  } catch (error) {
    console.error('Ошибка при поиске предложений поставщиков:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить предложения: ' + message }, { status: 500 });
  }
}
