// ============================================================
// API Route для Next.js App Router. Адрес: /api/search-synonyms
//
// Управление словарём синонимов для многоязычного поиска по
// ключевым словам (см. lib/searchSynonyms.ts и app/api/products/route.ts,
// где словарь реально используется при поиске). Один "рядок" здесь —
// одна группа понятий (напр. "Гальмівні колодки") со списком всех
// вариантов написания на укр/рос/англ языках.
//
//   GET  /api/search-synonyms — список всех групп
//   POST /api/search-synonyms — создать новую группу
//
// Массовая загрузка из Excel/TXT — отдельный роут:
// app/api/search-synonyms/import/route.ts
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

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

interface CreateGroupBody {
  label?: string;
  terms?: string[];
}

// Приводит список термінів до чистого вигляду: обрізає пробіли,
// прибирає порожні й повторювані значення (регістронезалежно)
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

export async function GET() {
  try {
    const result = await pool.query(
      'SELECT id, label, terms, updated_at FROM search_synonym_groups ORDER BY label'
    );

    return NextResponse.json({
      success: true,
      groups: result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        terms: row.terms,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('Ошибка при получении словаря синонимов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить словарь синонимов: ' + message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: CreateGroupBody;
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
      INSERT INTO search_synonym_groups (label, terms)
      VALUES ($1, $2)
      RETURNING id, label, terms, updated_at
      `,
      [label, terms]
    );

    const row = result.rows[0];
    return NextResponse.json(
      { success: true, group: { id: row.id, label: row.label, terms: row.terms, updatedAt: row.updated_at } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Ошибка при создании группы синонимов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось создать группу: ' + message },
      { status: 500 }
    );
  }
}
