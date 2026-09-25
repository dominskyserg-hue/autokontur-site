// ============================================================
// Перебудова корпусу українських слів (lib/ukrainianCorpus.ts) зі
// всіх активних назв товарів. Викликається cron-ом щотижня
// (app/api/cron/rebuild-corpus/route.ts) і скриптом
// scripts/rebuild-ukrainian-corpus.ts.
//
// Слово потрапляє в корпус, якщо (рахуємо назви ПІСЛЯ КРОКУ 1 очистки —
// латинські двійники вже виправлені, службовий текст вирізано):
//   - зустрілось у >= MIN_UA_NAMES "українських" назвах (є і/ї/є/ґ і
//     немає ы/э/ъ/ё), і
//   - у "російських" назвах (з ы/э/ъ/ё) трапляється не частіше, ніж
//     1 на 10 таких українських, і
//   - це не ключ російського словника (їх ми перекладаємо, а не
//     визнаємо українськими) і не "акция"
// ============================================================

import type { Pool } from 'pg';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { RU_UA_DICTIONARY } from '@/lib/productNameDictionary';

export const MIN_UA_NAMES = 5;

const WORD_RE = /[а-яёіїєґ]{2,}/g;

export function collectCorpusWords(rawNames: Iterable<string>): string[] {
  const ua = new Map<string, number>();
  const ru = new Map<string, number>();
  for (const raw of rawNames) {
    const name = buildCleanProductName(raw) ?? '';
    const isRussian = /[ыэъё]/i.test(name);
    const isUkrainian = !isRussian && /[іїєґ]/i.test(name);
    if (!isRussian && !isUkrainian) continue;
    const target = isUkrainian ? ua : ru;
    for (const word of new Set(name.toLowerCase().match(WORD_RE) ?? [])) {
      target.set(word, (target.get(word) ?? 0) + 1);
    }
  }
  return [...ua.entries()]
    .filter(
      ([word, count]) =>
        count >= MIN_UA_NAMES &&
        (ru.get(word) ?? 0) * 10 <= count &&
        !Object.prototype.hasOwnProperty.call(RU_UA_DICTIONARY, word) &&
        word !== 'акция'
    )
    .map(([word]) => word)
    .sort();
}

export async function loadAllProductNames(pool: Pool): Promise<string[]> {
  const result = await pool.query(`SELECT name FROM products WHERE is_active = true AND name IS NOT NULL AND name <> ''`);
  return result.rows.map((row) => row.name as string);
}

// Записує слова в таблицю ukrainian_corpus_words (замінює вміст цілком —
// в одній транзакції, тож читачі ніколи не бачать порожню таблицю)
export async function saveCorpusToDatabase(pool: Pool, words: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ukrainian_corpus_words');
    const BATCH = 2000;
    for (let i = 0; i < words.length; i += BATCH) {
      await client.query('INSERT INTO ukrainian_corpus_words (word) SELECT unnest($1::text[])', [words.slice(i, i + BATCH)]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rebuildUkrainianCorpus(pool: Pool): Promise<{ names: number; words: string[] }> {
  const names = await loadAllProductNames(pool);
  const words = collectCorpusWords(names);
  await saveCorpusToDatabase(pool, words);
  return { names: names.length, words };
}

// ------------------------------------------------------------
// Перебудова ПІСЛЯ імпорту прайсу (lib/priceListImport.ts)
// ------------------------------------------------------------
// Займає ~10-15 с (усі ~360 тис. назв), тому виконується ПІСЛЯ відповіді
// (after() з next/server) — адмін не чекає на неї при завантаженні файлу.
// Якщо за один запуск імпортується кілька прайсів (напр. cron листів
// постачальників), паралельна перебудова не запускається вдруге — друга
// лише позначає, що після поточної треба пройтись ще раз
let rebuildRunning = false;
let rebuildRequestedAgain = false;

export async function rebuildUkrainianCorpusSafely(pool: Pool): Promise<void> {
  if (rebuildRunning) {
    rebuildRequestedAgain = true;
    return;
  }
  rebuildRunning = true;
  try {
    do {
      rebuildRequestedAgain = false;
      await rebuildUkrainianCorpus(pool);
    } while (rebuildRequestedAgain);
  } catch (error) {
    // Імпорт уже пройшов успішно — помилка корпусу його не скасовує;
    // щотижневий cron /api/cron/rebuild-corpus підстрахує
    console.error('Не вдалося перебудувати корпус українських слів після імпорту:', error);
  } finally {
    rebuildRunning = false;
  }
}
