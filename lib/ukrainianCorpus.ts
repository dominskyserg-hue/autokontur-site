// ============================================================
// Корпус українських слів для страховки назв (lib/productNameTranslation.ts).
//
// Джерело правди — таблиця ukrainian_corpus_words у БД: її щотижня
// перебудовує cron /api/cron/rebuild-corpus (lib/corpusBuilder.ts), а
// вручну (напр. одразу після великого імпорту прайсів) — команда
// `npm run corpus:rebuild`. Так нові слова з нових прайсів потрапляють
// у корпус АВТОМАТИЧНО, без правок коду й нового деплою.
//
// Резервна копія (на випадок, коли таблиця порожня або БД недоступна) —
// статичний файл lib/ukrainianCorpusWords.ts, який теж оновлює
// `npm run corpus:rebuild`.
//
// getUkrainianCorpus() — СИНХРОННА (потрібна синхронному коду H1);
// ensureUkrainianCorpusFresh() — асинхронна, викликається на початку
// завантаження сторінки товару (loadProduct) і не частіше разу на
// годину підвантажує актуальний набір із БД
// ============================================================

import type { Pool } from 'pg';
import { UKRAINIAN_CORPUS_WORDS as STATIC_CORPUS } from '@/lib/ukrainianCorpusWords';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
// Менше слів — ознака битої/неповної таблиці: лишаємо резервний набір
const MIN_PLAUSIBLE_WORDS = 500;

let current: ReadonlySet<string> = STATIC_CORPUS;
let lastAttemptAt = 0;

export function getUkrainianCorpus(): ReadonlySet<string> {
  return current;
}

export async function ensureUkrainianCorpusFresh(pool: Pool): Promise<void> {
  const now = Date.now();
  if (now - lastAttemptAt < REFRESH_INTERVAL_MS) return;
  lastAttemptAt = now;
  try {
    const result = await pool.query('SELECT word FROM ukrainian_corpus_words');
    if (result.rows.length >= MIN_PLAUSIBLE_WORDS) {
      current = new Set(result.rows.map((row) => row.word as string));
    }
  } catch (error) {
    // Таблиці ще нема (міграція не виконана) чи БД тимчасово недоступна —
    // працюємо зі статичним резервним набором
    console.error('Не вдалося оновити корпус українських слів із БД:', error);
  }
}
