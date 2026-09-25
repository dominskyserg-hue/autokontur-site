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
//                 вообще все детали для этой марки. Все четыре ищут не
//                 только среди собственных полей товара (car_make/
//                 car_model/car_year/engine_volume — их вручную заполняет
//                 поставщик и часто оставляет пустыми), но и среди
//                 массового SEO-индекса tecdoc_compatibility
//                 (scripts/tecdoc/) — точных диапазонов годов и объёма
//                 двигателя конкретной модификации из дампа TecDoc для
//                 этого же артикула. Так товар без заполненных собственных
//                 полей всё равно найдётся при подборе по автомобилю, если
//                 для него есть данные в TecDoc
//
// Название компании-поставщика — через JOIN с suppliers, а не
// отдельным запросом на каждый товар.
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { processBatch, type ProductToProcess } from '@/lib/productImagePipeline';
import { resolveMakeDbValues } from '@/lib/carMakes';
import { getCustomerPricingRule, computeCustomerPrice } from '@/lib/customerPricing';
import { CUSTOMER_PHONE_COOKIE } from '@/lib/customerPhoneCookie';
import { buildTextSearchClause } from '@/lib/productSearch';
import { isAdminRequest } from '@/lib/adminSession';

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
  // Закупочная цена поставщика — ТОЛЬКО для адмінки (запрос с валидной
  // cookie-сессией администратора, см. lib/adminSession.ts). Покупателю
  // на витрине это поле не отдаётся вовсе — иначе по ответу API видна
  // себестоимость и наценка магазина
  costPrice?: number;
  retailPrice: number;
  // Скидка (%) от правила наценки поставщика — ЧИСТО для отображения
  // (retailPrice уже посчитана со скидкой), см. schema.sql:
  // supplier_markup_rules и products.discount_percent. 0 — скидки нет
  discountPercent: number;
  stock: number;
  // supplierId/supplierName — тоже ТОЛЬКО для админки (isAdminRequest)
  supplierId?: string;
  supplierName?: string;
  // Термін поставки під замовлення ЦЬОГО постачальника (suppliers.
  // delivery_time) — вільний текст, напр. "2-3 дні". Показується на
  // вітрині ТІЛЬКИ якщо товару немає в наявності (stock = 0), див.
  // components/StorefrontHome.tsx
  deliveryTime: string | null;
  updatedAt: string;
}

// ------------------------------------------------------------
// ПРИБЛИЗИТЕЛЬНОЕ общее количество для покупателей
// ------------------------------------------------------------
// Точно считаем до COUNT_CAP строк (быстро: читаем не больше 10 001
// строки). Если подходящих больше — берём оценку планировщика Postgres
// (EXPLAIN, поле "Plan Rows") — для "всего каталога" и простых фильтров
// она близка к реальной. Витрина totalCount не показывает, он нужен
// только админским экранам (там точный путь)
const COUNT_CAP = 10000;

async function estimateTotalCount(
  db: Pool,
  whereSql: string,
  filterValues: unknown[]
): Promise<{ count: number; approximate: boolean }> {
  const base = `FROM products p JOIN suppliers s ON s.id = p.supplier_id ${whereSql}`;
  const capped = await db.query(`SELECT count(*)::int AS c FROM (SELECT 1 ${base} LIMIT ${COUNT_CAP + 1}) t`, filterValues);
  const exact = capped.rows[0].c as number;
  if (exact <= COUNT_CAP) return { count: exact, approximate: false };
  const plan = await db.query(`EXPLAIN (FORMAT JSON) SELECT 1 ${base}`, filterValues);
  const estimate = Math.round(plan.rows[0]['QUERY PLAN'][0].Plan['Plan Rows']);
  return { count: Math.max(estimate, COUNT_CAP + 1), approximate: true };
}

// Кэш ответов в памяти (на инстанс) для АНОНИМНЫХ запросов без поиска —
// главная (featured), обзор каталога, фильтры "по авто" — на 5 минут.
// Не кэшируем: поиск (у него побочный эффект — очередь поиска фото),
// админа и покупателя с cookie персональной цены (цены разные)
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const responseCache = new Map<string, { expires: number; body: unknown }>();

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

    // Роут публичный (его вызывает витрина), а те же данные читают и
    // админские экраны — закупочная цена, поставщик, скрытые товары и
    // фильтр по поставщику доступны ТОЛЬКО с валидной админской сессией
    const isAdmin = await isAdminRequest(request);

    // Кэш: только анонимные запросы без поиска (см. responseCache выше)
    const cacheable =
      !isAdmin && !request.cookies.get(CUSTOMER_PHONE_COOKIE)?.value && !searchParams.get('search');
    const cacheKey = cacheable ? request.nextUrl.search : null;
    if (cacheKey) {
      const hit = responseCache.get(cacheKey);
      if (hit && hit.expires > Date.now()) return NextResponse.json(hit.body, { headers: { 'X-Cache': 'HIT' } });
      if (responseCache.size >= CACHE_MAX_ENTRIES) {
        const oldest = responseCache.keys().next().value;
        if (oldest !== undefined) responseCache.delete(oldest);
      }
    }

    // ---- разбор фильтров ----
    const search = (searchParams.get('search') || '').trim();
    // featured=true — витрина головної сторінки (components/StorefrontHome.tsx,
    // блок "Популярні товари"): короткий добір товарів з фото замість
    // звичайного алфавітного перегляду каталогу (див. orderBySql нижче)
    const featured = searchParams.get('featured') === 'true';
    const supplierId = isAdmin ? (searchParams.get('supplierId') || '').trim() : '';
    const carMake = (searchParams.get('carMake') || '').trim();
    const carModel = (searchParams.get('carModel') || '').trim();
    const carYear = (searchParams.get('carYear') || '').trim();
    const engineVolume = (searchParams.get('engineVolume') || '').trim();
    // includeInactive=1 — лише для адмінських екранів (components/
    // ProductsScreen.tsx, SupplierProductsScreen.tsx), де адмін мусить
    // бачити й приховані (is_active=false) товари, щоб мати змогу
    // повернути їх назад. Публічна вітрина (StorefrontHome.tsx та решта)
    // цей параметр не передає — там приховані товари завжди виключені
    const includeInactive = isAdmin && searchParams.get('includeInactive') === '1';

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

    if (!includeInactive) {
      conditions.push('p.is_active = true');
    }

    if (search) {
      // Уся логіка текстового пошуку (артикул/бренд/кросс-номер/
      // синоніми/"деталь + авто одним реченням") винесена у
      // lib/productSearch.ts — той самий код тепер використовує і
      // Telegram-бот (app/api/telegram/webhook/route.ts), щоб пошук
      // там не розходився з пошуком на сайті
      const searchClause = await buildTextSearchClause(pool, search, values.length + 1);
      values.push(...searchClause.params);
      conditions.push(searchClause.clause);
    }

    if (supplierId) {
      values.push(supplierId);
      conditions.push(`p.supplier_id = $${values.length}`);
    }

    // "Підбір за автомобілем" — точное совпадение (без учёта регистра),
    // каждый параметр применяется независимо от остальных, если передан.
    // carMake/carModel/carYear/engineVolume проверяются ДВУМЯ способами
    // разом (через OR): (1) собственные поля товара p.car_make/car_model/
    // car_year/engine_volume — как и раньше, и (2) EXISTS по
    // tecdoc_compatibility для ТОГО ЖЕ товара (join по brand+article — на
    // это есть индекс idx_tecdoc_compat_part, см. schema.sql) — так товар
    // находится по подбору авто, даже если поставщик не заполнил
    // car_make/car_year/engine_volume вручную, но для его артикула есть
    // данные из дампа TecDoc (включая объём двигателя КОНКРЕТНОЙ
    // модификации — types.TYP_LITRES/TYP_CCM, см. scripts/tecdoc/
    // import-dump.ts). Все параметры внутри ОДНОЙ ветки (own или tecdoc)
    // проверяются ВМЕСТЕ (AND), а не по отдельности — иначе марка+год
    // могли бы совпасть по одному источнику, а объём двигателя — по
    // совсем другой, не связанной модификации того же товара
    if (carMake || carModel || carYear || engineVolume) {
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
      if (engineVolume) {
        values.push(engineVolume);
        ownParts.push(`p.engine_volume ILIKE $${values.length}`);
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
      if (engineVolume) {
        values.push(engineVolume);
        tecdocParts.push(`tc.engine ILIKE $${values.length}`);
      }
      const tecdocWhereSql = tecdocParts.length > 0 ? `AND ${tecdocParts.join(' AND ')}` : '';

      conditions.push(`(
        (${ownMatchSql})
        OR EXISTS (
          SELECT 1 FROM tecdoc_compatibility tc
          WHERE UPPER(translate(tc.brand, 'ÄÖÜäöüÉÈéè', 'AOUaoueEee')) = UPPER(p.brand) AND tc.article = p.article
          ${tecdocWhereSql}
        )
      )`);
    }

    // featured: "фото насамперед, в наявності, найсвіжіші". Раніше це був
    // ORDER BY (image IS NOT NULL) DESC, (stock > 0) DESC, updated_at DESC —
    // сортування всіх ~360 тис. рядків. Тепер умова WHERE (image_url IS NOT
    // NULL AND stock > 0) + ORDER BY updated_at DESC — читається з
    // часткового індексу idx_products_featured за кілька мс (schema.sql).
    // Різниця лише в тому, що товари БЕЗ фото/наявності в блок не
    // потрапляють зовсім (їх там і так не було на перших місцях)
    if (featured) {
      conditions.push('p.image_url IS NOT NULL');
      conditions.push('p.stock > 0');
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // При пошуку (є текст search) пріоритет видачі: спершу те, що
    // швидше доїде (є в наявності — stock > 0), потім за ціною від
    // більшої до меншої. Без пошуку (звичайний перегляд каталогу,
    // напр. в адмінці) лишаємо алфавітний порядок за артикулом —
    // його там очікують бачити стабільним при гортанні сторінок
    // featured — блок "Популярні товари" на головній: товари з фото, в
    // наявності, найсвіжіші за оновленням (щойно завантажений/оновлений
    // прайс) — той самий принцип "фото насамперед", що і в пошуку/
    // категоріях/сторінках марок вище
    const orderBySql = search
      ? 'ORDER BY (p.image_url IS NOT NULL) DESC, (p.stock > 0) DESC, p.retail_price DESC'
      : featured
        ? 'ORDER BY p.updated_at DESC'
        : 'ORDER BY p.article ASC';

    // ---- сам запрос ----
    // COUNT(*) OVER() — считает общее количество подходящих строк
    // ПРЯМО В ЭТОМ ЖЕ запросе, без отдельного COUNT-запроса до или
    // после: Postgres сначала применяет WHERE, а потом добавляет
    // колонку total_count с одним и тем же числом к каждой строке
    // страницы. Дешевле, чем делать два похожих запроса подряд
    const filterValues = values.slice();
    values.push(pageSize, offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    // Персональна ціна покупця (customer_pricing_rules, за cookie з
    // телефоном "залогіненого" в Особистому кабінеті покупця —
    // components/CustomerDashboard.tsx) — рахуємо ПАРАЛЕЛЬНО з основним
    // запитом товарів (незалежні один від одного), щоб не додавати
    // зайву затримку. Застосовується нижче, при мапінгу рядків
    // Для покупателей общее количество — ПРИБЛИЗИТЕЛЬНОЕ (см. estimateTotalCount):
    // точный COUNT(*) OVER() заставлял Postgres прочитать ВСЕ подходящие строки
    // даже ради первой страницы. Админка (с сессией) получает точное, как раньше
    // Поиск тоже считает точно (окном): его результат и так целиком
    // вычисляется ради сортировки, отдельный count лишь удваивал бы работу
    const useApproxCount = !isAdmin && !search;
    const [customerPricingRule, result, approxCount] = await Promise.all([
      getCustomerPricingRule(pool, request.cookies.get(CUSTOMER_PHONE_COOKIE)?.value),
      pool.query(
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
        p.discount_percent,
        p.stock,
        p.supplier_id,
        s.name AS supplier_name,
        s.delivery_time,
        p.updated_at${useApproxCount ? '' : ', COUNT(*) OVER() AS total_count'}
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      ${whereSql}
      ${orderBySql}
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
        values
      ),
      useApproxCount ? estimateTotalCount(pool, whereSql, filterValues) : Promise.resolve(null),
    ]);

    // Если строк не нашлось (например, пустая база или поиск ничего
    // не дал), total_count из запроса взять неоткуда — тогда 0
    const totalCount = approxCount
      ? approxCount.count
      : result.rows.length > 0
        ? parseInt(result.rows[0].total_count, 10)
        : 0;
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
      // при преобразовании в float), поэтому явно переводим в число.
      // costPrice — только для админа (см. ProductResponse.costPrice)
      ...(isAdmin ? { costPrice: parseFloat(row.cost_price) } : {}),
      retailPrice: computeCustomerPrice(parseFloat(row.cost_price), parseFloat(row.retail_price), customerPricingRule),
      discountPercent: parseFloat(row.discount_percent),
      stock: row.stock,
      ...(isAdmin ? { supplierId: row.supplier_id, supplierName: row.supplier_name } : {}),
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

    const body = {
      success: true,
      products,
      pagination: { page, pageSize, totalCount, totalPages, ...(approxCount?.approximate ? { totalCountApproximate: true } : {}) },
    };
    if (cacheKey) responseCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('Ошибка при получении списка товаров:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список товаров: ' + message },
      { status: 500 }
    );
  }
}
