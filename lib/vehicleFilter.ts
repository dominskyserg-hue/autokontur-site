// ============================================================
// SQL-умова "товар підходить під обране авто (марка/модель/рік/
// двигун)" — ТА САМА логіка, що вже використовується в основному
// пошуку (app/api/products/route.ts, гілка carMake/carModel/carYear/
// engineVolume), винесена сюди окремо, щоб нею ж міг скористатись і
// фільтр на сторінках категорій (app/category/[slug]/page.tsx,
// components/CategoryVehicleFilter.tsx) — БЕЗ окремої, незалежної від
// основного пошуку системи фільтрації.
//
// Джерела даних (обидва одночасно, через OR):
//   1. Власні поля товару — products.car_make/car_model/car_year/
//      engine_volume (вільний текст, який заповнює постачальник —
//      часто порожній)
//   2. tecdoc_compatibility — масовий SEO-індекс TecDoc (join по
//      brand+article), той самий індекс, яким уже користуються вузькі
//      SEO-сторінки (lib/categories.ts, поле tecdocVehicle) і
//      випадаючі списки "Підбір за автомобілем" (app/api/products/
//      car-options/route.ts) — так товар знаходиться, навіть якщо
//      постачальник не заповнив власні car_make/car_year вручну
//
// Усередині ОДНОГО джерела всі задані параметри перевіряються РАЗОМ
// (AND) — інакше марка+рік могли б збігтись по одному джерелу, а
// об'єм двигуна — по зовсім іншій, не пов'язаній модифікації того ж
// товару.
// ============================================================

import { resolveMakeDbValues } from './carMakes';

export interface VehicleFilterParams {
  make?: string;
  model?: string;
  year?: string;
  engine?: string;
}

// true, якщо хоча б один параметр фільтра заданий — зручно для "чи
// взагалі є що фільтрувати" без повторення тієї ж перевірки скрізь,
// де викликається buildVehicleWhereClause
export function hasVehicleFilter(vehicle: VehicleFilterParams): boolean {
  return Boolean(vehicle.make || vehicle.model || vehicle.year || vehicle.engine);
}

export function buildVehicleWhereClause(
  vehicle: VehicleFilterParams,
  startParamIndex: number
): { clause: string; params: unknown[] } | null {
  const { make, model, year, engine } = vehicle;
  if (!hasVehicleFilter(vehicle)) return null;

  const params: unknown[] = [];
  // Повертає ПОЗИЦІЮ ЩОЙНО доданого параметра (а не наступного вільного
  // місця) — виклик params.push() ПЕРЕД обчисленням довжини масиву був
  // би off-by-one (кожен плейсхолдер у тексті запиту виявився б на 1
  // більшим за реальний індекс елемента в params, і Postgres не зміг
  // би визначити тип "пропущеного" номера параметра — саме так і
  // сталось під час перевірки: "could not determine data type of
  // parameter $4")
  const push = (value: unknown): number => {
    params.push(value);
    return startParamIndex + params.length - 1;
  };

  const makeDbValues = make ? resolveMakeDbValues(make) : [];

  const ownParts: string[] = [];
  if (make) {
    ownParts.push(`UPPER(p.car_make) = ANY($${push(makeDbValues)}::text[])`);
  }
  if (model) {
    ownParts.push(`p.car_model ILIKE $${push(model)}`);
  }
  if (year) {
    ownParts.push(`p.car_year ILIKE $${push(year)}`);
  }
  if (engine) {
    ownParts.push(`p.engine_volume ILIKE $${push(engine)}`);
  }
  const ownMatchSql = ownParts.length > 0 ? ownParts.join(' AND ') : 'FALSE';

  const tecdocParts: string[] = [];
  if (make) {
    tecdocParts.push(`UPPER(tc.make) = ANY($${push(makeDbValues)}::text[])`);
  }
  if (model) {
    tecdocParts.push(`tc.model = $${push(model)}`);
  }
  if (year) {
    tecdocParts.push(`$${push(year)}::int BETWEEN COALESCE(tc.year_from, 1900) AND COALESCE(tc.year_to, 2100)`);
  }
  if (engine) {
    tecdocParts.push(`tc.engine ILIKE $${push(engine)}`);
  }
  const tecdocWhereSql = tecdocParts.length > 0 ? `AND ${tecdocParts.join(' AND ')}` : '';

  const clause = `(
    (${ownMatchSql})
    OR EXISTS (
      SELECT 1 FROM tecdoc_compatibility tc
      WHERE tc.brand = p.brand AND tc.article = p.article
      ${tecdocWhereSql}
    )
  )`;

  return { clause, params };
}
