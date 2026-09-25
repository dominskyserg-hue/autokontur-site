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
//
// ШВИДКІСТЬ: раніше всі гілки пошуку (артикул, бренд, марка, модель,
// кросс-номери, TecDoc, назва, "деталь + авто") були зʼєднані через OR
// в одній умові над products — а один OR із неіндексованою гілкою
// змушує Postgres перечитати ВСІ ~360 тис. рядків (1.4-2.5 c). Тепер
// кожна гілка — окремий підзапит "SELECT id ...", який сам використовує
// свій індекс (pg_trgm GIN на article/brand/car_make/car_model/
// name_search, btree на tecdoc_*), а підсумкова умова — це
// p.id IN (гілка1 UNION гілка2 UNION ...). Результат ТОЙ САМИЙ (об'єднання
// множин id) — змінилась лише форма запиту
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

  // Кожен елемент — повний "SELECT <id> ..." (одна колонка id)
  const branches: string[] = [
    `SELECT p.id FROM products p WHERE p.article ILIKE ${articlePlaceholder}`,
    `SELECT p.id FROM products p WHERE p.brand ILIKE ${textPlaceholder}`,
    `SELECT p.id FROM products p WHERE p.car_make ILIKE ${textPlaceholder}`,
    `SELECT p.id FROM products p WHERE p.car_model ILIKE ${textPlaceholder}`,
    `SELECT mine.product_id AS id
       FROM cross_reference_members mine
       JOIN cross_reference_members other ON other.group_id = mine.group_id
       WHERE mine.product_id IS NOT NULL AND other.part_number ILIKE ${articlePlaceholder}`,
    `SELECT p.id
       FROM tecdoc_crosses tc
       JOIN products p ON p.article = tc.article_b
       WHERE tc.article_a = ${exactArticlePlaceholder}`,
  ];

  const dictionary = await loadSynonymDictionary(pool);
  const expanded = expandSearchQuery(search, dictionary);
  const synonymClause = buildSynonymWhereClause(expanded, startParamIndex + values.length);
  if (synonymClause) {
    branches.push(`SELECT p.id FROM products p WHERE ${synonymClause.clause}`);
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

    // "Сумісність з авто": (1) власні поля товару АБО (2) TecDoc. Це
    // дві окремі гілки (кожна з власним індексом), а не OR в одній
    // Гілки лише за МАРКОЮ (+ рік). Раніше була ще "точна" гілка з моделлю,
    // але вона завжди вужча за цю (та сама умова + модель), тож в UNION
    // нічого не додавала — прибрана; тому й модель у product_vehicle_makes
    // не зберігається
    const addCarCompatBranches = (): void => {
      values.push(carRef.makeDbValues);
      const ownParts = [`UPPER(p.car_make) = ANY($${startParamIndex + values.length - 1}::text[])`];
      values.push(carRef.makeDbValues.map((make) => make.toUpperCase()));
      // product_vehicle_makes — заздалегідь обчислений збіг tecdoc_compatibility
      // з products (lib/vehicleMakeIndex.ts); make там уже UPPER(...)
      const tecdocParts = [`pvm.make = ANY($${startParamIndex + values.length - 1}::text[])`];

      if (carRef.year) {
        values.push(`%${carRef.year}%`);
        ownParts.push(`p.car_year ILIKE $${startParamIndex + values.length - 1}`);
        values.push(carRef.year);
        tecdocParts.push(
          `$${startParamIndex + values.length - 1}::int BETWEEN COALESCE(pvm.year_from, 1900) AND COALESCE(pvm.year_to, 2100)`
        );
      }

      const categoryPart = categoryClauseSql ? `${categoryClauseSql} AND ` : '';
      branches.push(`SELECT p.id FROM products p WHERE ${categoryPart}${ownParts.join(' AND ')}`);
      // Без категорії товари не потрібні — лише id з product_vehicle_makes
      branches.push(
        categoryPart
          ? `SELECT p.id
               FROM product_vehicle_makes pvm
               JOIN products p ON p.id = pvm.product_id
               WHERE ${categoryPart}${tecdocParts.join(' AND ')}`
          : `SELECT pvm.product_id AS id FROM product_vehicle_makes pvm WHERE ${tecdocParts.join(' AND ')}`
      );
    };

    addCarCompatBranches();
  }

  return { clause: `p.id IN (\n      ${branches.join('\n      UNION\n      ')}\n    )`, params: values };
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
    WHERE p.is_active = true AND ${clause}
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
