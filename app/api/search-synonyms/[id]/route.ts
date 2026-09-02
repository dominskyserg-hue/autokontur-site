// ============================================================
// API Route для Next.js App Router. Адрес: /api/search-synonyms/[id]
//
//   PATCH  — изменить название и/или список терминов группы
//   DELETE — удалить группу целиком
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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

interface PatchGroupBody {
  label?: string;
  terms?: string[];
}

function cleanTerms(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  let body: PatchGroupBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const terms = cleanTerms(body.terms);

  if (!label) {
    return NextResponse.json({ error: 'Укажите название группы.' }, { status: 400 });
  }
  if (terms.length === 0) {
    return NextResponse.json(
      { error: 'Добавьте хотя бы один вариант написания (термин).' },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `
      UPDATE search_synonym_groups
      SET label = $2, terms = $3, updated_at = now()
      WHERE id = $1
      RETURNING id, label, terms, updated_at
      `,
      [id, label, terms]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Группа с таким id не найдена.' }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
      success: true,
      group: { id: row.id, label: row.label, terms: row.terms, updatedAt: row.updated_at },
    });
  } catch (error) {
    console.error('Ошибка при обновлении группы синонимов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить группу: ' + message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const result = await pool.query('DELETE FROM search_synonym_groups WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Группа с таким id не найдена.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении группы синонимов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось удалить группу: ' + message },
      { status: 500 }
    );
  }
}
