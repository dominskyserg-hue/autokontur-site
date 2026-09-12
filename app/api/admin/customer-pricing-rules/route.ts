// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/admin/customer-pricing-rules
//
// Персональные скидки/наценки покупателям по номеру телефона — см.
// customer_pricing_rules в schema.sql и lib/phoneNormalize.ts. Правило
// применяется автоматически при оформлении заказа
// (app/api/orders/create/route.ts), без промокода.
//
//   GET  /api/admin/customer-pricing-rules  — список всех назначенных правил
//   POST /api/admin/customer-pricing-rules  — назначить правило (создать
//                                              или обновить, если для
//                                              этого телефона уже было)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { normalizePhone } from '@/lib/phoneNormalize';

export const runtime = 'nodejs';

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

globalThis.pgPool = pool;

type RuleType = 'discount' | 'markup';

interface CustomerPricingRuleResponse {
  phone: string;
  ruleType: RuleType;
  percent: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

function toResponse(row: Record<string, unknown>): CustomerPricingRuleResponse {
  return {
    phone: row.phone as string,
    ruleType: row.rule_type as RuleType,
    // percent — колонка NUMERIC, драйвер pg возвращает такие значения
    // строкой (чтобы не терять точность), приводим явно
    percent: parseFloat(row.percent as string),
    note: row.note as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface UpsertRuleRequestBody {
  phone?: string;
  ruleType?: RuleType;
  percent?: number;
  note?: string | null;
}

function validateInput(body: UpsertRuleRequestBody): string | null {
  if (!body.phone || normalizePhone(body.phone).length < 9) {
    return 'Укажите корректный номер телефона (минимум 9 значащих цифр).';
  }
  if (body.ruleType !== 'discount' && body.ruleType !== 'markup') {
    return 'Тип правила должен быть "discount" или "markup".';
  }
  if (!Number.isFinite(body.percent) || (body.percent as number) <= 0) {
    return 'Процент должен быть положительным числом.';
  }
  // Скидка больше 100% физического смысла не имеет (цена не может уйти
  // в минус) — для наценки верхнего предела по смыслу нет, поэтому
  // ограничение только для discount
  if (body.ruleType === 'discount' && (body.percent as number) > 100) {
    return 'Скидка не может быть больше 100%.';
  }
  return null;
}

// ------------------------------------------------------------
// GET — список всех персональных правил
// ------------------------------------------------------------
export async function GET() {
  try {
    const result = await pool.query('SELECT * FROM customer_pricing_rules ORDER BY updated_at DESC');
    return NextResponse.json({ success: true, rules: result.rows.map(toResponse) });
  } catch (error) {
    console.error('Ошибка при получении списка персональных правил цены:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить список правил: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST — назначить правило (upsert по нормализованному телефону)
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: UpsertRuleRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const validationError = validateInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const phone = normalizePhone(body.phone as string);

  try {
    const result = await pool.query(
      `
      INSERT INTO customer_pricing_rules (phone, rule_type, percent, note)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone)
      DO UPDATE SET rule_type = EXCLUDED.rule_type, percent = EXCLUDED.percent, note = EXCLUDED.note, updated_at = now()
      RETURNING *
      `,
      [phone, body.ruleType, body.percent, body.note?.trim() || null]
    );

    return NextResponse.json({ success: true, rule: toResponse(result.rows[0]) }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при назначении персонального правила цены:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось назначить правило: ' + message }, { status: 500 });
  }
}
