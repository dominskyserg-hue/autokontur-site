// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/products/cross-lookup
//
// Точечный поиск ОДНОЙ детали с полной раскладкой аналогов по
// категориям — то, что в задании названо "Exact Match / Original
// Equivalents (OEM) / Aftermarket Alternatives". В отличие от обычного
// поиска (GET /api/products?search=...), который просто ВКЛЮЧАЕТ товар
// в общую выдачу, если у него есть подходящий кросс-номер, этот роут
// даёт СТРУКТУРИРОВАННЫЙ ответ под карточку конкретной детали: "вот
// точное совпадение, а вот чем его можно заменить — отдельно
// оригинальные (OEM) номера, отдельно неоригинальные аналоги".
//
//   GET /api/products/cross-lookup?article=0986424815&brand=Bosch
//
//   article — обязателен, ищется через ту же нормализацию, что и
//             обычный артикул (cleanArticle)
//   brand   — необязателен, но если передан, уточняет, какую именно
//             деталь имеет в виду покупатель (один и тот же числовой
//             номер у разных брендов — это, вообще говоря, РАЗНЫЕ
//             детали, входящие в разные группы взаимозаменяемости)
//
// Логика:
//   1. "Exact Match" — товары из НАШЕГО каталога, у которых артикул
//      (и бренд, если он передан) совпадает буквально
//   2. Если искомая пара (бренд, номер) состоит в какой-то группе
//      взаимозаменяемости — берём ВСЕХ ОСТАЛЬНЫХ участников этой
//      группы, у кого есть привязанный товар в наличии на складе
//      (stock > 0), и раскладываем их по part_type:
//        'oem'         -> oemEquivalents
//        'aftermarket' -> aftermarketAlternatives
//      Участники без привязанного товара (просто "известный номер",
//      которого никогда не было в наличии) в выдачу не попадают —
//      требование явно про то, что ДОСТУПНО НА СКЛАДЕ
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

function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

interface ProductSummary {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  retailPrice: number;
  stock: number;
  supplierId: string;
  supplierName: string;
}

const PRODUCT_SUMMARY_SELECT = `
  p.id, p.article, p.brand, p.name, p.image_url, p.retail_price, p.stock, p.supplier_id, s.name AS supplier_name
`;

function mapProductRow(row: Record<string, unknown>): ProductSummary {
  return {
    id: row.id as string,
    article: row.article as string,
    brand: row.brand as string | null,
    name: row.name as string | null,
    imageUrl: row.image_url as string | null,
    retailPrice: parseFloat(row.retail_price as string),
    stock: row.stock as number,
    supplierId: row.supplier_id as string,
    supplierName: row.supplier_name as string,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const rawArticle = (searchParams.get('article') || '').trim();
    const brand = (searchParams.get('brand') || '').trim();

    if (!rawArticle) {
      return NextResponse.json({ error: 'Параметр article обязателен.' }, { status: 400 });
    }

    const article = cleanArticle(rawArticle);

    // ---- 1. Exact Match — буквальное совпадение в нашем каталоге ----
    const exactValues: unknown[] = [article];
    let exactWhere = `p.article = $1`;
    if (brand) {
      exactValues.push(brand);
      exactWhere += ` AND p.brand ILIKE $2`;
    }

    const exactResult = await pool.query(
      `SELECT ${PRODUCT_SUMMARY_SELECT} FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${exactWhere}`,
      exactValues
    );
    const exactMatch = exactResult.rows.map(mapProductRow);

    // ---- 2. Найти группу(ы) взаимозаменяемости для искомой детали ----
    // Без указанного бренда номер мог принадлежать НЕСКОЛЬКИМ разным
    // деталям разных производителей — берём все подходящие группы;
    // с указанным брендом (brand, part_number) уникальны, группа
    // максимум одна
    const memberValues: unknown[] = [article];
    let memberWhere = `part_number = $1`;
    if (brand) {
      memberValues.push(brand);
      memberWhere += ` AND brand ILIKE $2`;
    }

    const selfMembersResult = await pool.query(
      `SELECT DISTINCT group_id FROM cross_reference_members WHERE ${memberWhere}`,
      memberValues
    );
    const groupIds = selfMembersResult.rows.map((row) => row.group_id as string);

    let oemEquivalents: ProductSummary[] = [];
    let aftermarketAlternatives: ProductSummary[] = [];

    if (groupIds.length > 0) {
      // Все ОСТАЛЬНЫЕ участники этих групп (кроме самой искомой пары
      // бренд+номер), у которых есть привязанный товар в наличии
      const othersResult = await pool.query(
        `
        SELECT ${PRODUCT_SUMMARY_SELECT}, m.part_type
        FROM cross_reference_members m
        JOIN products p ON p.id = m.product_id
        JOIN suppliers s ON s.id = p.supplier_id
        WHERE m.group_id = ANY($1::uuid[])
          AND NOT (m.part_number = $2 ${brand ? 'AND m.brand ILIKE $3' : ''})
          AND p.stock > 0
        `,
        brand ? [groupIds, article, brand] : [groupIds, article]
      );

      for (const row of othersResult.rows) {
        const product = mapProductRow(row);
        if (row.part_type === 'oem') {
          oemEquivalents.push(product);
        } else {
          aftermarketAlternatives.push(product);
        }
      }

      // На случай если один и тот же товар оказался участником
      // нескольких найденных групп разом (без указанного brand) —
      // не показываем его дважды
      const dedupe = (items: ProductSummary[]) => {
        const seen = new Set<string>();
        return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
      };
      oemEquivalents = dedupe(oemEquivalents);
      aftermarketAlternatives = dedupe(aftermarketAlternatives);
    }

    return NextResponse.json({
      success: true,
      exactMatch,
      oemEquivalents,
      aftermarketAlternatives,
    });
  } catch (error) {
    console.error('Ошибка при поиске детали с кросс-аналогами:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось выполнить поиск: ' + message },
      { status: 500 }
    );
  }
}
