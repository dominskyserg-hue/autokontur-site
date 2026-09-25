// ============================================================
// API Route: GET /api/cron/rebuild-corpus
//
// Щотижневий cron (vercel.json): перебудовує корпус українських слів
// для страховки назв товарів (lib/corpusBuilder.ts) зі всіх активних
// назв — нові слова з нових прайсів потрапляють у нього автоматично.
// Захищено так само, як решта /api/cron/*: middleware.ts пропускає
// лише запити з Authorization: Bearer CRON_SECRET (або з сесією адміна)
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { rebuildUkrainianCorpus } from '@/lib/corpusBuilder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

export async function GET() {
  try {
    const { names, words } = await rebuildUkrainianCorpus(pool);
    return NextResponse.json({ success: true, names, words: words.length });
  } catch (error) {
    console.error('Ошибка перестройки корпуса украинских слов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось перестроить корпус: ' + message }, { status: 500 });
  }
}
