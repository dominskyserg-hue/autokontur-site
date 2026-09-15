// ============================================================
// Спільна логіка текстового пошуку товарів — за артикулом, брендом,
// кросс-номером/OEM, ключовими словами (словник синонімів) і вільним
// текстом "деталь + авто одним реченням" ("ремінь грм на мазду 626
// 1992 року").
//
// Раніше цей SQL-блок жив ЛИШЕ всередині app/api/products/route.ts
// (пошук на вітрині сайту). Винесено сюди, щоб той самий пошук міг
// використати і Telegram-бот (app/api/telegram/webhook/route.ts,
// сценарій "клієнт написав марку/модель/рік і що шукає") — без
// дублювання і без розбіжностей між тим, що знаходить сайт і що
// знаходить бот.
// ============================================================

import type { Pool } from 'pg';
import { loadSynonymDictionary, expandSearchQuery, buildSynonymWhereClause } from './searchSynonyms';
import { detectCategoryInText, buildCategoryWhereClause } from './categories';
import { extractCarReference } from './searchCarText';

// Та сама функція, що й у app/api/suppliers/parse-excel/route.ts —
// нею чистяться артикули ПЕРЕД збереженням у базу, тому пошуковий
// запит потрібно чистити так само: інакше "AB-123" ніколи не знайде
// вже збережений "AB123"
export function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// Будує WHERE-умову й параметри для текстового пошуку — той самий
// принцип, що й buildCategoryWhereClause у lib/categories.ts:
// викликач сам вставляє повернутий clause у свій SQL і додає params
// до свого масиву значень (values.push(...params)), startParamIndex —
// це $-номер, з якого продовжувати нумерацію
export async function buildTextSearchClause(
  pool: Pool,
  search: string,
  startParamIndex: number
): Promise<{ clause: string; params: unknown[] }> {
  const values: unknown[] = [];

  const cleanedArticle = cleanArticle(search);
  values.push(`%${cleanedArticle}%`, `%${search}%`, cleanedArticle);
  const articlePlaceholder = `$${startParamIndex + values.length - 3}`;
  const textPlaceholder = `$${startParamIndex + values.length - 2}`;
  const exactArticlePlaceholder = `$${startParamIndex + values.length - 1}`;

  const orParts = [
    `p.article ILIKE ${articlePlaceholder}`,
    `p.brand ILIKE ${textPlaceholder}`,
    `p.car_make ILIKE ${textPlaceholder}`,
    `p.car_model ILIKE ${textPlaceholder}`,
    `EXISTS (
      SELECT 1
      FROM cross_reference_members mine
      JOIN cross_reference_members other ON other.group_id = mine.group_id
      WHERE mine.product_id = p.id AND other.part_number ILIKE ${articlePlaceholder}
    )`,
    `EXISTS (
      SELECT 1 FROM tecdoc_crosses tc
      WHERE tc.article_a = ${exactArticlePlaceholder} AND tc.article_b = p.article
    )`,
  ];

  const dictionary = await loadSynonymDictionary(pool);
  const expanded = expandSearchQuery(search, dictionary);
  const synonymClause = buildSynonymWhereClause(expanded, startParamIndex + values.length);
  if (synonymClause) {
    orParts.push(`(${synonymClause.clause})`);
    values.push(...synonymClause.params);
  }

  const carRef = extractCarReference(expanded.leftoverRaw || search);
  if (carRef) {
    const detectedCategory = detectCategoryInText(search);
    let categoryClauseSql: string | null = null;
    if (detectedCategory) {
      const categoryClause = buildCategoryWhereClause(detectedCategory, startParamIndex + values.length);
      values.push(...categoryClause.params);
      categoryClauseSql = `(${categoryClause.clause})`;
    }

    const buildCarCompatSql = (includeModel: boolean): string => {
      values.push(carRef!.makeDbValues);
      const ownParts = [`UPPER(p.car_make) = ANY($${startParamIndex + values.length - 1}::text[])`];
      values.push(carRef!.makeDbValues);
      const tecdocParts = [`UPPER(tc2.make) = ANY($${startParamIndex + values.length - 1}::text[])`];

      if (includeModel && carRef!.modelHint) {
        values.push(`%${carRef!.modelHint}%`);
        ownParts.push(`p.car_model ILIKE $${startParamIndex + values.length - 1}`);
        values.push(`%${carRef!.modelHint}%`);
        tecdocParts.push(`tc2.model ILIKE $${startParamIndex + values.length - 1}`);
      }

      if (carRef!.year) {
        values.push(`%${carRef!.year}%`);
        ownParts.push(`p.car_year ILIKE $${startParamIndex + values.length - 1}`);
        values.push(carRef!.year);
        tecdocParts.push(
          `$${startParamIndex + values.length - 1}::int BETWEEN COALESCE(tc2.year_from, 1900) AND COALESCE(tc2.year_to, 2100)`
        );
      }

      return `(
        (${ownParts.join(' AND ')})
        OR EXISTS (
          SELECT 1 FROM tecdoc_compatibility tc2
          WHERE tc2.brand = p.brand AND tc2.article = p.article
          AND ${tecdocParts.join(' AND ')}
        )
      )`;
    };

    const preciseParts: string[] = [];
    if (categoryClauseSql) preciseParts.push(categoryClauseSql);
    preciseParts.push(buildCarCompatSql(true));
    orParts.push(`(${preciseParts.join('\n        AND ')})`);

    if (carRef.modelHint) {
      const fallbackParts: string[] = [];
      if (categoryClauseSql) fallbackParts.push(categoryClauseSql);
      fallbackParts.push(buildCarCompatSql(false));
      orParts.push(`(${fallbackParts.join('\n        AND ')})`);
    }
  }

  return { clause: `(${orParts.join('\n      OR ')})`, params: values };
}

export interface BotSearchResult {
  id: string;
  brand: string;
  article: string;
  name: string | null;
  retailPrice: number;
  stock: number;
}

// Спрощена версія пошуку для Telegram-бота: без пагінації,
// персональних цін покупця (у бота немає "залогіненого" cookie) і
// без фонового пошуку фото — боту потрібен лише короткий список
// "бренд, артикул, ціна, наявність"
export async function searchProductsForBot(
  pool: Pool,
  text: string,
  limit: number
): Promise<{ results: BotSearchResult[]; totalCount: number }> {
  const trimmed = text.trim();
  if (!trimmed) return { results: [], totalCount: 0 };

  const { clause, params } = await buildTextSearchClause(pool, trimmed, 1);
  const values = [...params, limit];
  const limitPlaceholder = `$${values.length}`;

  const result = await pool.query(
    `
    SELECT p.id, p.brand, p.article, p.name, p.retail_price, p.stock, COUNT(*) OVER() AS total_count
    FROM products p
    WHERE ${clause}
    ORDER BY (p.stock > 0) DESC, p.retail_price ASC
    LIMIT ${limitPlaceholder}
    `,
    values
  );

  const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
  const results: BotSearchResult[] = result.rows.map((row) => ({
    id: row.id,
    brand: row.brand,
    article: row.article,
    name: row.name,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
  }));

  return { results, totalCount };
}
