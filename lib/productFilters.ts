// ============================================================
// Об'єднує фільтр категорії (lib/categories.ts) і фільтр марки
// (lib/carMakes.ts) в один SQL WHERE — потрібен там, де товар має
// підходити ОДНОЧАСНО і під категорію ("гальмівні колодки"), і під
// марку ("Toyota"): сторінка /marky/[make]/to та фільтр ?marka= на
// /category/[slug].
//
// Обидва вихідних білдери самі нумерують свої $-параметри від
// переданого startParamIndex — тут важливо просто "з'єднати" їх без
// перетину номерів, тому makeClause отримує номер ПІСЛЯ всіх
// параметрів categoryClause
// ============================================================

import { CategoryDef, buildCategoryWhereClause } from './categories';
import { CarMakeDef, buildMakeWhereClause } from './carMakes';

export function buildCategoryAndMakeWhereClause(
  category: CategoryDef,
  make: CarMakeDef | null,
  startParamIndex: number
): { clause: string; params: unknown[] } {
  const categoryResult = buildCategoryWhereClause(category, startParamIndex);

  if (!make) {
    return { clause: categoryResult.clause, params: categoryResult.params };
  }

  const makeResult = buildMakeWhereClause(make, startParamIndex + categoryResult.params.length);
  return {
    clause: `${categoryResult.clause} AND ${makeResult.clause}`,
    params: [...categoryResult.params, makeResult.param],
  };
}
