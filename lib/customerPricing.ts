// ============================================================
// Персональна ціна покупця (скидка/націнка) — застосування "правила"
// з customer_pricing_rules (див. schema.sql, app/api/admin/
// customer-pricing-rules/route.ts) до ЦІН, ЯКІ ПОКУПЕЦЬ БАЧИТЬ ПІД
// ЧАС ПЕРЕГЛЯДУ, а не тільки в момент оформлення замовлення (те
// окреме застосування лишається в app/api/orders/create/route.ts —
// воно вирішальне і НЕ залежить від цього файла, тому підміна цієї
// cookie в браузері не дає покупцю реально заплатити менше).
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

// Множник, на який множиться "звичайна" retail_price. 1, якщо правила
// нема (телефон не переданий або для нього нічого не призначено)
export function pricingRuleToMultiplier(rule: CustomerPricingRule | null): number {
  if (!rule) return 1;
  return rule.ruleType === 'discount' ? 1 - rule.percent / 100 : 1 + rule.percent / 100;
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

// Зручний хелпер для місць, де просто потрібне готове число-множник
// (напр. app/api/products/route.ts, що мапить багато рядків підряд) —
// щоб не тягнути pricingRuleToMultiplier окремим імпортом щоразу
export async function getCustomerPricingMultiplier(
  pool: Pool,
  rawPhone: string | undefined | null
): Promise<number> {
  const rule = await getCustomerPricingRule(pool, rawPhone);
  return pricingRuleToMultiplier(rule);
}

// Округлення до копійок — той самий приём, що і скрізь у проєкті для
// грошових значень (Math.round(x * 100) / 100), винесений сюди один
// раз, щоб не повторювати в кожному місці застосування множника
export function applyPricingMultiplier(price: number, multiplier: number): number {
  return Math.round(price * multiplier * 100) / 100;
}
