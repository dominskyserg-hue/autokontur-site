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

// Аналог/OEM-номер із масового SEO-індексу TecDoc (scripts/tecdoc/,
// таблиця tecdoc_crosses) — НЕ те саме, що CrossRefItem вище
// (cross_reference_members — курована адміном модель, тут же —
// мільйони рядків з дампа TecDoc, без ручної перевірки кожного
// зв'язку, див. коментар у schema.sql біля CREATE TABLE tecdoc_crosses)
export interface TecdocCrossItem {
  brand: string;
  article: string;
  // Якщо ця пара бренд+артикул реально є в наявності серед НАШИХ
  // товарів — посилання на її картку (+ ціна/наявність цього
  // конкретного товару); якщо ні — обидва null, і рядок показується
  // просто текстом (саме це і дає SEO-текст під запити на кшталт
  // "OEM 0986424815 купити", навіть якщо такого товару прямо зараз
  // немає в каталозі)
  productPath: string | null;
  retailPrice: number | null;
  stock: number | null;
}

// Застосовність до авто з таблиці tecdoc_compatibility. makeSlug —
// null, якщо для цієї марки немає власної сторінки /marky/[slug]
// (курований список, lib/carMakes.ts) — тоді рядок теж просто текст,
// без посилання в нікуди
export interface TecdocCompatibilityItem {
  make: string;
  makeSlug: string | null;
  // Реальна назва моделі (напр. "AVENSIS Liftback (_T22_)") — TecDoc
  // зберігає її аж до конкретного кузова/шасі. Порожній рядок (не
  // null) для тих небагатьох рядків, де назву не вдалось розпізнати
  // (див. scripts/tecdoc/modelNames.ts) — тоді просто не показуємо її
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  // Об'єм двигуна цієї конкретної модифікації (напр. "1.6"), з
  // types.TYP_LITRES/TYP_CCM (див. scripts/tecdoc/import-dump.ts).
  // Порожній рядок, якщо TecDoc для цієї модифікації його не вказав
  engine: string;
}

const TECDOC_CROSSES_LIMIT = 30;
const TECDOC_COMPATIBILITY_LIMIT = 20;

// article — уже ОЧИЩЕНИЙ (products.article в базі і так зберігається
// очищеним, повторно чистити не треба — див. коментар біля products
// у schema.sql). tecdoc_crosses.article_a заповнений тією ж функцією
// cleanArticle() під час імпорту (scripts/tecdoc/cleanArticle.ts),
// тому пряме порівняння текстом коректне
const loadTecdocCrosses = cache(async function loadTecdocCrosses(article: string): Promise<TecdocCrossItem[]> {
  const result = await pool.query(
    `
    SELECT
      tc.brand_b,
      tc.article_b,
      p.id AS product_id,
      p.brand AS product_brand,
      p.article AS product_article,
      p.name AS product_name,
      p.retail_price,
      p.stock
    FROM (
      SELECT DISTINCT brand_b, article_b
      FROM tecdoc_crosses
      -- LENGTH(article_b) >= 3 — відсікає сміттєві "номери" з дампа
      -- на кшталт голого "0" чи "12" (53 420 таких рядків з довжиною
      -- 1 у всій таблиці на момент імпорту) — жоден справжній
      -- OEM/крос-номер настільки коротким не буває
      WHERE article_a = $1 AND article_b <> $1 AND LENGTH(article_b) >= 3
    ) tc
    LEFT JOIN LATERAL (
      SELECT id, brand, article, name, retail_price, stock
      FROM products p2
      WHERE p2.article = tc.article_b AND UPPER(p2.brand) = UPPER(tc.brand_b)
      ORDER BY (p2.stock > 0) DESC, p2.retail_price ASC
      LIMIT 1
    ) p ON true
    -- Спершу ті, що реально є в нашому каталозі (клікабельні,
    -- корисніші покупцю) — потім решта, просто текстом
    ORDER BY (p.id IS NOT NULL) DESC, tc.brand_b, tc.article_b
    LIMIT ${TECDOC_CROSSES_LIMIT}
    `,
    [article]
  );

  return result.rows.map((row) => ({
    brand: row.brand_b,
    article: row.article_b,
    productPath:
      row.product_id !== null
        ? buildProductPath(row.product_id, {
            brand: row.product_brand,
            article: row.product_article,
            name: row.product_name,
          })
        : null,
    retailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
    stock: row.stock,
  }));
});

const loadTecdocCompatibility = cache(async function loadTecdocCompatibility(
  article: string
): Promise<TecdocCompatibilityItem[]> {
  const result = await pool.query(
    `
    SELECT DISTINCT make, model, year_from, year_to, engine
    FROM tecdoc_compatibility
    WHERE article = $1
    ORDER BY make, year_from
    -- Ліміт вище за TECDOC_COMPATIBILITY_LIMIT: тепер, коли model
    -- теж бере участь у DISTINCT (кожен кузов/покоління — окремий
    -- рядок, а не один на марку+роки), у деталей з дуже широкою
    -- застосовністю перші рядки за алфавітом можуть цілком зайняти
    -- рідкісні марки — запас потрібен, щоб після сортування нижче
    -- (спершу марки з власною сторінкою) не загубились популярні
    LIMIT 300
    `,
    [article]
  );

  const items: TecdocCompatibilityItem[] = result.rows.map((row) => {
    const carMake = getCarMakeByDbValue(row.make);
    return {
      // Показуємо власну (гарно відформатовану) назву марки, якщо вона
      // є в курованому списку lib/carMakes.ts (напр. "MERCEDES-BENZ" з
      // TecDoc -> "Mercedes-Benz") — інакше сирий текст із TecDoc як є
      make: carMake?.name || row.make,
      makeSlug: carMake?.slug || null,
      model: row.model || '',
      yearFrom: row.year_from,
      yearTo: row.year_to,
      engine: row.engine || '',
    };
  });

  // Спершу марки з власною сторінкою /marky/[slug] (клікабельні) —
  // потім решта. Стабільність порядку всередині кожної групи не
  // критична (ORDER BY make, year_from у запиті вище вже дав розумний
  // базовий порядок)
  items.sort((a, b) => Number(b.makeSlug !== null) - Number(a.makeSlug !== null));

  return items.slice(0, TECDOC_COMPATIBILITY_LIMIT);
});

export interface ProductPageData {
  product: ProductDetail;
  otherOffers: OtherOffer[];
  crossRefs: { oem: CrossRefItem[]; aftermarket: CrossRefItem[] };
  tecdocCrosses: TecdocCrossItem[];
  tecdocCompatibility: TecdocCompatibilityItem[];
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

  const [otherOffers, crossRefs, tecdocCrosses, tecdocCompatibility] = await Promise.all([
    loadOtherOffers(product),
    loadCrossReferences(product),
    loadTecdocCrosses(product.article),
    loadTecdocCompatibility(product.article),
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

  return { product, otherOffers, crossRefs, tecdocCrosses, tecdocCompatibility, breadcrumbItems };
}
