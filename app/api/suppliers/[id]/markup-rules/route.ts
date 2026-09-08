// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/suppliers/[id]/markup-rules
//
// Правила наценки/скидки поставщика ПО ФИЛЬТРУ (бренд / категория /
// диапазон цены поставщика) — дополнение к обычной единой наценке
// поставщика (supplier_excel_mappings.markup_percent). У поставщика
// может быть НЕСКОЛЬКО таких правил; при загрузке прайса каждый товар
// проверяется по ним по порядку создания, и применяется наценка/скидка
// первого подошедшего правила (см. app/api/suppliers/parse-excel/route.ts).
//
//   GET  /api/suppliers/[id]/markup-rules  — список правил поставщика,
//                                             по порядку создания (тому
//                                             же, в котором их проверяет
//                                             загрузка прайса)
//   POST /api/suppliers/[id]/markup-rules  — создать новое правило
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCategoryBySlug } from '@/lib/categories';

export const runtime = 'nodejs';

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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

interface MarkupRuleResponse {
  id: string;
  supplierId: string;
  brand: string | null;
  categorySlug: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  discountPercent: number;
  markupPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function toResponse(row: Record<string, unknown>): MarkupRuleResponse {
  return {
    id: row.id as string,
    supplierId: row.supplier_id as string,
    brand: row.brand as string | null,
    categorySlug: row.category_slug as string | null,
    // NUMERIC-колонки драйвер pg возвращает строкой (чтобы не терять
    // точность при преобразовании в float) — приводим явно. NULL так
    // и остаётся NULL (parseFloat(null) дал бы NaN, поэтому проверяем)
    priceFrom: row.price_from === null ? null : parseFloat(row.price_from as string),
    priceTo: row.price_to === null ? null : parseFloat(row.price_to as string),
    discountPercent: parseFloat(row.discount_percent as string),
    markupPercent: parseFloat(row.markup_percent as string),
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface CreateRuleRequestBody {
  brand?: string | null;
  categorySlug?: string | null;
  // null — то же самое, что "поле не заполнено" (клиент присылает
  // null и при создании, и при очистке поля в форме редактирования —
  // см. PATCH .../markup-rules/[ruleId] ниже, где null и undefined
  // различаются принципиально: undefined = "не трогать", null =
  // "очистить"). Здесь, при создании, разница не важна — оба случая
  // означают "нет ограничения по цене"
  priceFrom?: number | null;
  priceTo?: number | null;
  discountPercent?: number;
  markupPercent?: number;
  isActive?: boolean;
}

// Возвращает текст ошибки, если данные некорректны, или null
function validateRuleInput(body: CreateRuleRequestBody): string | null {
  if (body.categorySlug && !getCategoryBySlug(body.categorySlug)) {
    return 'Неизвестная категория.';
  }
  if (
    body.priceFrom !== undefined &&
    body.priceFrom !== null &&
    (!Number.isFinite(body.priceFrom) || body.priceFrom < 0)
  ) {
    return '"Цена от" должна быть числом не меньше нуля.';
  }
  if (
    body.priceTo !== undefined &&
    body.priceTo !== null &&
    (!Number.isFinite(body.priceTo) || body.priceTo < 0)
  ) {
    return '"Цена до" должна быть числом не меньше нуля.';
  }
  if (
    body.priceFrom !== undefined &&
    body.priceFrom !== null &&
    body.priceTo !== undefined &&
    body.priceTo !== null &&
    body.priceFrom > body.priceTo
  ) {
    return '"Цена от" не может быть больше "Цена до".';
  }
  if (
    body.discountPercent !== undefined &&
    (!Number.isFinite(body.discountPercent) || body.discountPercent < 0 || body.discountPercent > 100)
  ) {
    return 'Скидка должна быть числом от 0 до 100.';
  }
  if (body.markupPercent !== undefined && (!Number.isFinite(body.markupPercent) || body.markupPercent < 0)) {
    return 'Наценка должна быть числом не меньше нуля.';
  }
  return null;
}

// ------------------------------------------------------------
// GET /api/suppliers/[id]/markup-rules — список правил поставщика
// ------------------------------------------------------------
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = await params;

  if (!isValidUuid(supplierId)) {
    return NextResponse.json({ error: 'id поставщика должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    // ORDER BY created_at ASC — тот же порядок, в котором правила
    // проверяются при загрузке прайса (см. app/api/suppliers/parse-excel/route.ts):
    // первое подошедшее правило и "выигрывает"
    const result = await pool.query(
      'SELECT * FROM supplier_markup_rules WHERE supplier_id = $1 ORDER BY created_at ASC',
      [supplierId]
    );

    return NextResponse.json({ success: true, rules: result.rows.map(toResponse) });
  } catch (error) {
    console.error('Ошибка при получении правил наценки поставщика:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить правила наценки: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// POST /api/suppliers/[id]/markup-rules — создать новое правило
// ------------------------------------------------------------
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: supplierId } = await params;

  if (!isValidUuid(supplierId)) {
    return NextResponse.json({ error: 'id поставщика должен быть корректным UUID.' }, { status: 400 });
  }

  let body: CreateRuleRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const validationError = validateRuleInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO supplier_markup_rules
        (supplier_id, brand, category_slug, price_from, price_to, discount_percent, markup_percent, is_active)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        supplierId,
        body.brand?.trim().toUpperCase() || null,
        body.categorySlug || null,
        body.priceFrom ?? null,
        body.priceTo ?? null,
        body.discountPercent ?? 0,
        body.markupPercent ?? 0,
        body.isActive ?? true,
      ]
    );

    return NextResponse.json({ success: true, rule: toResponse(result.rows[0]) }, { status: 201 });
  } catch (error) {
    console.error('Ошибка при создании правила наценки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось создать правило наценки: ' + message }, { status: 500 });
  }
}
