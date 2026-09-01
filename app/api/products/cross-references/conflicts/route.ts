// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/products/cross-references/conflicts
//
// Список конфликтов, накопленных при импорте кросс-номеров (см.
// linkParts() в app/api/products/cross-references/import/route.ts и
// в app/api/products/[id]/cross-references/route.ts): случаи, когда
// новая связь пыталась объединить ДВЕ УЖЕ РАЗНЫЕ группы
// взаимозаменяемости. По умолчанию отдаёт только ещё не решённые
// (status = 'pending') — экран "Кроссы", вкладка "Конфликты".
//
// Разрешение одного конфликта — отдельный роут
// .../conflicts/[id]/route.ts (POST с action: 'merge' | 'reject')
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
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

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

const STATUS_VALUES = ['pending', 'merged', 'rejected'] as const;
type ConflictStatus = (typeof STATUS_VALUES)[number];
function isValidStatus(value: string): value is ConflictStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  try {
    const status = (request.nextUrl.searchParams.get('status') || 'pending').trim();

    if (!isValidStatus(status)) {
      return NextResponse.json(
        { error: `status должен быть одним из: ${STATUS_VALUES.join(', ')}.` },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `
      SELECT id, part_a_brand, part_a_number, part_b_brand, part_b_number,
             existing_group_a, existing_group_b, source, source_file, status, created_at, resolved_at
      FROM cross_reference_conflicts
      WHERE status = $1
      ORDER BY created_at DESC
      `,
      [status]
    );

    const conflicts = result.rows.map((row) => ({
      id: row.id,
      partABrand: row.part_a_brand,
      partANumber: row.part_a_number,
      partBBrand: row.part_b_brand,
      partBNumber: row.part_b_number,
      existingGroupA: row.existing_group_a,
      existingGroupB: row.existing_group_b,
      source: row.source,
      sourceFile: row.source_file,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }));

    return NextResponse.json({ success: true, conflicts });
  } catch (error) {
    console.error('Ошибка при получении списка конфликтов кроссов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список конфликтов: ' + message },
      { status: 500 }
    );
  }
}
