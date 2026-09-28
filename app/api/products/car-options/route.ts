// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/car-options
//
// Отдаёт списки значений для выпадающих списков "Підбір за автомобілем"
// (components/StorefrontHome.tsx, фильтр на страницах категорий) — марка,
// модель, год, объём двигателя.
//
// Этап C перехода с TecDoc: tecdoc_compatibility здесь больше не читается.
//   field=make         -> марки из своей применимости (product_vehicles_own,
//                         lib/ownVehicles.ts); название — курированное
//                         (lib/carMakes.ts)
//   field=model&make=  -> модели этой марки из собственного словаря
//                         (lib/carModelDictionary.ts), как они лежат в
//                         product_vehicles_own. products.car_model как
//                         список не используется: там коды двигателей и
//                         прочий свободный текст поставщика
//   field=year&make=   -> только products.car_year (в своей применимости
//                         годов нет)
//   field=engineVolume -> только products.engine_volume
// Одна марка может быть записана по-разному ("VW" / "VOLKSWAGEN") — сравнение
// всегда через resolveMakeDbValues() / ownMakeSlugs(), а не буквальным текстом.
//
// field — обязательный параметр: make, model, year, engineVolume.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { CAR_MAKES, resolveMakeDbValues } from '@/lib/carMakes';
import { ownMakeSlugs } from '@/lib/ownVehicles';

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
// Название марки для списка по slug из product_vehicles_own: курированное
// имя (lib/carMakes.ts) или slug с заглавной буквы ("skoda" -> "Skoda")
function ownMakeDisplayName(slug: string): string {
  const curated = CAR_MAKES.find((m) => m.slug === slug);
  if (curated) return curated.name;
  return slug.replace(/(^|[-\s])\p{L}/gu, (c) => c.toUpperCase());
}

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
      // Этап C перехода с TecDoc: марки — только из своей применимости
      // (product_vehicles_own, lib/ownVehicles.ts). Сырое поле car_make как
      // список не используется: там встречаются бренды запчастей ("BOSCH",
      // "CTR") и прочий свободный текст; настоящие марки из car_make и так
      // попадают в свою применимость (источник price)
      const ownResult = await pool.query(`SELECT DISTINCT make AS value FROM product_vehicles_own`);
      const options = dedupeCaseInsensitive(ownResult.rows.map((row) => ownMakeDisplayName(row.value as string)));
      return NextResponse.json({ success: true, options });
    }

    const makeDbValues = make ? resolveMakeDbValues(make) : [];

    // ---- МОДЕЛЬ (нове поле) ----
    if (field === 'model') {
      if (!make) {
        return NextResponse.json({ error: 'Для поля model потрібно передати make.' }, { status: 400 });
      }
      // Модели — из собственного словаря (lib/carModelDictionary.ts), как
      // они лежат в product_vehicles_own. Фильтр сравнивает их по вхождению
      // (lib/vehicleFilter.ts)
      const ownResult = await pool.query(
        `SELECT DISTINCT model AS value FROM product_vehicles_own WHERE make = ANY($1::text[]) AND model IS NOT NULL`,
        [ownMakeSlugs(makeDbValues)]
      );
      const options = dedupeCaseInsensitive(ownResult.rows.map((row) => row.value as string));
      return NextResponse.json({ success: true, options });
    }

    if (field === 'year') {
      if (!make) {
        return NextResponse.json({ success: true, options: [] });
      }
      // Годы — только из своих полей прайса (car_year): в своей применимости
      // годов нет, из TecDoc больше не берём
      const productsResult = await pool.query(
        `SELECT DISTINCT car_year AS value FROM products WHERE UPPER(car_make) = ANY($1::text[]) AND car_year IS NOT NULL AND car_year <> ''`,
        [makeDbValues]
      );
      const options = dedupeCaseInsensitive(productsResult.rows.map((row) => row.value as string));
      options.sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
      return NextResponse.json({ success: true, options });
    }

    // ---- ОБ'ЄМ ДВИГУНА ----
    // Этап C перехода с TecDoc: только своё поле товара products.engine_volume
    // (в своей применимости двигателей нет, из TecDoc больше не берём)
    const conditions: string[] = [`p.engine_volume IS NOT NULL`, `p.engine_volume <> ''`];
    const values: unknown[] = [];
    if (make) {
      values.push(makeDbValues);
      conditions.push(`UPPER(p.car_make) = ANY($${values.length}::text[])`);
    }
    if (year) {
      values.push(year);
      conditions.push(`p.car_year ILIKE $${values.length}`);
    }
    const ownResult = await pool.query(
      `SELECT DISTINCT p.engine_volume AS value FROM products p WHERE ${conditions.join(' AND ')}`,
      values
    );
    const options = dedupeCaseInsensitive(ownResult.rows.map((row) => row.value as string));
    // Об'єм двигуна — сортуємо як числа (напр. "1.6" перед "2.0")
    options.sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));

    return NextResponse.json({ success: true, options });
  } catch (error) {
    console.error('Ошибка при получении списка значений для подбора по автомобилю:', error);
    // Подробности ошибки (в т.ч. текст из базы) — только в логи Vercel (console.error выше), покупателю — общий текст
    return NextResponse.json(
      { error: 'Сталася помилка, спробуйте пізніше' },
      { status: 500 }
    );
  }
}
