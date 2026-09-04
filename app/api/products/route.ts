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
//                 в админке; а ТАКЖЕ точным совпадением по массовому
//                 SEO-индексу tecdoc_crosses, scripts/tecdoc/ — если
//                 покупатель ввёл чужой OEM/кросс-номер детали, а не
//                 её собственный артикул), А ТАКЖЕ по ключевым словам
//                 из названия товара с учётом многоязычного словаря
//                 синонимов (search_synonym_groups, см.
//                 lib/searchSynonyms.ts и экран "Словник пошуку" в
//                 админке) — запрос "гальмівні колодки rav 4" находит
//                 товар с названием "brake pads RAV4" или "тормозные
//                 колодки rav-4"
//   supplierId  — если передан, показывает товары только этого
//                 поставщика (UUID)
//   carMake, carModel, carYear, engineVolume — "Підбір за автомобілем"
//                 на витрине (components/StorefrontHome.tsx): точное
//                 совпадение (регистронезависимо), а не по подстроке —
//                 значения приходят из выпадающих списков, которые сами
//                 заполнены реальными значениями из базы (см.
//                 app/api/products/car-options/route.ts), поэтому
//                 опечаток тут не бывает. Можно передать любую
//                 комбинацию — например, только carMake, чтобы показать
//                 вообще все детали для этой марки. carMake/carModel/
//                 carYear ищут не только среди собственных полей товара
//                 (car_make/car_model/car_year — их вручную заполняет
//                 поставщик и часто оставляет пустыми), но и среди
//                 массового SEO-индекса tecdoc_compatibility
//                 (scripts/tecdoc/) — точных диапазонов годов из дампа
//                 TecDoc для этого же артикула. Так товар без заполненных
//                 car_make/car_year всё равно найдётся при подборе по
//                 автомобилю, если для него есть данные в TecDoc
//
// Название компании-поставщика — через JOIN с suppliers, а не
// отдельным запросом на каждый товар.
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { loadSynonymDictionary, expandSearchQuery, buildSynonymWhereClause } from '@/lib/searchSynonyms';
import { processBatch, type ProductToProcess } from '@/lib/productImagePipeline';
import { resolveMakeDbValues } from '@/lib/carMakes';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// after() ниже продолжает работать уже ПОСЛЕ того, как ответ ушёл
// покупателю — на это нужно больше времени, чем 10с по умолчанию на
// тарифе Hobby (см. такой же maxDuration в app/api/cron/fetch-product-images)
export const maxDuration = 60;

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

globalThis.pgPool = pool;

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
  // Термін поставки під замовлення ЦЬОГО постачальника (suppliers.
  // delivery_time) — вільний текст, напр. "2-3 дні". Показується на
  // вітрині ТІЛЬКИ якщо товару немає в наявності (stock = 0), див.
  // components/StorefrontHome.tsx
  deliveryTime: string | null;
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
    const carModel = (searchParams.get('carModel') || '').trim();
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
      values.push(`%${cleanedArticle}%`, `%${search}%`, cleanedArticle);
      const articlePlaceholder = `$${values.length - 2}`;
      const textPlaceholder = `$${values.length - 1}`;
      // Точний (без ILIKE-підстановки з %) — для пошуку по tecdoc_crosses
      // нижче: там ЗАВЖДИ порівняння на РІВНІСТЬ з уже очищеним
      // article_a, щоб запит міг скористатись індексом
      // idx_tecdoc_crosses_article_a замість повного сканування 1,8 млн
      // рядків при кожному пошуку на сайті
      const exactArticlePlaceholder = `$${values.length}`;

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
        // Масовий SEO-індекс TecDoc (tecdoc_crosses, scripts/tecdoc/) —
        // окрема від cross_reference_members таблиця (курована модель
        // вище). Кожен зв'язок записаний ОБОМА напрямками при імпорті
        // (див. коментар у schema.sql), тому досить одного простого
        // порівняння: "чи є рядок, де введений покупцем номер — це
        // article_a, а article_b — це артикул САМЕ ЦЬОГО товару". Так
        // покупець, що вводить чужий кросс/OEM-номер (напр. "KL0111312"),
        // знаходить товар з нашим власним артикулом ("19035165B"), а не
        // отримує "нічого не знайдено"
        `EXISTS (
          SELECT 1 FROM tecdoc_crosses tc
          WHERE tc.article_a = ${exactArticlePlaceholder} AND tc.article_b = p.article
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
    // каждый параметр применяется независимо от остальных, если передан.
    // carMake/carModel/carYear проверяются ДВУМЯ способами разом (через
    // OR): (1) собственные поля товара p.car_make/car_model/car_year —
    // как и раньше, и (2) EXISTS по tecdoc_compatibility для ТОГО ЖЕ
    // товара (join по brand+article — на это есть индекс
    // idx_tecdoc_compat_part, см. schema.sql) — так товар находится по
    // подбору авто, даже если поставщик не заполнил car_make/car_year
    // вручную, но для его артикула есть данные из дампа TecDoc.
    // engineVolume — не трогаем: в tecdoc_compatibility двигатель пока
    // не заполняется (см. schema.sql), поэтому фильтр остаётся только
    // по собственному полю товара, как и был
    if (carMake || carModel || carYear) {
      // carMake, обраний покупцем у випадаючому списку (див.
      // app/api/products/car-options/route.ts), — це або курована назва
      // марки ("Volkswagen"), або сире значення з products.car_make.
      // Одна й та сама марка може бути записана по-різному в
      // products.car_make ("VW") і tecdoc_compatibility.make
      // ("VOLKSWAGEN") — resolveMakeDbValues() повертає ВСІ варіанти
      // написання одразу, щоб порівняння через ANY(...) знаходило
      // товар незалежно від того, яким текстом записана марка
      const makeDbValues = carMake ? resolveMakeDbValues(carMake) : [];

      const ownParts: string[] = [];
      if (carMake) {
        values.push(makeDbValues);
        ownParts.push(`UPPER(p.car_make) = ANY($${values.length}::text[])`);
      }
      if (carModel) {
        values.push(carModel);
        ownParts.push(`p.car_model ILIKE $${values.length}`);
      }
      if (carYear) {
        values.push(carYear);
        ownParts.push(`p.car_year ILIKE $${values.length}`);
      }
      const ownMatchSql = ownParts.length > 0 ? ownParts.join(' AND ') : 'FALSE';

      const tecdocParts: string[] = [];
      if (carMake) {
        values.push(makeDbValues);
        tecdocParts.push(`UPPER(tc.make) = ANY($${values.length}::text[])`);
      }
      if (carModel) {
        values.push(carModel);
        tecdocParts.push(`tc.model = $${values.length}`);
      }
      if (carYear) {
        values.push(carYear);
        tecdocParts.push(
          `$${values.length}::int BETWEEN COALESCE(tc.year_from, 1900) AND COALESCE(tc.year_to, 2100)`
        );
      }
      const tecdocWhereSql = tecdocParts.length > 0 ? `AND ${tecdocParts.join(' AND ')}` : '';

      conditions.push(`(
        (${ownMatchSql})
        OR EXISTS (
          SELECT 1 FROM tecdoc_compatibility tc
          WHERE tc.brand = p.brand AND tc.article = p.article
          ${tecdocWhereSql}
        )
      )`);
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
        p.image_search_attempted_at,
        p.cost_price,
        p.retail_price,
        p.stock,
        p.supplier_id,
        s.name AS supplier_name,
        s.delivery_time,
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
      deliveryTime: row.delivery_time,
      updatedAt: row.updated_at,
    }));

    // ------------------------------------------------------------
    // ФОТО ТОВАРІВ, ЯКІ ПОКУПЕЦЬ РЕАЛЬНО БАЧИТЬ ПРЯМО ЗАРАЗ У ПОШУКУ
    // ------------------------------------------------------------
    // Фонова черга (app/api/cron/fetch-product-images) рухається по
    // всій базі за 8 товарів на тик і може дійти до конкретного
    // товару через місяці — покупець стільки чекати не буде. Тому
    // тут, ЯКЩО це саме пошук (є текст search, а не звичайний перегляд
    // каталогу в адмінці), одразу ставимо в чергу пошук фото для
    // товарів БЕЗ фото з видачі — але вже ПІСЛЯ того, як відповідь
    // пішла покупцю (after()), щоб пошук на сайті не гальмував,
    // чекаючи на Bing. Фото з'явиться не в цій самій відповіді, а
    // при наступному відкритті сторінки (за кілька секунд).
    //
    // ON_DEMAND_RETRY_AFTER_DAYS — той самий сенс, що і
    // RETRY_AFTER_DAYS у cron-черзі: не пробувати знову товар, для
    // якого вже недавно шукали фото і не знайшли, навіть якщо його
    // знову шукають — інакше популярний, але "непошуковий" артикул
    // бив би по Bing при кожному повторному пошуку
    if (search) {
      const ON_DEMAND_RETRY_AFTER_DAYS = 7;
      const MAX_ON_DEMAND = 6;
      const retryThreshold = Date.now() - ON_DEMAND_RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000;

      const candidates: ProductToProcess[] = result.rows
        .filter((row) => {
          if (row.image_url) return false;
          if (!row.image_search_attempted_at) return true;
          return new Date(row.image_search_attempted_at).getTime() < retryThreshold;
        })
        .slice(0, MAX_ON_DEMAND)
        .map((row) => ({ id: row.id, article: row.article, brand: row.brand, name: row.name }));

      if (candidates.length > 0) {
        after(async () => {
          try {
            await processBatch(pool, candidates);
          } catch (error) {
            console.error('Ошибка фонового поиска фото по результатам поиска:', error);
          }
        });
      }
    }

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
