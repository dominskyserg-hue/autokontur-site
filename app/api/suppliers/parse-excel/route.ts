// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес запроса: POST /api/suppliers/parse-excel
//
// Что делает этот файл, по шагам:
//   1. Принимает Excel-файл поставщика, ID поставщика и настройки
//      маппинга колонок через multipart/form-data (FormData).
//   2. Читает файл через библиотеку "xlsx" (SheetJS) и разбирает
//      ВСЕ строки файла (без ограничения в 10 штук).
//   3. Чистит артикулы, считает розничные цены.
//   4. Сохраняет все товары в PostgreSQL пачками (Batch Insert),
//      используя Upsert: если товар с таким артикулом у этого
//      поставщика уже есть — обновляет его, если нет — создаёт.
//   5. Возвращает { success: true, addedCount, updatedCount }.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Pool, PoolClient } from 'pg';

// Библиотеки xlsx и pg используют Node.js API, поэтому роут должен
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

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

interface MappingSettings {
  article: string;   // колонка с артикулом (SKU), например "B"
  brand: string;      // колонка с брендом, например "C"
  name: string;         // колонка с названием детали, например "D"
  price: string;          // колонка с оптовой ценой поставщика, например "F"
  stock: string;            // колонка с остатком на складе, например "G"
  // Колонки с маркой/моделью авто — необязательны, не у каждого
  // поставщика в прайсе вообще есть такие колонки. Используются
  // для SEO-наполнения карточки товара (см. buildSeoFields ниже) И
  // для поиска "Підбір за автомобілем" на витрине (см.
  // app/api/products/route.ts) — на расчёт цены никак не влияют
  carMake?: string;
  carModel?: string;
  // Колонки с годом выпуска и объёмом двигателя авто — тоже
  // необязательны, нужны только для того же "Підбір за автомобілем"
  carYear?: string;
  engineVolume?: string;
  startRow: number;           // с какой строки файла начинаются данные (1 = первая строка)
  markup: number;               // наценка в процентах, например 20 означает "+20%"
}

interface ParsedProduct {
  article: string;
  brand: string;
  name: string;
  carMake: string;
  carModel: string;
  carYear: string;
  engineVolume: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  supplierPrice: number;
  retailPrice: number;
  stock: number;
}

// Местная валюта — украинская гривна. Тот же код, что и
// DEFAULT_CURRENCY в app/api/suppliers/route.ts. Для неё курс всегда
// считается равным 1.0 прямо здесь, в коде, а не в базе
const LOCAL_CURRENCY = 'UAH';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Переводит букву колонки Excel ("A", "B", ... "AA") ИЛИ номер
// колонки ("1", "2", ...) в индекс массива с отсчётом от нуля.
function columnToIndex(value: string): number {
  const clean = value.trim().toUpperCase();

  if (/^[0-9]+$/.test(clean)) {
    return parseInt(clean, 10) - 1;
  }

  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i) - 64; // код символа 'A' равен 65, значит A -> 1
    index = index * 26 + code;
  }
  return index - 1;
}

// Очищает артикул от лишних пробелов, дефисов и спецсимволов,
// приводит к верхнему регистру
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

// ------------------------------------------------------------
// SEO-НАПОЛНЕНИЕ КАРТОЧКИ ТОВАРА: slug, meta_title, meta_description
// ------------------------------------------------------------
// Заполняются автоматически при КАЖДОЙ загрузке прайса — вручную
// прописывать это для тысяч товаров из Excel нереально. Расчёт на
// то, что человек ищет деталь так: "втулка стабилизатора на тойоту",
// поэтому марка/модель авто (если поставщик их присылает) — такая
// же часть SEO-текста, как название, бренд и артикул

// Таблица транслитерации кириллицы (рус. + укр.) в латиницу — для
// slug (адреса страницы), где кириллица недопустима
const TRANSLIT_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ё: 'e',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh',
  ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e',
  ю: 'iu', я: 'ia',
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((char) => (char in TRANSLIT_MAP ? TRANSLIT_MAP[char] : char))
    .join('');
}

// Собирает ЧПУ-адрес из кусочков текста: транслитерирует кириллицу,
// оставляет только латинские буквы/цифры, разделяет дефисом
function slugify(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => transliterate(part.trim()))
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface SeoFields {
  slug: string;
  metaTitle: string;
  metaDescription: string;
}

// name/brand — то, как их прислал поставщик (без лишней очистки, в
// отличие от article); carMake/carModel/carYear/engineVolume — тоже
// "как есть", их нормализация (регистр и т.п.) — забота
// администратора при вводе колонки, здесь только собираем текст
function buildSeoFields(
  article: string,
  brand: string,
  name: string,
  carMake: string,
  carModel: string,
  carYear: string,
  engineVolume: string
): SeoFields {
  const partTitle = name || article;
  // Год и объём двигателя добавляются в СКОБКАХ после марки/модели —
  // "Toyota Camry (2008, 2.0)" — а не наравне с ними: это уточнение,
  // а не основной признак, по которому покупатель обычно ищет деталь
  const carBase = [carMake, carModel].filter(Boolean).join(' ');
  const carDetails = [carYear, engineVolume].filter(Boolean).join(', ');
  // Уточнение в скобках имеет смысл, только если уже есть марка/модель —
  // "(2008, 2.0)" само по себе, без "Toyota Camry" перед ним, ничего
  // покупателю не скажет
  const carSuffix = carBase + (carBase && carDetails ? ` (${carDetails})` : '');

  const slug = slugify([partTitle, brand, carMake, carModel, carYear, engineVolume, article]);

  const metaTitleParts = [partTitle, carSuffix ? `на ${carSuffix}` : '', brand, `артикул ${article}`].filter(
    Boolean
  );
  const metaTitle = metaTitleParts.join(' — ');

  const metaDescriptionParts = [
    `${partTitle}${carSuffix ? ` для ${carSuffix}` : ''}`,
    brand ? `бренд ${brand}` : '',
    `артикул ${article}`,
  ].filter(Boolean);
  const metaDescription = metaDescriptionParts.join(', ') + '. Купить с доставкой.';

  return { slug, metaTitle, metaDescription };
}

function parseCellNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return 0;

  const cleaned = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// exchangeRate — курс валюты поставщика к местной валюте
function parseExcelBuffer(buffer: Buffer, mapping: MappingSettings, exchangeRate: number): ParsedProduct[] {
  if (!mapping.article || !mapping.price) {
    throw new Error('Не указаны колонки "Артикул" и/или "Цена поставщика"');
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('В файле не найдено ни одного листа');
  }
  const sheet = workbook.Sheets[firstSheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  const articleIdx = columnToIndex(mapping.article);
  const brandIdx = mapping.brand ? columnToIndex(mapping.brand) : -1;
  const nameIdx = mapping.name ? columnToIndex(mapping.name) : -1;
  const priceIdx = columnToIndex(mapping.price);
  const stockIdx = mapping.stock ? columnToIndex(mapping.stock) : -1;
  const carMakeIdx = mapping.carMake ? columnToIndex(mapping.carMake) : -1;
  const carModelIdx = mapping.carModel ? columnToIndex(mapping.carModel) : -1;
  const carYearIdx = mapping.carYear ? columnToIndex(mapping.carYear) : -1;
  const engineVolumeIdx = mapping.engineVolume ? columnToIndex(mapping.engineVolume) : -1;

  const startIndex = Math.max(0, (mapping.startRow || 1) - 1);
  const markup = mapping.markup || 0;

  const products: ParsedProduct[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawArticle = row[articleIdx];
    const rawBrand = brandIdx >= 0 ? row[brandIdx] : '';
    const rawName = nameIdx >= 0 ? row[nameIdx] : '';
    const rawPrice = row[priceIdx];
    const rawStock = stockIdx >= 0 ? row[stockIdx] : '';
    const rawCarMake = carMakeIdx >= 0 ? row[carMakeIdx] : '';
    const rawCarModel = carModelIdx >= 0 ? row[carModelIdx] : '';
    const rawCarYear = carYearIdx >= 0 ? row[carYearIdx] : '';
    const rawEngineVolume = engineVolumeIdx >= 0 ? row[engineVolumeIdx] : '';

    const article = cleanArticle(rawArticle);
    const brand = String(rawBrand ?? '').trim();
    const name = String(rawName ?? '').trim();
    const carMake = String(rawCarMake ?? '').trim();
    const carModel = String(rawCarModel ?? '').trim();
    // Год и объём двигателя — тоже просто текст (не число): в
    // прайсах год иногда идёт диапазоном ("2005-2010"), а объём —
    // с дробной частью или обозначением топлива ("2.0 TDI"), поэтому
    // приводить их к числу здесь не нужно и даже вредно
    const carYear = String(rawCarYear ?? '').trim();
    const engineVolume = String(rawEngineVolume ?? '').trim();
    const priceInSupplierCurrency = parseCellNumber(rawPrice);
    // products.stock — колонка INTEGER (остаток считается целыми
    // штуками детали), а в реальных прайсах в колонке остатка
    // иногда встречаются дробные значения — то ли артефакт формулы
    // у поставщика, то ли единицы измерения перепутаны с количеством.
    // Округляем до целого здесь же, при разборе файла: без этого
    // INSERT в products падал бы целиком с ошибкой Postgres
    // "invalid input syntax for type integer", и НИ ОДНА строка
    // прайса не сохранялась бы из-за одного дробного остатка
    const stock = Math.round(parseCellNumber(rawStock));

    if (!article && !priceInSupplierCurrency) continue;

    // Шаг 1: переводим цену из валюты поставщика в местную валюту
    const supplierPrice = Math.round(priceInSupplierCurrency * exchangeRate * 100) / 100;

    // Шаг 2: сверху накидываем наценку
    const retailPrice = Math.round(supplierPrice * (1 + markup / 100) * 100) / 100;

    // Шаг 3: SEO-наполнение карточки — slug и мета-теги, собранные
    // из названия/бренда/марки-модели-года-объёма авто/артикула
    // (см. buildSeoFields)
    const { slug, metaTitle, metaDescription } = buildSeoFields(
      article,
      brand,
      name,
      carMake,
      carModel,
      carYear,
      engineVolume
    );

    products.push({
      article,
      brand,
      name,
      carMake,
      carModel,
      carYear,
      engineVolume,
      slug,
      metaTitle,
      metaDescription,
      supplierPrice,
      retailPrice,
      stock,
    });
  }

  return products;
}

// Если в самом прайс-листе поставщика один и тот же артикул
// случайно встречается несколько раз, оставляем только последнюю
// строку с ним
function deduplicateByArticle(products: ParsedProduct[]): ParsedProduct[] {
  const byArticle = new Map<string, ParsedProduct>();
  for (const product of products) {
    byArticle.set(product.article, product);
  }
  return Array.from(byArticle.values());
}

const BATCH_SIZE = 500;

interface UpsertResult {
  addedCount: number;
  updatedCount: number;
}

async function upsertBatch(
  client: PoolClient,
  supplierId: string,
  batch: ParsedProduct[]
): Promise<UpsertResult> {
  const values: unknown[] = [];
  const rowsSql: string[] = [];

  // 14 значений на строку: supplier_id, article, brand, name,
  // cost_price, retail_price, stock, car_make, car_model, car_year,
  // engine_volume, slug, meta_title, meta_description
  const COLUMNS_PER_ROW = 14;

  batch.forEach((product, i) => {
    const base = i * COLUMNS_PER_ROW;
    const placeholders = Array.from({ length: COLUMNS_PER_ROW }, (_, j) => `$${base + j + 1}`).join(', ');
    rowsSql.push(`(${placeholders})`);
    values.push(
      supplierId,
      product.article,
      product.brand,
      product.name,
      product.supplierPrice,
      product.retailPrice,
      product.stock,
      product.carMake || null,
      product.carModel || null,
      product.carYear || null,
      product.engineVolume || null,
      product.slug,
      product.metaTitle,
      product.metaDescription
    );
  });

  // meta_title, slug, car_make/car_model/car_year/engine_volume
  // обновляются всегда вместе с остальными данными товара при новой
  // загрузке прайса. meta_description — ИСКЛЮЧЕНИЕ: обновляется,
  // ТОЛЬКО если админ не переписал его вручную на экране "Товары"
  // (products.meta_description_override = false у уже существующей
  // строки) — иначе повторная загрузка прайса стирала бы ручную
  // SEO-правку. "products.meta_description" и
  // "products.meta_description_override" в CASE ниже — это значения
  // из УЖЕ СУЩЕСТВУЮЩЕЙ строки (до обновления), а не из EXCLUDED
  const query = `
    INSERT INTO products
      (supplier_id, article, brand, name, cost_price, retail_price, stock, car_make, car_model, car_year, engine_volume, slug, meta_title, meta_description)
    VALUES
      ${rowsSql.join(', ')}
    ON CONFLICT (supplier_id, article)
    DO UPDATE SET
      retail_price = EXCLUDED.retail_price,
      cost_price = EXCLUDED.cost_price,
      name = EXCLUDED.name,
      brand = EXCLUDED.brand,
      stock = EXCLUDED.stock,
      car_make = EXCLUDED.car_make,
      car_model = EXCLUDED.car_model,
      car_year = EXCLUDED.car_year,
      engine_volume = EXCLUDED.engine_volume,
      slug = EXCLUDED.slug,
      meta_title = EXCLUDED.meta_title,
      meta_description = CASE
        WHEN products.meta_description_override THEN products.meta_description
        ELSE EXCLUDED.meta_description
      END,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;

  const result = await client.query(query, values);

  let addedCount = 0;
  let updatedCount = 0;
  for (const row of result.rows) {
    if (row.inserted) {
      addedCount++;
    } else {
      updatedCount++;
    }
  }

  return { addedCount, updatedCount };
}

async function saveProductsToDatabase(
  supplierId: string,
  products: ParsedProduct[]
): Promise<UpsertResult> {
  const client = await pool.connect();

  let addedCount = 0;
  let updatedCount = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const batchResult = await upsertBatch(client, supplierId, batch);
      addedCount += batchResult.addedCount;
      updatedCount += batchResult.updatedCount;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { addedCount, updatedCount };
}

// ------------------------------------------------------------
// ОБРАБОТЧИК POST-ЗАПРОСА
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    const mappingRaw = formData.get('mapping');
    const supplierId = formData.get('supplierId');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не найден в запросе. Ожидается поле "file".' },
        { status: 400 }
      );
    }

    if (!supplierId || typeof supplierId !== 'string') {
      return NextResponse.json(
        { error: 'Не передан ID поставщика (поле "supplierId").' },
        { status: 400 }
      );
    }

    if (!isValidUuid(supplierId)) {
      return NextResponse.json(
        { error: 'ID поставщика должен быть корректным UUID.' },
        { status: 400 }
      );
    }

    if (!mappingRaw || typeof mappingRaw !== 'string') {
      return NextResponse.json(
        { error: 'Не переданы настройки маппинга (поле "mapping").' },
        { status: 400 }
      );
    }

    let mapping: MappingSettings;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json(
        { error: 'Настройки маппинга должны быть корректным JSON.' },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // ВАЛЮТА ПОСТАВЩИКА И ЕЁ ГЛОБАЛЬНЫЙ КУРС
    // ------------------------------------------------------------
    const supplierResult = await pool.query(
      'SELECT currency FROM suppliers WHERE id = $1',
      [supplierId]
    );

    if (supplierResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Поставщик с таким id не найден.' },
        { status: 404 }
      );
    }

    const supplierCurrency: string = supplierResult.rows[0].currency;

    let exchangeRate: number;
    if (supplierCurrency === LOCAL_CURRENCY) {
      exchangeRate = 1.0;
    } else {
      const rateResult = await pool.query(
        'SELECT rate FROM global_exchange_rates WHERE currency = $1',
        [supplierCurrency]
      );

      if (rateResult.rows.length === 0) {
        return NextResponse.json(
          {
            error:
              `Для валюты ${supplierCurrency} ещё не задан глобальный курс. ` +
              'Откройте виджет "Глобальные курсы валют" и укажите его перед загрузкой прайс-листа.',
          },
          { status: 400 }
        );
      }

      exchangeRate = parseFloat(rateResult.rows[0].rate);
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимальный размер — 10 МБ.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const allProducts = parseExcelBuffer(buffer, mapping, exchangeRate);

    if (allProducts.length === 0) {
      return NextResponse.json(
        { error: 'В файле не найдено ни одной строки с данными. Проверьте настройки маппинга.' },
        { status: 400 }
      );
    }

    const uniqueProducts = deduplicateByArticle(allProducts);

    const { addedCount, updatedCount } = await saveProductsToDatabase(supplierId, uniqueProducts);

    return NextResponse.json({
      success: true,
      addedCount,
      updatedCount,
    });
  } catch (error) {
    console.error('Ошибка при обработке и сохранении Excel-файла поставщика:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обработать файл: ' + message },
      { status: 500 }
    );
  }
}
