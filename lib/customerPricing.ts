// ============================================================
// Персональна ціна покупця (скидка/націнка) — застосування "правила"
// з customer_pricing_rules (див. schema.sql, app/api/admin/
// customer-pricing-rules/route.ts) до ЦІН, ЯКІ ПОКУПЕЦЬ БАЧИТЬ ПІД
// ЧАС ПЕРЕГЛЯДУ, а не тільки в момент оформлення замовлення (те
// окреме застосування лишається в app/api/orders/create/route.ts —
// воно вирішальне і НЕ залежить від цього файла, тому підміна цієї
// cookie в браузері не дає покупцю реально заплатити менше).
//
// ВАЖЛИВО про базу розрахунку: для покупця з персональним правилом
// відсоток рахується НЕ від retail_price (вона вже включає ЗВИЧАЙНУ
// націнку магазину, mapping.markup/supplier_markup_rules — див.
// lib/priceListImport.ts), а від "голої" ціни постачальника з прайса —
// products.cost_price. Інакше для клієнта з персональною націнкою
// вийшло б подвійне накручення (наша звичайна націнка + ще й його), а
// для знижки — знижка рахувалась би від уже накрученої ціни, а не від
// реальної собівартості, як домовлено з власником магазину.
//
// Покупець на цьому сайті не має пароля/сесії — єдина ідентифікація
// це номер телефону (див. components/CustomerDashboard.tsx, "вхід" у
// Особистий кабінет). Щоб той самий номер міг впливати на ціни, які
// рендерить СЕРВЕР (сторінки категорій/марок, API пошуку), одного
// localStorage замало (сервер його не бачить) — тому ПОРЯД із
// localStorage логін додатково пише саме той самий телефон у cookie
// CUSTOMER_PHONE_COOKIE, яку сервер читає при кожному запиті
// ============================================================

import type { Pool } from 'pg';
import { normalizePhone } from './phoneNormalize';

export { CUSTOMER_PHONE_COOKIE } from './customerPhoneCookie';

export type CustomerRuleType = 'discount' | 'markup';

export interface CustomerPricingRule {
  ruleType: CustomerRuleType;
  percent: number;
}

// rawPhone — значення cookie ЯК Є (може бути undefined/порожнім, якщо
// покупець не "логінився") — нормалізація відбувається тут же
export async function getCustomerPricingRule(
  pool: Pool,
  rawPhone: string | undefined | null
): Promise<CustomerPricingRule | null> {
  if (!rawPhone) return null;
  const phone = normalizePhone(rawPhone);
  if (phone.length < 9) return null;

  const result = await pool.query<{ rule_type: CustomerRuleType; percent: string }>(
    'SELECT rule_type, percent FROM customer_pricing_rules WHERE phone = $1',
    [phone]
  );
  if (result.rows.length === 0) return null;

  return { ruleType: result.rows[0].rule_type, percent: parseFloat(result.rows[0].percent) };
}

// Ціна, яку реально бачить (і платить) конкретний покупець:
//   - нема правила -> звичайна retail_price, як і для всіх
//   - є правило -> costPrice ± percent% (від "голої" ціни постачальника,
//     НЕ від retail_price — див. коментар на початку файлу)
export function computeCustomerPrice(costPrice: number, retailPrice: number, rule: CustomerPricingRule | null): number {
  if (!rule) return retailPrice;
  const multiplier = rule.ruleType === 'discount' ? 1 - rule.percent / 100 : 1 + rule.percent / 100;
  return Math.round(costPrice * multiplier * 100) / 100;
}
