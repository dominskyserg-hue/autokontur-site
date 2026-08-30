// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/suppliers
//
// Этот файл отвечает за самих поставщиков (не за загрузку Excel —
// это отдельный роут app/api/suppliers/parse-excel/route.ts, и не
// за курсы валют — это отдельный роут app/api/rates/route.ts).
// Здесь два разных запроса уживаются в одном файле — так принято
// в Next.js App Router: имя функции = HTTP-метод, Next.js сам
// направляет запрос в нужную функцию по методу (POST/GET/...):
//
//   POST /api/suppliers  — создать НОВОГО поставщика (и, если
//                           переданы, сразу его настройки маппинга),
//                           либо ОБНОВИТЬ существующего — если в теле
//                           запроса передан "id" уже существующего
//                           поставщика. Так одна и та же кнопка
//                           "Сохранить" на фронтенде работает и для
//                           формы "Новый поставщик" (id ещё нет),
//                           и для формы "Настройки маппинга" уже
//                           выбранного поставщика (id уже есть) —
//                           без этого второй сценарий создавал бы
//                           дубликат поставщика при каждом сохранении
//   GET  /api/suppliers   — получить список всех поставщиков
//                           вместе с их настройками маппинга
//
// ВАЖНОЕ ИЗМЕНЕНИЕ: раньше у поставщика было своё собственное поле
// exchangeRate (курс валюты) — теперь курс стал ГЛОБАЛЬНЫМ и живёт
// в отдельной таблице global_exchange_rates (см. schema.sql и
// app/api/rates/route.ts). Здесь, в /api/suppliers, поставщик хранит
// только currency (какой валютой он пользуется), а сам курс этой
// валюты нужно смотреть/менять уже в /api/rates.
//
// Использует тот же пул подключений "pg", что и parse-excel/route.ts,
// и точно так же читает строку подключения из process.env.DATABASE_URL
// (переменная берётся из .env.local — см. предыдущий файл).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Этот блок специально написан ТОЧНО так же, как в parse-excel/route.ts
// и в rates/route.ts, и использует то же имя глобальной переменной
// (globalThis.pgPool). Благодаря этому все файлы в итоге работают
// с ОДНИМ И ТЕМ ЖЕ объектом Pool, а не создают несколько разных
// пулов подключений — тот, кто выполнится первым, создаст Pool и
// сохранит его в globalThis, а остальные файлы просто найдут его
// там и переиспользуют.
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

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

// Настройки маппинга, которые может прислать фронтенд вместе
// с данными поставщика. Все поля, кроме article и price,
// необязательны — так же, как на экране администратора
interface MappingInput {
  article: string;    // колонка с артикулом, например "B" — обязательно
  brand?: string;       // колонка с брендом, например "C"
  name?: string;          // колонка с названием детали, например "D"
  price: string;             // колонка с ценой поставщика, например "F" — обязательно
  stock?: string;               // колонка с остатком, например "G"
  // Колонки с маркой/моделью авто — для SEO-наполнения карточки
  // товара (см. app/api/suppliers/parse-excel/route.ts). Необязательные:
  // не у каждого поставщика в прайсе вообще есть такие колонки
  carMake?: string;
  carModel?: string;
  // Колонки с годом выпуска и объёмом двигателя — для поиска
  // "Підбір за автомобілем" на витрине. Тоже необязательные
  carYear?: string;
  engineVolume?: string;
  startRow?: number;               // с какой строки начинаются данные (по умолчанию 1)
  markup?: number;                    // наценка в процентах (по умолчанию 0)
}

// Тело запроса на создание поставщика. mapping необязателен целиком —
// можно сначала создать поставщика с одними контактами, а настройки
// маппинга сохранить позже отдельным запросом (так тоже устроен
// сценарий использования в интерфейсе: сначала форма "Новый
// поставщик", а поля маппинга заполняются уже после)
interface CreateSupplierRequestBody {
  // Если id передан и это существующий поставщик — обновляем его,
  // а не создаём нового. Если id не передан — создаём нового
  id?: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  // Валюта, в которой поставщик присылает прайс-лист (например,
  // "USD", "EUR"). Необязательное поле — если не передать,
  // подставится местная валюта (см. DEFAULT_CURRENCY ниже). Курса
  // здесь больше нет — он теперь общий для всех поставщиков этой
  // валюты и настраивается отдельно, через /api/rates
  currency?: string;
  // Активен ли поставщик — переключатель "Активен / На паузе" в
  // списке поставщиков. Необязательное поле: если не передать —
  // при создании подставится true, при обновлении статус не изменится
  isActive?: boolean;
  mapping?: MappingInput;
}

// Настройки маппинга в том виде, в котором мы отдаём их обратно
// на фронтенд (уже с приведёнными типами: startRow — число,
// markup — число, а не строка из базы)
interface MappingResponse {
  article: string;
  brand: string | null;
  name: string | null;
  price: string;
  stock: string | null;
  carMake: string | null;
  carModel: string | null;
  carYear: string | null;
  engineVolume: string | null;
  startRow: number;
  markup: number;
  updatedAt: string;
}

// Поставщик в том виде, в котором мы отдаём его на фронтенд.
// mapping — null, если для поставщика ещё не сохраняли настройки
interface SupplierResponse {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
  // Время последнего успешного импорта прайс-листа этого поставщика
  // (самое свежее products.updated_at среди его товаров). null — если
  // прайс ещё ни разу не загружали
  lastSyncedAt: string | null;
  mapping: MappingResponse | null;
}

// ------------------------------------------------------------
// ВАЛЮТА — значение по умолчанию и нормализация
// ------------------------------------------------------------

// Местная валюта "по умолчанию" — украинская гривна. Если поставщик
// присылает прайс уже в местной валюте, отдельно выбирать её не
// нужно и курс к ней всегда считается равным 1.0 (см. правило в
// app/api/suppliers/parse-excel/route.ts) — специально настраивать
// для неё ничего не нужно, в отличие от иностранных валют, чей курс
// хранится в global_exchange_rates и настраивается через /api/rates
const DEFAULT_CURRENCY = 'UAH';

// Код валюты — три латинские буквы (ISO 4217-подобный формат:
// "USD", "EUR", "UAH", "RUB"...). Простая проверка формата, а не
// сверка со справочником настоящих валют — этого достаточно, чтобы
// отсечь опечатки вроде пустой строки или "доллар"
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

// Приводит валюту к виду, в котором она хранится в базе: верхний
// регистр, без лишних пробелов. Если ничего не передали — местная
function normalizeCurrency(value: string | undefined | null): string {
  if (!value || !value.trim()) return DEFAULT_CURRENCY;
  return value.trim().toUpperCase();
}

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
// Тот же формат, что и в parse-excel/route.ts: 8-4-4-4-12
// шестнадцатеричных символов через дефис
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ------------------------------------------------------------
// ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ ПОСТАВЩИКА
// ------------------------------------------------------------
// Возвращает текст ошибки, если данные некорректны, или null,
// если всё в порядке. Эти же правила продублированы в самой базе
// (NOT NULL на name, CHECK на phone/email в schema.sql) — но
// проверять их ещё и здесь важно: так пользователь сразу получит
// понятное сообщение "Укажите телефон или email", а не сухую
// ошибку PostgreSQL про нарушение CHECK-ограничения
function validateSupplierInput(body: CreateSupplierRequestBody): string | null {
  if (!body.name || !body.name.trim()) {
    return 'Название поставщика обязательно для заполнения';
  }

  const hasPhone = Boolean(body.phone && body.phone.trim());
  const hasEmail = Boolean(body.email && body.email.trim());
  if (!hasPhone && !hasEmail) {
    return 'Укажите хотя бы телефон или email поставщика';
  }

  // Валюта — необязательное поле, но если её всё же передали,
  // это должен быть настоящий код из 3 латинских букв, а не
  // случайный текст
  if (body.currency !== undefined && body.currency !== null && body.currency.trim() !== '') {
    if (!CURRENCY_PATTERN.test(body.currency.trim())) {
      return 'Валюта должна быть кодом из 3 латинских букв, например USD, EUR или UAH';
    }
  }

  // Если настройки маппинга переданы — у них тоже есть обязательные
  // поля, ровно как при разборе самого Excel-файла
  if (body.mapping) {
    if (!body.mapping.article || !body.mapping.article.trim()) {
      return 'В настройках маппинга не указана колонка "Артикул"';
    }
    if (!body.mapping.price || !body.mapping.price.trim()) {
      return 'В настройках маппинга не указана колонка "Цена поставщика"';
    }
  }

  return null;
}

// ------------------------------------------------------------
// СОХРАНЕНИЕ МАППИНГА ДЛЯ ПОСТАВЩИКА (используется внутри POST)
// ------------------------------------------------------------
// supplier_id в этой таблице — одновременно первичный и внешний
// ключ (см. schema.sql), поэтому запись здесь всегда ровно одна
// на поставщика. INSERT ... ON CONFLICT (supplier_id) DO UPDATE
// написан как настоящий Upsert
async function upsertMapping(
  client: PoolClient,
  supplierId: string,
  mapping: MappingInput
): Promise<MappingResponse> {
  const result = await client.query(
    `
    INSERT INTO supplier_excel_mappings
      (supplier_id, article_column, brand_column, name_column, price_column, stock_column, car_make_column, car_model_column, car_year_column, engine_volume_column, start_row, markup_percent)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (supplier_id)
    DO UPDATE SET
      article_column = EXCLUDED.article_column,
      brand_column = EXCLUDED.brand_column,
      name_column = EXCLUDED.name_column,
      price_column = EXCLUDED.price_column,
      stock_column = EXCLUDED.stock_column,
      car_make_column = EXCLUDED.car_make_column,
      car_model_column = EXCLUDED.car_model_column,
      car_year_column = EXCLUDED.car_year_column,
      engine_volume_column = EXCLUDED.engine_volume_column,
      start_row = EXCLUDED.start_row,
      markup_percent = EXCLUDED.markup_percent,
      updated_at = now()
    RETURNING article_column, brand_column, name_column, price_column, stock_column, car_make_column, car_model_column, car_year_column, engine_volume_column, start_row, markup_percent, updated_at
    `,
    [
      supplierId,
      mapping.article.trim().toUpperCase(),
      mapping.brand?.trim().toUpperCase() || null,
      mapping.name?.trim().toUpperCase() || null,
      mapping.price.trim().toUpperCase(),
      mapping.stock?.trim().toUpperCase() || null,
      mapping.carMake?.trim().toUpperCase() || null,
      mapping.carModel?.trim().toUpperCase() || null,
      mapping.carYear?.trim().toUpperCase() || null,
      mapping.engineVolume?.trim().toUpperCase() || null,
      mapping.startRow || 1,
      mapping.markup || 0,
    ]
  );

  const row = result.rows[0];
  return {
    article: row.article_column,
    brand: row.brand_column,
    name: row.name_column,
    price: row.price_column,
    stock: row.stock_column,
    carMake: row.car_make_column,
    carModel: row.car_model_column,
    carYear: row.car_year_column,
    engineVolume: row.engine_volume_column,
    startRow: row.start_row,
    // markup_percent — колонка типа NUMERIC, драйвер pg возвращает
    // такие значения строкой (чтобы случайно не потерять точность
    // при преобразовании в float), поэтому здесь явно переводим
    // её в обычное число
    markup: parseFloat(row.markup_percent),
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------
// POST /api/suppliers — создать поставщика (и его маппинг)
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: CreateSupplierRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const validationError = validateSupplierInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Если id передан, он обязан быть настоящим UUID — иначе это,
  // скорее всего, старый демо-идентификатор вида "sup-1"
  const isUpdate = Boolean(body.id);
  if (isUpdate && !isValidUuid(body.id as string)) {
    return NextResponse.json(
      { error: 'id поставщика должен быть корректным UUID.' },
      { status: 400 }
    );
  }

  // Берём отдельное подключение из пула на всё время транзакции —
  // сохранение поставщика и его маппинга должны либо пройти оба
  // успешно, либо не пройти вообще
  const client = await pool.connect();

  const currency = normalizeCurrency(body.currency);

  try {
    await client.query('BEGIN');

    let supplierRow;

    if (isUpdate) {
      // isActive не передан — значит статус менять не нужно, оставляем
      // текущий (COALESCE подставит старое значение из самой строки)
      const updateResult = await client.query(
        `
        UPDATE suppliers
        SET name = $2, contact_name = $3, phone = $4, email = $5, currency = $6,
            is_active = COALESCE($7, is_active)
        WHERE id = $1
        RETURNING id, name, contact_name, phone, email, currency, is_active, created_at
        `,
        [
          body.id,
          body.name.trim(),
          body.contactName?.trim() || null,
          body.phone?.trim() || null,
          body.email?.trim() || null,
          currency,
          body.isActive ?? null,
        ]
      );

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Поставщик с таким id не найден.' },
          { status: 404 }
        );
      }

      supplierRow = updateResult.rows[0];
    } else {
      // Новый поставщик — если isActive не передан, по умолчанию true
      // (использует DEFAULT true из schema.sql, поэтому здесь и не
      // указываем колонку явно, если значение не пришло)
      const insertResult = await client.query(
        `
        INSERT INTO suppliers (name, contact_name, phone, email, currency, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, contact_name, phone, email, currency, is_active, created_at
        `,
        [
          body.name.trim(),
          body.contactName?.trim() || null,
          body.phone?.trim() || null,
          body.email?.trim() || null,
          currency,
          body.isActive ?? true,
        ]
      );
      supplierRow = insertResult.rows[0];
    }

    const supplierId: string = supplierRow.id;

    let mapping: MappingResponse | null = null;
    if (body.mapping) {
      mapping = await upsertMapping(client, supplierId, body.mapping);
    }

    await client.query('COMMIT');

    const supplier: SupplierResponse = {
      id: supplierRow.id,
      name: supplierRow.name,
      contactName: supplierRow.contact_name,
      phone: supplierRow.phone,
      email: supplierRow.email,
      currency: supplierRow.currency,
      isActive: supplierRow.is_active,
      createdAt: supplierRow.created_at,
      // Свежесозданный/только что отредактированный поставщик мог
      // ещё не иметь загруженных товаров — точное значение вернёт
      // следующий GET /api/suppliers, здесь достаточно null
      lastSyncedAt: null,
      mapping,
    };

    return NextResponse.json(
      { success: true, supplier },
      { status: isUpdate ? 200 : 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при сохранении поставщика:', error);

    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось сохранить поставщика: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------
// GET /api/suppliers — список всех поставщиков с их маппингом
// ------------------------------------------------------------
export async function GET() {
  try {
    // Отдельный LEFT JOIN на подзапрос с MAX(products.updated_at) —
    // это и есть "когда последний раз загружали прайс" для каждого
    // поставщика. Считать это отдельным подзапросом (а не просто
    // JOIN products) важно: иначе строк поставщика было бы столько
    // же, сколько у него товаров, вместо ровно одной
    const result = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.contact_name,
        s.phone,
        s.email,
        s.currency,
        s.is_active,
        s.created_at,
        m.article_column,
        m.brand_column,
        m.name_column,
        m.price_column,
        m.stock_column,
        m.car_make_column,
        m.car_model_column,
        m.car_year_column,
        m.engine_volume_column,
        m.start_row,
        m.markup_percent,
        m.updated_at AS mapping_updated_at,
        p.last_synced_at
      FROM suppliers s
      LEFT JOIN supplier_excel_mappings m ON m.supplier_id = s.id
      LEFT JOIN (
        SELECT supplier_id, MAX(updated_at) AS last_synced_at
        FROM products
        GROUP BY supplier_id
      ) p ON p.supplier_id = s.id
      ORDER BY s.created_at DESC
    `);

    const suppliers: SupplierResponse[] = result.rows.map((row) => {
      const hasMapping = row.article_column !== null;

      return {
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        phone: row.phone,
        email: row.email,
        currency: row.currency,
        isActive: row.is_active,
        createdAt: row.created_at,
        lastSyncedAt: row.last_synced_at,
        mapping: hasMapping
          ? {
              article: row.article_column,
              brand: row.brand_column,
              name: row.name_column,
              price: row.price_column,
              stock: row.stock_column,
              carMake: row.car_make_column,
              carModel: row.car_model_column,
              carYear: row.car_year_column,
              engineVolume: row.engine_volume_column,
              startRow: row.start_row,
              markup: parseFloat(row.markup_percent),
              updatedAt: row.mapping_updated_at,
            }
          : null,
      };
    });

    return NextResponse.json({ success: true, suppliers });
  } catch (error) {
    console.error('Ошибка при получении списка поставщиков:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список поставщиков: ' + message },
      { status: 500 }
    );
  }
}
