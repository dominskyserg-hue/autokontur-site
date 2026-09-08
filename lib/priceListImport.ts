// ============================================================
// ОБЩАЯ ЛОГИКА РАЗБОРА И СОХРАНЕНИЯ ПРАЙС-ЛИСТА ПОСТАВЩИКА.
//
// Раньше весь этот код жил ТОЛЬКО внутри
// app/api/suppliers/parse-excel/route.ts и использовался, когда
// администратор вручную выбирал файл в браузере и нажимал "Загрузить
// прайс". Теперь тот же самый разбор нужен ещё и автозагрузке по email
// (см. lib/emailPriceImport.ts) — письмо от поставщика приходит без
// участия администратора, но Excel-вложение из него нужно разобрать и
// сохранить ТОЧНО ТАК ЖЕ (тот же маппинг колонок, тот же расчёт цены,
// то же SEO-наполнение карточки). Поэтому вся логика "разбор буфера
// Excel-файла → готовые товары → сохранение в базу" вынесена сюда,
// в общий модуль, а parse-excel/route.ts и emailPriceImport.ts оба
// вызывают одни и те же функции — вместо двух копий одного и того же
// кода, которые рано или поздно разошлись бы (поправили одну, забыли
// про другую).
// ============================================================

import * as XLSX from 'xlsx';
import { Pool, PoolClient } from 'pg';
import { getCategoryBySlug, productMatchesCategory } from '@/lib/categories';

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

export interface MappingSettings {
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
  // Колонка со ссылкой на фото товара — если поставщик присылает
  // прямые ссылки на фото в прайсе. Необязательная: без неё фото
  // по-прежнему ищется автоматически (см. lib/productImagePipeline.ts).
  // Если колонка указана и в строке есть ссылка — она считается более
  // надёжной, чем найденная автопоиском, и подставляется в
  // products.image_url (см. upsertBatch ниже)
  image?: string;
  startRow: number;           // с какой строки файла начинаются данные (1 = первая строка)
  markup: number;               // наценка в процентах, например 20 означает "+20%"
}

export interface ParsedProduct {
  article: string;
  brand: string;
  name: string;
  carMake: string;
  carModel: string;
  carYear: string;
  engineVolume: string;
  imageUrl: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  supplierPrice: number;
  retailPrice: number;
  discountPercent: number;
  stock: number;
}

// ------------------------------------------------------------
// ПРАВИЛА НАЦЕНКИ/СКИДКИ ПО ФИЛЬТРУ (supplier_markup_rules)
// ------------------------------------------------------------
// Дополнение к обычной единой наценке поставщика (mapping.markup) —
// см. app/api/suppliers/[id]/markup-rules/route.ts. У поставщика может
// быть несколько таких правил; здесь — только их ПРИМЕНЕНИЕ при разборе
// прайса, само хранение и CRUD живут в markup-rules/route.ts
export interface MarkupRule {
  brand: string | null;
  categorySlug: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  discountPercent: number;
  markupPercent: number;
}

// Возвращает наценку/скидку ПЕРВОГО правила, под которое подходит
// товар (порядок массива rules — порядок создания правил, тот же, в
// котором их отдаёт GET .../markup-rules), либо наценку поставщика по
// умолчанию (defaultMarkup) без скидки, если ни одно правило не подошло
function resolveMarkupAndDiscount(
  rules: MarkupRule[],
  brand: string,
  name: string,
  priceInLocalCurrency: number,
  defaultMarkup: number
): { markup: number; discount: number } {
  for (const rule of rules) {
    if (rule.brand && rule.brand !== brand.toUpperCase()) continue;
    if (rule.categorySlug) {
      const category = getCategoryBySlug(rule.categorySlug);
      // Категория могла быть удалена из lib/categories.ts после того,
      // как правило уже создали — тогда это правило больше никогда не
      // подходит ни одному товару (безопасное поведение по умолчанию)
      if (!category || !productMatchesCategory(category, name)) continue;
    }
    if (rule.priceFrom !== null && priceInLocalCurrency < rule.priceFrom) continue;
    if (rule.priceTo !== null && priceInLocalCurrency > rule.priceTo) continue;

    return { markup: rule.markupPercent, discount: rule.discountPercent };
  }

  return { markup: defaultMarkup, discount: 0 };
}

// Местная валюта — украинская гривна. Для неё курс всегда считается
// равным 1.0 прямо здесь, в коде, а не в базе
export const LOCAL_CURRENCY = 'UAH';

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
  engineVolume: string,
  stock: number
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

  const brandArticle = [brand, article].filter(Boolean).join(' ');
  const stockPart = stock > 0 ? 'В наявності' : 'Під замовлення';
  const metaDescription = `${brandArticle}${partTitle !== article ? ' — ' + partTitle : ''}${
    carSuffix ? ` для ${carSuffix}` : ''
  }. ${stockPart}, доставка по Україні, оплата при отриманні.`;

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
export function parseExcelBuffer(
  buffer: Buffer,
  mapping: MappingSettings,
  exchangeRate: number,
  markupRules: MarkupRule[]
): ParsedProduct[] {
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
  const imageIdx = mapping.image ? columnToIndex(mapping.image) : -1;

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
    const rawImage = imageIdx >= 0 ? row[imageIdx] : '';

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
    const imageUrl = String(rawImage ?? '').trim();
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

    // Шаг 2: смотрим, подходит ли товар под одно из правил наценки
    // поставщика (бренд/категория/диапазон цены) — если да, берём
    // наценку И скидку ИЗ ПРАВИЛА вместо обычной наценки поставщика
    const { markup: effectiveMarkup, discount: effectiveDiscount } = resolveMarkupAndDiscount(
      markupRules,
      brand,
      name,
      supplierPrice,
      markup
    );

    // Шаг 3: сверху накидываем наценку, затем — если сработало
    // правило со скидкой — вычитаем её из уже готовой цены. Скидка
    // применяется ПОСЛЕ наценки: она про то, что видит покупатель на
    // витрине (зачёркнутая старая цена + "-8%"), а не про то, как
    // считается сама наценка
    const priceWithMarkup = Math.round(supplierPrice * (1 + effectiveMarkup / 100) * 100) / 100;
    const retailPrice = Math.round(priceWithMarkup * (1 - effectiveDiscount / 100) * 100) / 100;

    // Шаг 4: SEO-наполнение карточки — slug и мета-теги, собранные
    // из названия/бренда/марки-модели-года-объёма авто/артикула
    // (см. buildSeoFields)
    const { slug, metaTitle, metaDescription } = buildSeoFields(
      article,
      brand,
      name,
      carMake,
      carModel,
      carYear,
      engineVolume,
      stock
    );

    products.push({
      article,
      brand,
      name,
      carMake,
      carModel,
      carYear,
      engineVolume,
      imageUrl,
      slug,
      metaTitle,
      metaDescription,
      supplierPrice,
      retailPrice,
      discountPercent: effectiveDiscount,
      stock,
    });
  }

  return products;
}

// Если в самом прайс-листе поставщика один и тот же артикул
// случайно встречается несколько раз, оставляем только последнюю
// строку с ним
export function deduplicateByArticle(products: ParsedProduct[]): ParsedProduct[] {
  const byArticle = new Map<string, ParsedProduct>();
  for (const product of products) {
    byArticle.set(product.article, product);
  }
  return Array.from(byArticle.values());
}

const BATCH_SIZE = 500;

export interface UpsertResult {
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

  // 16 значений на строку: supplier_id, article, brand, name,
  // cost_price, retail_price, discount_percent, stock, car_make,
  // car_model, car_year, engine_volume, image_url, slug, meta_title,
  // meta_description
  const COLUMNS_PER_ROW = 16;

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
      product.discountPercent,
      product.stock,
      product.carMake || null,
      product.carModel || null,
      product.carYear || null,
      product.engineVolume || null,
      product.imageUrl || null,
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
  // из УЖЕ СУЩЕСТВУЮЩЕЙ строки (до обновления), а не из EXCLUDED.
  // image_url — ЕЩЁ ОДНО исключение, но в обратную сторону: если в
  // этой загрузке прайса колонка с фото не заполнена для строки
  // (EXCLUDED.image_url = NULL), СОХРАНЯЕМ уже имеющееся фото
  // товара (найденное ранее автопоиском или загруженное вручную), а
  // не затираем его пустотой. Если же поставщик прислал ссылку —
  // она подставляется как более надёжная, перекрывая и автонайденное,
  // и ранее указанную ссылку
  const query = `
    INSERT INTO products
      (supplier_id, article, brand, name, cost_price, retail_price, discount_percent, stock, car_make, car_model, car_year, engine_volume, image_url, slug, meta_title, meta_description)
    VALUES
      ${rowsSql.join(', ')}
    ON CONFLICT (supplier_id, article)
    DO UPDATE SET
      retail_price = EXCLUDED.retail_price,
      discount_percent = EXCLUDED.discount_percent,
      cost_price = EXCLUDED.cost_price,
      name = EXCLUDED.name,
      brand = EXCLUDED.brand,
      stock = EXCLUDED.stock,
      car_make = EXCLUDED.car_make,
      car_model = EXCLUDED.car_model,
      car_year = EXCLUDED.car_year,
      engine_volume = EXCLUDED.engine_volume,
      image_url = COALESCE(EXCLUDED.image_url, products.image_url),
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

export async function saveProductsToDatabase(
  pool: Pool,
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
// КУРС ВАЛЮТЫ ПОСТАВЩИКА
// ------------------------------------------------------------
// Бросает Error с понятным для администратора текстом, если для
// иностранной валюты поставщика ещё не задан глобальный курс —
// и parse-excel/route.ts, и emailPriceImport.ts ловят эту ошибку
// одинаково (см. их try/catch)
export async function getExchangeRateForCurrency(pool: Pool, currency: string): Promise<number> {
  if (currency === LOCAL_CURRENCY) return 1.0;

  const rateResult = await pool.query('SELECT rate FROM global_exchange_rates WHERE currency = $1', [
    currency,
  ]);

  if (rateResult.rows.length === 0) {
    throw new Error(
      `Для валюты ${currency} ещё не задан глобальный курс. ` +
        'Откройте виджет "Глобальные курсы валют" в Настройках и укажите его перед загрузкой прайс-листа.'
    );
  }

  return parseFloat(rateResult.rows[0].rate);
}

// ------------------------------------------------------------
// ПРАВИЛА НАЦЕНКИ/СКИДКИ ПОСТАВЩИКА (supplier_markup_rules)
// ------------------------------------------------------------
// Только АКТИВНЫЕ, по порядку создания — тот же порядок, в котором
// их отдаёт GET .../markup-rules, и в котором их проверяет
// resolveMarkupAndDiscount (первое подошедшее правило выигрывает)
export async function getActiveMarkupRules(pool: Pool, supplierId: string): Promise<MarkupRule[]> {
  const rulesResult = await pool.query(
    `
    SELECT brand, category_slug, price_from, price_to, discount_percent, markup_percent
    FROM supplier_markup_rules
    WHERE supplier_id = $1 AND is_active = true
    ORDER BY created_at ASC
    `,
    [supplierId]
  );
  return rulesResult.rows.map((row) => ({
    brand: row.brand,
    categorySlug: row.category_slug,
    priceFrom: row.price_from === null ? null : parseFloat(row.price_from),
    priceTo: row.price_to === null ? null : parseFloat(row.price_to),
    discountPercent: parseFloat(row.discount_percent),
    markupPercent: parseFloat(row.markup_percent),
  }));
}

// ------------------------------------------------------------
// ВСЁ ВМЕСТЕ: разобрать буфер Excel-файла поставщика и сохранить
// ------------------------------------------------------------
// Собирает шаги выше в одну функцию: узнать курс валюты поставщика,
// подтянуть его правила наценки, разобрать файл и сохранить товары.
// Использует и app/api/suppliers/parse-excel/route.ts (ручная загрузка
// из браузера), и lib/emailPriceImport.ts (автозагрузка из письма) —
// оба уже знают supplierId и currency поставщика заранее
export async function importPriceListForSupplier(
  pool: Pool,
  supplierId: string,
  supplierCurrency: string,
  mapping: MappingSettings,
  buffer: Buffer
): Promise<UpsertResult & { productsFound: number }> {
  const exchangeRate = await getExchangeRateForCurrency(pool, supplierCurrency);
  const markupRules = await getActiveMarkupRules(pool, supplierId);

  const allProducts = parseExcelBuffer(buffer, mapping, exchangeRate, markupRules);
  if (allProducts.length === 0) {
    throw new Error('В файле не найдено ни одной строки с данными. Проверьте настройки маппинга.');
  }

  const uniqueProducts = deduplicateByArticle(allProducts);
  const { addedCount, updatedCount } = await saveProductsToDatabase(pool, supplierId, uniqueProducts);

  return { addedCount, updatedCount, productsFound: uniqueProducts.length };
}
