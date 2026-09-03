// ============================================================
// Дані для сторінки ОДНОГО товару — спільний код для двох місць
// рендеру одного й того самого товару:
//   1. app/p/[id]/[[...slug]]/page.tsx — повна сторінка (пряме
//      посилання, перезавантаження, боти Google)
//   2. app/@modal/(...)p/[id]/[[...slug]]/page.tsx — те саме, але у
//      модальному вікні поверх каталогу (клік по картці товару в
//      components/StorefrontHome.tsx та на сторінках категорій/марок)
//
// Обидва місця показують ОДНІ Й ТІ САМІ дані з бази — тому весь
// доступ до бази винесено сюди один раз, щоб не тримати дві копії
// SQL-запитів, які легко розсинхронізувати при майбутніх правках
// ============================================================

import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { Pool } from 'pg';
import { buildProductPath, buildProductSlug } from '@/lib/slug';
import { getCarMakeByDbValue } from '@/lib/carMakes';
import { SITE_URL } from '@/lib/siteConfig';
import type { BreadcrumbItem } from '@/lib/structuredData';

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

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ProductDetail {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  imageUrl: string | null;
  metaDescription: string | null;
  carMake: string | null;
  supplierName: string;
  deliveryTime: string | null;
  updatedAt: string;
}

// Той самий товар, знайдений в іншого постачальника (буквально той
// самий бренд + артикул) — саме тому, що article/brand+article НЕ
// унікальні (див. коментар в lib/slug.ts), у покупця цілком може бути
// вибір з кількох пропозицій на ту саму деталь
export interface OtherOffer {
  id: string;
  retailPrice: number;
  stock: number;
  supplierName: string;
}

export interface CrossRefItem {
  brand: string;
  partNumber: string;
  productId: string | null;
  retailPrice: number | null;
  stock: number | null;
}

export const loadProduct = cache(async function loadProduct(id: string): Promise<ProductDetail | null> {
  const result = await pool.query(
    `
    SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.stock, p.image_url,
           p.meta_description, p.car_make, p.updated_at,
           s.name AS supplier_name, s.delivery_time
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  return {
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    imageUrl: row.image_url,
    metaDescription: row.meta_description,
    carMake: row.car_make,
    supplierName: row.supplier_name,
    deliveryTime: row.delivery_time,
    updatedAt: row.updated_at,
  };
});

const loadOtherOffers = cache(async function loadOtherOffers(
  product: ProductDetail
): Promise<OtherOffer[]> {
  const result = await pool.query(
    `
    SELECT p2.id, p2.retail_price, p2.stock, s2.name AS supplier_name
    FROM products p2
    JOIN suppliers s2 ON s2.id = p2.supplier_id
    WHERE p2.article = $1
      AND ($2::text IS NULL OR p2.brand ILIKE $2)
      AND p2.id <> $3
    ORDER BY (p2.stock > 0) DESC, p2.retail_price ASC
    LIMIT 10
    `,
    [product.article, product.brand, product.id]
  );

  return result.rows.map((row) => ({
    id: row.id,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    supplierName: row.supplier_name,
  }));
});

// OEM/кросс-номери — та сама модель "груп взаємозамінності", що і в
// app/api/products/cross-lookup/route.ts (звідти й скопійована логіка
// вибірки, тут вона лише читає дані, без створення нових зв'язків)
const loadCrossReferences = cache(async function loadCrossReferences(
  product: ProductDetail
): Promise<{ oem: CrossRefItem[]; aftermarket: CrossRefItem[] }> {
  if (!product.brand) return { oem: [], aftermarket: [] };

  const groupsResult = await pool.query(
    `SELECT DISTINCT group_id FROM cross_reference_members WHERE part_number = $1 AND brand ILIKE $2`,
    [product.article, product.brand]
  );
  const groupIds = groupsResult.rows.map((row) => row.group_id as string);
  if (groupIds.length === 0) return { oem: [], aftermarket: [] };

  const membersResult = await pool.query(
    `
    SELECT m.brand, m.part_number, m.part_type, m.product_id, p3.retail_price, p3.stock
    FROM cross_reference_members m
    LEFT JOIN products p3 ON p3.id = m.product_id
    WHERE m.group_id = ANY($1::uuid[])
      AND NOT (m.part_number = $2 AND m.brand ILIKE $3)
    ORDER BY m.part_type, m.brand
    `,
    [groupIds, product.article, product.brand]
  );

  const oem: CrossRefItem[] = [];
  const aftermarket: CrossRefItem[] = [];
  const seen = new Set<string>();

  for (const row of membersResult.rows) {
    const key = `${row.brand}::${row.part_number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item: CrossRefItem = {
      brand: row.brand,
      partNumber: row.part_number,
      productId: row.product_id,
      retailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
      stock: row.stock,
    };

    if (row.part_type === 'oem') oem.push(item);
    else aftermarket.push(item);
  }

  return { oem, aftermarket };
});

export interface ProductPageData {
  product: ProductDetail;
  otherOffers: OtherOffer[];
  crossRefs: { oem: CrossRefItem[]; aftermarket: CrossRefItem[] };
  breadcrumbItems: BreadcrumbItem[];
}

// Повний набір даних для рендеру товару — і на повній сторінці, і в
// модальному вікні. Викликає notFound()/permanentRedirect() сама
// (це нормально для Next.js — обидві функції можна кликати з будь-якої
// async-функції, яку рендер-компонент дожидає через await, не лише
// прямо з тіла компонента сторінки)
export async function loadProductPageData(
  id: string,
  slugParts: string[] | undefined
): Promise<ProductPageData> {
  if (!UUID_PATTERN.test(id)) notFound();

  const product = await loadProduct(id);
  if (!product) notFound();

  // Канонічний слаг перевіряється і тут (не лише в generateMetadata) —
  // якщо адреса в браузері не збігається з ним, назавжди редиректимо
  // на правильну. Саме так у Google лишається ОДНА адреса на товар,
  // навіть якщо назву/бренд товару колись зміняли
  const canonicalSlug = buildProductSlug(product);
  const currentSlug = (slugParts || []).join('/');
  if (currentSlug !== canonicalSlug) {
    permanentRedirect(buildProductPath(id, product));
  }

  const [otherOffers, crossRefs] = await Promise.all([
    loadOtherOffers(product),
    loadCrossReferences(product),
  ]);

  const make = getCarMakeByDbValue(product.carMake);
  const breadcrumbItems: BreadcrumbItem[] = [
    { name: 'Головна', url: SITE_URL },
    ...(make ? [{ name: make.name, url: `${SITE_URL}/marky/${make.slug}` }] : []),
    {
      name: `${product.brand ? product.brand + ' ' : ''}${product.article}`,
      url: `${SITE_URL}${buildProductPath(id, product)}`,
    },
  ];

  return { product, otherOffers, crossRefs, breadcrumbItems };
}
