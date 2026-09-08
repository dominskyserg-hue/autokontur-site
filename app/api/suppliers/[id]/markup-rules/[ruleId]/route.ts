// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/suppliers/[id]/markup-rules/[ruleId]
//
// PATCH  — изменить одно правило наценки (любую комбинацию полей)
// DELETE — удалить правило насовсем
//
// См. app/api/suppliers/[id]/markup-rules/route.ts (GET/POST списка)
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
    priceFrom: row.price_from === null ? null : parseFloat(row.price_from as string),
    priceTo: row.price_to === null ? null : parseFloat(row.price_to as string),
    discountPercent: parseFloat(row.discount_percent as string),
    markupPercent: parseFloat(row.markup_percent as string),
    isActive: row.is_active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

interface PatchRuleRequestBody {
  brand?: string | null;
  categorySlug?: string | null;
  priceFrom?: number | null;
  priceTo?: number | null;
  discountPercent?: number;
  markupPercent?: number;
  isActive?: boolean;
}

function validateRuleInput(body: PatchRuleRequestBody): string | null {
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
// PATCH /api/suppliers/[id]/markup-rules/[ruleId]
// ------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const { id: supplierId, ruleId } = await params;

  if (!isValidUuid(supplierId) || !isValidUuid(ruleId)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchRuleRequestBody;
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
    // COALESCE — не передали поле, значит не трогаем колонку. Для
    // brand/categorySlug/priceFrom/priceTo пустая строка/null из
    // формы (админ явно очистил поле) — это НАСТОЯЩЕЕ значение null,
    // а не "не передано", поэтому эти четыре поля обновляются
    // напрямую через CASE на флаге "поле присутствует в теле запроса"
    const result = await pool.query(
      `
      UPDATE supplier_markup_rules
      SET
        brand = CASE WHEN $3::boolean THEN $4 ELSE brand END,
        category_slug = CASE WHEN $5::boolean THEN $6 ELSE category_slug END,
        price_from = CASE WHEN $7::boolean THEN $8 ELSE price_from END,
        price_to = CASE WHEN $9::boolean THEN $10 ELSE price_to END,
        discount_percent = COALESCE($11, discount_percent),
        markup_percent = COALESCE($12, markup_percent),
        is_active = COALESCE($13, is_active),
        updated_at = now()
      WHERE id = $1 AND supplier_id = $2
      RETURNING *
      `,
      [
        ruleId,
        supplierId,
        'brand' in body,
        body.brand?.trim().toUpperCase() || null,
        'categorySlug' in body,
        body.categorySlug || null,
        'priceFrom' in body,
        body.priceFrom ?? null,
        'priceTo' in body,
        body.priceTo ?? null,
        body.discountPercent ?? null,
        body.markupPercent ?? null,
        body.isActive ?? null,
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Правило с таким id не найдено у этого поставщика.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, rule: toResponse(result.rows[0]) });
  } catch (error) {
    console.error('Ошибка при изменении правила наценки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось изменить правило наценки: ' + message }, { status: 500 });
  }
}

// ------------------------------------------------------------
// DELETE /api/suppliers/[id]/markup-rules/[ruleId]
// ------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
  const { id: supplierId, ruleId } = await params;

  if (!isValidUuid(supplierId) || !isValidUuid(ruleId)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query(
      'DELETE FROM supplier_markup_rules WHERE id = $1 AND supplier_id = $2 RETURNING id',
      [ruleId, supplierId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Правило с таким id не найдено у этого поставщика.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении правила наценки:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось удалить правило наценки: ' + message }, { status: 500 });
  }
}
