// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/customer/favorites
//
// "Обране" — товари, які покупець позначив у особистому кабінеті.
//
//   GET  /api/customer/favorites?phone=+380501234567  — список обраних
//        товарів разом з АКТУАЛЬНОЮ ціною/наявністю (не "знімком" на
//        момент додавання — покупець має бачити правдиву поточну ціну,
//        з урахуванням його персональної знижки/наценки, якщо вона є)
//   POST /api/customer/favorites  { phone, productId }  — додати
//
// computeCustomerPrice рахує ціну від cost_price ("голої" ціни
// постачальника), а не від retail_price — той самий принцип, що і на
// картці товару/у пошуку (lib/customerPricing.ts) — щоб персональна
// знижка/наценка не накручувалась ще й поверх звичайної націнки
// магазину. cost_price сюди НЕ повертається — лише вже готова ціна
// (той самий "explicit field list", що і в lib/productDetail.ts)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { normalizePhone } from '@/lib/phoneNormalize';
import { getCustomerPricingRule, computeCustomerPrice } from '@/lib/customerPricing';

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

const MIN_PHONE_DIGITS = 9;

function isValidPhone(rawPhone: string): boolean {
  return rawPhone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface FavoriteItem {
  favoriteId: string;
  productId: string;
  article: string;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  retailPrice: number;
  stock: number;
  createdAt: string;
}

// ------------------------------------------------------------
// GET /api/customer/favorites?phone=...
// ------------------------------------------------------------
export async function GET(request: NextRequest) {
  const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();

  if (!rawPhone || !isValidPhone(rawPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  const phoneTail = normalizePhone(rawPhone);

  try {
    const [favoritesResult, pricingRule] = await Promise.all([
      pool.query(
        `
        SELECT f.id AS favorite_id, f.created_at, p.id AS product_id, p.article, p.brand, p.name,
               p.image_url, p.cost_price, p.retail_price, p.stock
        FROM customer_favorites f
        JOIN products p ON p.id = f.product_id
        WHERE RIGHT(regexp_replace(f.phone, '\\D', '', 'g'), 9) = $1
        ORDER BY f.created_at DESC
        `,
        [phoneTail]
      ),
      getCustomerPricingRule(pool, rawPhone),
    ]);

    const favorites: FavoriteItem[] = favoritesResult.rows.map((row) => ({
      favoriteId: row.favorite_id,
      productId: row.product_id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      imageUrl: row.image_url,
      retailPrice: computeCustomerPrice(parseFloat(row.cost_price), parseFloat(row.retail_price), pricingRule),
      stock: row.stock,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ success: true, favorites });
  } catch (error) {
    console.error('Ошибка при получении избранного клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося отримати обране: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/customer/favorites — додати товар в обране
// ------------------------------------------------------------
interface AddFavoriteBody {
  phone?: string;
  productId?: string;
}

export async function POST(request: NextRequest) {
  let body: AddFavoriteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON.' }, { status: 400 });
  }

  const phone = (body.phone || '').trim();
  const productId = (body.productId || '').trim();

  if (!phone || !isValidPhone(phone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }
  if (!productId || !isValidUuid(productId)) {
    return NextResponse.json({ error: 'Некоректний ідентифікатор товару.' }, { status: 400 });
  }

  try {
    // ON CONFLICT (phone, product_id) DO NOTHING — повторне додавання
    // того самого товару в обране просто нічого не змінює, а не падає
    // помилкою "унікальність порушена"
    const result = await pool.query(
      `
      INSERT INTO customer_favorites (phone, product_id)
      SELECT $1, $2
      WHERE EXISTS (SELECT 1 FROM products WHERE id = $2)
      ON CONFLICT (phone, product_id) DO NOTHING
      RETURNING id
      `,
      [phone, productId]
    );

    if (result.rows.length === 0) {
      // Або товару не існує, або він вже був у обраному раніше —
      // в обох випадках з точки зору покупця результат однаковий:
      // товар зараз є (або мав би бути) у списку обраного
      const existsResult = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (existsResult.rows.length === 0) {
        return NextResponse.json({ error: 'Товар не знайдено.' }, { status: 404 });
      }
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при добавлении товара в избранное:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося додати товар в обране: ' + message }, { status: 500 });
  }
}
