// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products
//
// Отдаёт список товаров для экрана "Товары" (управление каталогом).
// Товаров в базе могут быть сотни тысяч (все прайсы всех поставщиков
// разом) — поэтому здесь ВСЕГДА пагинация, отдать всё одним запросом
// нельзя.
//
//   GET /api/products?page=1&pageSize=50&search=AB-123&supplierId=...
//
//   page        — номер страницы, начиная с 1 (по умолчанию 1)
//   pageSize    — сколько товаров на странице (по умолчанию 50,
//                 максимум 200 — чтобы случайно не запросили всю базу
//                 разом через строку адреса)
//   search      — ищет совпадение по артикулу, бренду, кросс-номеру
//                 товара (регистронезависимо, по подстроке — см.
//                 таблицу cross_reference_members и экран "Кроссы"
//                 в админке), А ТАКЖЕ по ключевым словам из названия
//                 товара с учётом многоязычного словаря синонимов
//                 (search_synonym_groups, см. lib/searchSynonyms.ts
//                 и экран "Словник пошуку" в админке) — запрос
//                 "гальмівні колодки rav 4" находит товар с названием
//                 "brake pads RAV4" или "тормозные колодки rav-4"
//   supplierId  — если передан, показывает товары только этого
//                 поставщика (UUID)
//   carMake, carYear, engineVolume — "Підбір за автомобілем" на
//                 витрине (components/StorefrontHome.tsx): точное
//                 совпадение (регистронезависимо), а не по подстроке —
//                 значения приходят из выпадающих списков, которые сами
//                 заполнены реальными значениями из базы (см.
//                 app/api/products/car-options/route.ts), поэтому
//                 опечаток тут не бывает. Можно передать любую
//                 комбинацию из трёх — например, только carMake, чтобы
//                 показать вообще все детали для этой марки
//
// Название компании-поставщика — через JOIN с suppliers, а не
// отдельным запросом на каждый товар.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { loadSynonymDictionary, expandSearchQuery, buildSynonymWhereClause } from '@/lib/searchSynonyms';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Тот же приём, что и в остальных роутах (suppliers/route.ts,
// rates/route.ts...) — общий Pool в globalThis, чтобы все файлы
// использовали одно и то же подключение, а не плодили новые
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ОЧИСТКА АРТИКУЛА ДЛЯ ПОИСКА
// ------------------------------------------------------------
// Та же самая функция, что и в app/api/suppliers/parse-excel/route.ts —
// ею чистятся артикулы ПЕРЕД сохранением в базу (см. cleanArticle()
// там же), поэтому и поисковый запрос нужно чистить точно так же:
// иначе "AB-123" никогда не найдёт "AB123", уже сохранённый в базе
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
// Тот же формат, что и в других роутах: 8-4-4-4-12 шестнадцатеричных
// символов через дефис
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ------------------------------------------------------------
// ПАГИНАЦИЯ — значения по умолчанию и ограничения
// ------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Товар в том виде, в котором мы отдаём его на фронтенд
interface ProductResponse {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  carMake: string | null;
  carModel: string | null;
  carYear: string | null;
  engineVolume: string | null;
  metaDescription: string | null;
  imageUrl: string | null;
  costPrice: number;
  retailPrice: number;
  stock: number;
  supplierId: string;
  supplierName: string;
  updatedAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // ---- разбор и проверка параметров пагинации ----
    // Math.max/Math.min — чтобы нельзя было запросить страницу "0"
    // или "-5", либо pageSize больше MAX_PAGE_SIZE через строку адреса
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawPageSize = parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;

    const offset = (page - 1) * pageSize;

    // ---- разбор фильтров ----
    const search = (searchParams.get('search') || '').trim();
    const supplierId = (searchParams.get('supplierId') || '').trim();
    const carMake = (searchParams.get('carMake') || '').trim();
    const carYear = (searchParams.get('carYear') || '').trim();
    const engineVolume = (searchParams.get('engineVolume') || '').trim();

    if (supplierId && !isValidUuid(supplierId)) {
      return NextResponse.json(
        { error: 'supplierId должен быть корректным UUID.' },
        { status: 400 }
      );
    }

    // ---- собираем WHERE-условие и параметры динамически ----
    // Условия и параметры собираются в массивы и объединяются в конце —
    // так легко добавлять/убирать фильтры, не путаясь в нумерации $1, $2...
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (search) {
      // cleanArticle() приводит поисковый запрос к тому же виду, в
      // котором артикул хранится в базе (см. комментарий у функции
      // выше) — ищем его по подстроке (ILIKE), поэтому "AB1" найдёт
      // и "AB123". По бренду и марке/модели авто ищем тем же текстом,
      // но БЕЗ очистки от спецсимволов — эти поля не проходят через
      // cleanArticle при сохранении, значит и искать их нужно как
      // обычный текст. Так запрос "Toyota" находит все запчасти для
      // Toyota, даже если сам текст запроса не похож на артикул
      // Кросс-номер ("0986424815" от Bosch, OEM-номер автопроизводителя
      // и т.п.) ищем той же очищенной строкой, что и обычный артикул —
      // он нормализуется точно так же при сохранении (см.
      // app/api/products/cross-references/import/route.ts). Модель —
      // "группы взаимозаменяемости" (cross_reference_groups /
      // cross_reference_members, см. schema.sql): товар p попадает в
      // выдачу, если СРЕДИ УЧАСТНИКОВ ЕГО ЖЕ ГРУППЫ (mine.product_id =
      // p.id) есть хоть один (other) с подходящим номером — включая
      // саму запись mine, если у p ещё нет группы. JOIN, а не просто
      // проверка part_number = p.article — потому что нужно найти
      // товар ПО ЧУЖОМУ кросс-номеру, а не только по своему
      const cleanedArticle = cleanArticle(search);
      values.push(`%${cleanedArticle}%`, `%${search}%`);
      const articlePlaceholder = `$${values.length - 1}`;
      const textPlaceholder = `$${values.length}`;

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
      ];

      // Пошук за КЛЮЧОВИМИ СЛОВАМИ з назви товару, з урахуванням
      // багатомовного словника синонімів (search_synonym_groups) —
      // "гальмівні колодки rav 4" знайде товар з назвою "brake pads
      // rav4" чи "тормозные колодки RAV4". Див. lib/searchSynonyms.ts
      const dictionary = await loadSynonymDictionary(pool);
      const expanded = expandSearchQuery(search, dictionary);
      const synonymClause = buildSynonymWhereClause(expanded, values.length + 1);
      if (synonymClause) {
        orParts.push(`(${synonymClause.clause})`);
        values.push(...synonymClause.params);
      }

      conditions.push(`(${orParts.join('\n          OR ')})`);
    }

    if (supplierId) {
      values.push(supplierId);
      conditions.push(`p.supplier_id = $${values.length}`);
    }

    // "Підбір за автомобілем" — точное совпадение (без учёта регистра),
    // каждый параметр применяется независимо от остальных, если передан
    if (carMake) {
      values.push(carMake);
      conditions.push(`p.car_make ILIKE $${values.length}`);
    }
    if (carYear) {
      values.push(carYear);
      conditions.push(`p.car_year ILIKE $${values.length}`);
    }
    if (engineVolume) {
      values.push(engineVolume);
      conditions.push(`p.engine_volume ILIKE $${values.length}`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // При пошуку (є текст search) пріоритет видачі: спершу те, що
    // швидше доїде (є в наявності — stock > 0), потім за ціною від
    // більшої до меншої. Без пошуку (звичайний перегляд каталогу,
    // напр. в адмінці) лишаємо алфавітний порядок за артикулом —
    // його там очікують бачити стабільним при гортанні сторінок
    const orderBySql = search ? 'ORDER BY (p.stock > 0) DESC, p.retail_price DESC' : 'ORDER BY p.article ASC';

    // ---- сам запрос ----
    // COUNT(*) OVER() — считает общее количество подходящих строк
    // ПРЯМО В ЭТОМ ЖЕ запросе, без отдельного COUNT-запроса до или
    // после: Postgres сначала применяет WHERE, а потом добавляет
    // колонку total_count с одним и тем же числом к каждой строке
    // страницы. Дешевле, чем делать два похожих запроса подряд
    values.push(pageSize, offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    const result = await pool.query(
      `
      SELECT
        p.id,
        p.article,
        p.brand,
        p.name,
        p.car_make,
        p.car_model,
        p.car_year,
        p.engine_volume,
        p.meta_description,
        p.image_url,
        p.cost_price,
        p.retail_price,
        p.stock,
        p.supplier_id,
        s.name AS supplier_name,
        p.updated_at,
        COUNT(*) OVER() AS total_count
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      ${whereSql}
      ${orderBySql}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      values
    );

    // Если строк не нашлось (например, пустая база или поиск ничего
    // не дал), total_count из запроса взять неоткуда — тогда 0
    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;

    const products: ProductResponse[] = result.rows.map((row) => ({
      id: row.id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      carMake: row.car_make,
      carModel: row.car_model,
      carYear: row.car_year,
      engineVolume: row.engine_volume,
      metaDescription: row.meta_description,
      imageUrl: row.image_url,
      // cost_price/retail_price — колонки NUMERIC, драйвер pg
      // возвращает такие значения строкой (чтобы не терять точность
      // при преобразовании в float), поэтому явно переводим в число
      costPrice: parseFloat(row.cost_price),
      retailPrice: parseFloat(row.retail_price),
      stock: row.stock,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({
      success: true,
      products,
      pagination: { page, pageSize, totalCount, totalPages },
    });
  } catch (error) {
    console.error('Ошибка при получении списка товаров:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список товаров: ' + message },
      { status: 500 }
    );
  }
}
