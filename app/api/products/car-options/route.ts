// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/car-options
//
// Отдаёт списки значений для выпадающих списков экрана "Підбір за
// автомобілем" на витрине (components/StorefrontHome.tsx): реальные
// марки/годы/объёмы двигателя, которые ДЕЙСТВИТЕЛЬНО встречаются в
// каталоге прямо сейчас — а не произвольный текст, который покупатель
// мог бы напечатать сам. Так исключены и опечатки ("Тойота" вместо
// "Toyota"), и заведомо пустой поиск (марка, для которой в базе вообще
// нет ни одного товара).
//
// Списки СВЯЗАНЫ каскадом — год предлагается только среди марки, что
// уже выбрана, а объём двигателя — среди уже выбранных марки И года:
//
//   GET /api/products/car-options?field=make
//     -> все марки, для которых в каталоге есть хоть один товар
//
//   GET /api/products/car-options?field=year&make=Toyota
//     -> года, которые встречаются у товаров именно марки Toyota
//
//   GET /api/products/car-options?field=engineVolume&make=Toyota&year=2008
//     -> объёмы двигателя у товаров Toyota 2008 года
//
// field — обязательный параметр, один из: make, year, engineVolume.
// make/year — необязательные фильтры-предки в каскаде (year без make
// и engineVolume без make/year тоже работают, просто без сужения).
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

// Разрешённые значения field — и одновременно соответствие "имя
// параметра" -> "настоящее имя колонки в products" (колонку в SQL
// никогда нельзя подставлять из значения запроса напрямую, поэтому
// сверяемся с этой картой, а не доверяем строке из URL как есть)
const FIELD_TO_COLUMN: Record<string, string> = {
  make: 'car_make',
  year: 'car_year',
  engineVolume: 'engine_volume',
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const field = (searchParams.get('field') || '').trim();
    const column = FIELD_TO_COLUMN[field];

    if (!column) {
      return NextResponse.json(
        { error: `Параметр field должен быть одним из: ${Object.keys(FIELD_TO_COLUMN).join(', ')}.` },
        { status: 400 }
      );
    }

    const make = (searchParams.get('make') || '').trim();
    const year = (searchParams.get('year') || '').trim();

    // Каскад: year учитывает make (если оно передано), engineVolume
    // учитывает и make, и year. Условия/параметры собираются
    // динамически, как и в app/api/products/route.ts
    const conditions: string[] = [`${column} IS NOT NULL`, `${column} <> ''`];
    const values: unknown[] = [];

    if (field !== 'make' && make) {
      values.push(make);
      conditions.push(`car_make ILIKE $${values.length}`);
    }

    if (field === 'engineVolume' && year) {
      values.push(year);
      conditions.push(`car_year ILIKE $${values.length}`);
    }

    const result = await pool.query(
      `
      SELECT DISTINCT ${column} AS value
      FROM products
      WHERE ${conditions.join(' AND ')}
      ORDER BY value ASC
      `,
      values
    );

    const options: string[] = result.rows.map((row) => row.value);

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
