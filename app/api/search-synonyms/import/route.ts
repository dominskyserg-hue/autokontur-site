// ============================================================
// API Route для Next.js App Router. Адрес: POST /api/search-synonyms/import
//
// Масова загрузка словника синонімів з файлу — Excel (.xlsx/.xls)
// або звичайний текстовий файл (.txt/.csv).
//
// Формат ОДНАКОВИЙ для обох типів файлу — один РЯДОК = одна ГРУПА:
//   перше значення в рядку — назва групи (label, тільки для адмінки),
//   усі наступні значення — варіанти написання (terms) цієї ж групи
//   будь-якою мовою.
//
//   Excel: колонка A — назва групи, колонки B, C, D... — терміни
//   TXT/CSV: один рядок файлу = "Назва групи; термін 1; термін 2; ..."
//            (роздільник — крапка з комою; звичайна кома теж підійде,
//            якщо в самих термінах немає ком)
//
// Якщо група з такою ЖЕ назвою (без урахування регістру) вже існує —
// нові терміни ДОДАЮТЬСЯ до неї (без дублів), а не створюють другу
// групу з такою ж назвою. Це і є "поповнення словника" з завдання.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Pool, PoolClient } from 'pg';

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

interface ParsedRow {
  label: string;
  terms: string[];
}

function cleanTerms(rawTerms: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTerms) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseExcel(buffer: Buffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('У файлі не знайдено жодного листа');
  const sheet = workbook.Sheets[firstSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const parsed: ParsedRow[] = [];
  for (const row of rows) {
    if (!row || row.length === 0) continue;
    const [labelCell, ...termCells] = row;
    const label = String(labelCell ?? '').trim();
    if (!label) continue;
    const terms = cleanTerms(termCells.map((c) => String(c ?? '')));
    if (terms.length === 0) continue;
    parsed.push({ label, terms });
  }
  return parsed;
}

function parseTextFile(text: string): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // Крапка з комою — основний роздільник; якщо в рядку немає жодної
    // крапки з комою, пробуємо звичайну кому (простіший файл, де
    // терміни точно без ком усередині)
    const delimiter = line.includes(';') ? ';' : ',';
    const [labelPart, ...termParts] = line.split(delimiter);
    const label = (labelPart ?? '').trim();
    if (!label) continue;
    const terms = cleanTerms(termParts);
    if (terms.length === 0) continue;
    parsed.push({ label, terms });
  }
  return parsed;
}

// Зливає нові рядки в базу: якщо група з такою назвою (регістронезалежно)
// вже є — дописує нові терміни до неї; інакше створює нову групу
async function importRows(client: PoolClient, rows: ParsedRow[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await client.query(
      'SELECT id, terms FROM search_synonym_groups WHERE LOWER(label) = LOWER($1)',
      [row.label]
    );

    if (existing.rows.length > 0) {
      const existingTerms: string[] = existing.rows[0].terms;
      const mergedTerms = cleanTerms([...existingTerms, ...row.terms]);
      await client.query(
        'UPDATE search_synonym_groups SET terms = $2, updated_at = now() WHERE id = $1',
        [existing.rows[0].id, mergedTerms]
      );
      updated++;
    } else {
      await client.query(
        'INSERT INTO search_synonym_groups (label, terms) VALUES ($1, $2)',
        [row.label, row.terms]
      );
      created++;
    }
  }

  return { created, updated };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не знайдено в запиті. Очікується поле "file".' },
        { status: 400 }
      );
    }

    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Файл занадто великий. Максимальний розмір — 5 МБ.' },
        { status: 400 }
      );
    }

    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    const arrayBuffer = await file.arrayBuffer();

    let rows: ParsedRow[];
    if (isExcel) {
      rows = parseExcel(Buffer.from(arrayBuffer));
    } else {
      rows = parseTextFile(Buffer.from(arrayBuffer).toString('utf-8'));
    }

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error:
            'У файлі не знайдено жодного придатного рядка. Формат: назва групи, потім через ";" — усі варіанти написання.',
        },
        { status: 400 }
      );
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { created, updated } = await importRows(client, rows);
      await client.query('COMMIT');

      return NextResponse.json({ success: true, created, updated, totalRows: rows.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ошибка при импорте словаря синонимов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обработать файл: ' + message },
      { status: 500 }
    );
  }
}
