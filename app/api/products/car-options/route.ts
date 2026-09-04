// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/car-options
//
// Отдаёт списки значений для выпадающих списков экрана "Підбір за
// автомобілем" на витрине (components/StorefrontHome.tsx) — марка,
// модель, год, объём двигателя. Раньше все значения брались ТОЛЬКО из
// products.car_make/car_model/car_year — свободного текста, который
// вручную вписывает поставщик в Excel-прайсе (часто пусто или
// несогласованно). Теперь марка/модель/год ДОПОЛНИТЕЛЬНО берутся из
// tecdoc_compatibility (см. schema.sql, scripts/tecdoc/) — массового
// SEO-индекса из дампа TecDoc с точными диапазонами годов. Оба
// источника объединяются (не заменяют друг друга).
//
// ВАЖНО про марки: tecdoc_compatibility.make — это СЫРОЕ название
// производителя из дампа TecDoc, а он содержит ВСЕХ производителей
// (включая тракторы, мотоциклы, спецтехніку — напр. "AGCO", "AEBI",
// "VW (FAW)") — их там за 600 штук, и подавляющее большинство не имеет
// отношения к покупателю легкового авто на этом сайте. Поэтому в
// список марки попадают ТОЛЬКО те значения tecdoc, которые совпадают
// с курованим списком реальних марок каталогу (lib/carMakes.ts) —
// решта відкидається. Той самий курований довідник вирішує і зворотну
// задачу: одна марка може бути записана по-різному ("VW" і
// "VOLKSWAGEN", "MERCEDES" і "MERCEDES-BENZ") — щоб обраний покупцем
// варіант однаково знаходив рядки в обох джерелах, порівняння марки
// завжди йде через resolveMakeDbValues() (усі варіанти написання
// одразу), а не буквальним текстом.
//
//   GET /api/products/car-options?field=make
//     -> усі марки: products.car_make (як є) ∪ tecdoc-марки, звірені
//        з lib/carMakes.ts
//
//   GET /api/products/car-options?field=model&make=Toyota
//     -> моделі саме цієї марки — ЛИШЕ з tecdoc_compatibility.model,
//        НОВЕ поле, якого раніше не було зовсім. products.car_model
//        свідомо НЕ використовується як джерело: на практиці там не
//        назви моделей, а довільний текст постачальника (коди
//        двигунів на кшталт "1AZ-FE", назви мастил тощо) — перевірено
//        емпірично на реальних даних каталогу, домішувати це до
//        списку моделей — тільки сміття
//
//   GET /api/products/car-options?field=year&make=Toyota&model=...
//     -> роки саме цієї марки (+моделі, якщо передана): products.car_year
//        як є, плюс КОЖЕН окремий рік з діапазонів
//        tecdoc_compatibility.year_from..year_to (generate_series)
//
//   GET /api/products/car-options?field=engineVolume&make=Toyota&year=2008
//     -> об'єми двигуна у товарів Toyota 2008 року: products.engine_volume
//        (власне поле товару) ∪ tecdoc_compatibility.engine (об'єм
//        КОНКРЕТНОЇ модифікації з дампа TecDoc — types.TYP_LITRES/
//        TYP_CCM, див. scripts/tecdoc/import-dump.ts)
//
// field — обязательный параметр: make, model, year, engineVolume.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCarMakeByDbValue, resolveMakeDbValues } from '@/lib/carMakes';

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
    max: 3,
  });

globalThis.pgPool = pool;

const VALID_FIELDS = ['make', 'model', 'year', 'engineVolume'] as const;
type Field = (typeof VALID_FIELDS)[number];

function isValidField(value: string): value is Field {
  return (VALID_FIELDS as readonly string[]).includes(value);
}

// Об'єднує кілька списків значень РЕГІСТРОНЕЗАЛЕЖНО (щоб однакові за
// змістом значення не потрапили в спадний список ДВІЧІ) — перший
// знайдений варіант написання лишається як відображуваний, він же йде
// першим у пріоритеті переданих масивів
function dedupeCaseInsensitive(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const list of lists) {
    for (const value of list) {
      const key = value.toUpperCase();
      if (!seen.has(key)) seen.set(key, value);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'uk'));
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const field = (searchParams.get('field') || '').trim();
    if (!isValidField(field)) {
      return NextResponse.json(
        { error: `Параметр field должен быть одним из: ${VALID_FIELDS.join(', ')}.` },
        { status: 400 }
      );
    }

    const make = (searchParams.get('make') || '').trim();
    const model = (searchParams.get('model') || '').trim();
    const year = (searchParams.get('year') || '').trim();

    // ---- МАРКА ----
    if (field === 'make') {
      const [productsResult, tecdocResult] = await Promise.all([
        pool.query(`SELECT DISTINCT car_make AS value FROM products WHERE car_make IS NOT NULL AND car_make <> ''`),
        pool.query(`SELECT DISTINCT make AS value FROM tecdoc_compatibility`),
      ]);

      // tecdoc — беремо ЛИШЕ ті значення, які впізнані як реальна
      // легкова марка з курованого довідника (lib/carMakes.ts).
      // Нерозпізнані (трактори, спецтехніка тощо) відкидаємо повністю —
      // інакше список маркою роздувається до 600+ пунктів сміття
      const tecdocMakes = tecdocResult.rows
        .map((row) => getCarMakeByDbValue(row.value as string)?.name)
        .filter((name): name is string => Boolean(name));

      // products — показуємо куровану назву, якщо марка впізнана
      // (щоб "MERCEDES" з прайсу і "Mercedes-Benz" з tecdoc злились в
      // один пункт списку), інакше — як є (некурована, але реальна
      // марка з інвентарю, її не відкидаємо)
      const productMakes = productsResult.rows.map(
        (row) => getCarMakeByDbValue(row.value as string)?.name || (row.value as string)
      );

      // tecdocMakes іде ПЕРШИМ у пріоритеті — курована назва краще за
      // сирий текст постачальника при збігу написання
      const options = dedupeCaseInsensitive(tecdocMakes, productMakes);
      return NextResponse.json({ success: true, options });
    }

    // Марка, обрана покупцем (курована назва АБО сире значення з
    // products.car_make), — приводимо до всіх варіантів написання одразу,
    // щоб однаково знайти рядки і в products, і в tecdoc_compatibility
    const makeDbValues = make ? resolveMakeDbValues(make) : [];

    // ---- МОДЕЛЬ (нове поле) ----
    if (field === 'model') {
      if (!make) {
        return NextResponse.json({ error: 'Для поля model потрібно передати make.' }, { status: 400 });
      }

      const tecdocResult = await pool.query(
        `SELECT DISTINCT model AS value FROM tecdoc_compatibility WHERE UPPER(make) = ANY($1::text[]) AND model <> ''`,
        [makeDbValues]
      );

      const options = dedupeCaseInsensitive(tecdocResult.rows.map((row) => row.value as string));
      return NextResponse.json({ success: true, options });
    }

    // ---- РІК ----
    if (field === 'year') {
      if (!make) {
        return NextResponse.json({ success: true, options: [] });
      }

      const [productsResult, tecdocResult] = await Promise.all([
        pool.query(
          `SELECT DISTINCT car_year AS value FROM products WHERE UPPER(car_make) = ANY($1::text[]) AND car_year IS NOT NULL AND car_year <> ''`,
          [makeDbValues]
        ),
        // generate_series розгортає КОЖЕН діапазон [year_from, year_to]
        // в окремі роки — покупець обирає САМЕ РІК свого авто, а не
        // "діапазон", тому список має бути з конкретних років.
        // year_to NULL (модель ще випускається) обмежуємо поточним
        // роком+1, щоб не породжувати нескінченний список
        pool.query(
          `
          SELECT DISTINCT year::text AS value
          FROM tecdoc_compatibility tc,
               LATERAL generate_series(
                 COALESCE(tc.year_from, 1980),
                 LEAST(COALESCE(tc.year_to, EXTRACT(YEAR FROM now())::int + 1), EXTRACT(YEAR FROM now())::int + 1)
               ) AS year
          WHERE UPPER(tc.make) = ANY($1::text[]) AND ($2 = '' OR tc.model = $2)
          `,
          [makeDbValues, model]
        ),
      ]);

      const options = dedupeCaseInsensitive(
        tecdocResult.rows.map((row) => row.value as string),
        productsResult.rows.map((row) => row.value as string)
      );
      // Роки — сортуємо як числа (рядковий localeCompare теж дав би
      // правильний порядок для 4-значних років, але явний numeric
      // порядок надійніший, якщо колись трапиться щось на кшталт "2005-2010")
      options.sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
      return NextResponse.json({ success: true, options });
    }

    // ---- ОБ'ЄМ ДВИГУНА ----
    // Два джерела, як марка/рік вище: products.engine_volume (власне
    // поле товару — часто порожнє) ∪ tecdoc_compatibility.engine (об'єм
    // КОНКРЕТНОЇ модифікації авто з дампа TecDoc — types.TYP_LITRES/
    // TYP_CCM, див. scripts/tecdoc/import-dump.ts). Перше джерело
    // додатково шукає товар за маркою/роком і БЕЗ власних car_make/
    // car_year — через EXISTS по tecdoc_compatibility (join по
    // brand+article), так само, як в основному пошуку
    // (app/api/products/route.ts) — без цього об'єм двигуна товару,
    // знайденого лише через TecDoc, у списку не з'являвся б
    const ownConditions: string[] = [`p.engine_volume IS NOT NULL`, `p.engine_volume <> ''`];
    const ownValues: unknown[] = [];

    if (make || year) {
      const ownParts: string[] = [];
      if (make) {
        ownValues.push(makeDbValues);
        ownParts.push(`UPPER(p.car_make) = ANY($${ownValues.length}::text[])`);
      }
      if (year) {
        ownValues.push(year);
        ownParts.push(`p.car_year ILIKE $${ownValues.length}`);
      }
      const ownMatchSql = ownParts.join(' AND ');

      const tecdocParts: string[] = [];
      if (make) {
        ownValues.push(makeDbValues);
        tecdocParts.push(`UPPER(tc.make) = ANY($${ownValues.length}::text[])`);
      }
      if (year) {
        ownValues.push(year);
        tecdocParts.push(
          `$${ownValues.length}::int BETWEEN COALESCE(tc.year_from, 1900) AND COALESCE(tc.year_to, 2100)`
        );
      }
      const tecdocWhereSql = tecdocParts.length > 0 ? `AND ${tecdocParts.join(' AND ')}` : '';

      ownConditions.push(`(
        (${ownMatchSql})
        OR EXISTS (
          SELECT 1 FROM tecdoc_compatibility tc
          WHERE tc.brand = p.brand AND tc.article = p.article
          ${tecdocWhereSql}
        )
      )`);
    }

    const ownResultPromise = pool.query(
      `SELECT DISTINCT p.engine_volume AS value FROM products p WHERE ${ownConditions.join(' AND ')}`,
      ownValues
    );

    // Друге джерело — напряму з tecdoc_compatibility (той самий підхід,
    // що й для моделі/року вище): без фільтру по марці довелось би
    // сканувати всю таблицю, тому запитуємо лише коли марка передана
    // (на практиці з вітрини так і буває — вибір об'єму двигуна завжди
    // йде вже після марки й року, див. components/StorefrontHome.tsx)
    const tecdocResultPromise = make
      ? (() => {
          const tecdocConditions: string[] = [`engine <> ''`, `UPPER(make) = ANY($1::text[])`];
          const tecdocValues: unknown[] = [makeDbValues];
          if (year) {
            tecdocValues.push(year);
            tecdocConditions.push(
              `$${tecdocValues.length}::int BETWEEN COALESCE(year_from, 1900) AND COALESCE(year_to, 2100)`
            );
          }
          return pool.query(
            `SELECT DISTINCT engine AS value FROM tecdoc_compatibility WHERE ${tecdocConditions.join(' AND ')}`,
            tecdocValues
          );
        })()
      : Promise.resolve({ rows: [] as { value: string }[] });

    const [ownResult, tecdocResult] = await Promise.all([ownResultPromise, tecdocResultPromise]);

    const options = dedupeCaseInsensitive(
      ownResult.rows.map((row) => row.value as string),
      tecdocResult.rows.map((row) => row.value as string)
    );
    // Об'єм двигуна — сортуємо як числа (напр. "1.6" перед "2.0")
    options.sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));

    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error('Ошибка при получении списка значений для подбора по автомобилю:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список значений: ' + message },
      { status: 500 }
    );
  }
}
