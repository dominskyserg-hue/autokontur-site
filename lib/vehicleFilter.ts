// ============================================================
// SQL-умова "товар підходить під обране авто (марка/модель/рік/
// двигун)" — ТА САМА логіка, що вже використовується в основному
// пошуку (app/api/products/route.ts, гілка carMake/carModel/carYear/
// engineVolume), винесена сюди окремо, щоб нею ж міг скористатись і
// фільтр на сторінках категорій (app/category/[slug]/page.tsx,
// components/CategoryVehicleFilter.tsx) — БЕЗ окремої, незалежної від
// основного пошуку системи фільтрації.
//
// Джерела даних (через OR):
//   1. Власні поля товару — products.car_make/car_model/car_year/
//      engine_volume (вільний текст, який заповнює постачальник —
//      часто порожній)
//   2. Своя применимость product_vehicles_own (lib/ownVehicles.ts) —
//      марка, модель, поколение из бренда, названия, OEM-номеров и прайса.
//      TecDoc (tecdoc_compatibility) с этапа D перехода не читается.
//
// Усередині ОДНОГО джерела всі задані параметри перевіряються РАЗОМ
// (AND) — інакше марка+рік могли б збігтись по одному джерелу, а
// об'єм двигуна — по зовсім іншій, не пов'язаній модифікації того ж
// товару.
// ============================================================

import { resolveMakeDbValues } from './carMakes';
import { ownMakeSlugs } from './ownVehicles';
import { generationsCoveringYear } from './carModelDictionary';

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

  // Своя применимость (product_vehicles_own, lib/ownVehicles.ts): марка и
  // модель из бренда, названия, OEM-номеров и прайса. Год проверяется через
  // поколение: деталь подходит, если её поколение выпускалось в этот год
  // (lib/carModelDictionary.ts, generationsCoveringYear); без поколения при
  // выбранном годе ветка не участвует. Двигателей в своих данных нет — при
  // выбранном двигателе ветка тоже не участвует. Модель из фильтра
  // сравнивается по вхождению своей модели ("Camry" в "Camry")
  let ownVehiclesSql = '';
  const ownMakes = make ? ownMakeSlugs(makeDbValues) : [];
  const yearGenerations = year && /^\d{4}$/.test(year) ? generationsCoveringYear(ownMakes, parseInt(year, 10)) : [];
  if (make && !engine && (!year || yearGenerations.length > 0)) {
    const ownVehicleParts = [`pvo.make = ANY($${push(ownMakes)}::text[])`];
    if (model) {
      ownVehicleParts.push(`pvo.model IS NOT NULL AND position(upper(pvo.model) in upper($${push(model)})) > 0`);
    }
    if (year) {
      ownVehicleParts.push(`pvo.generation = ANY($${push(yearGenerations)}::text[])`);
    }
    ownVehiclesSql = `
    OR EXISTS (
      SELECT 1 FROM product_vehicles_own pvo
      WHERE pvo.product_id = p.id AND ${ownVehicleParts.join(' AND ')}
    )`;
  }

  const clause = `(
    (${ownMatchSql})${ownVehiclesSql}
  )`;

  return { clause, params };
}
