// ============================================================
// ОКРЕМИЙ (другий) прохід по дампу — резолвить des_texts.id ->
// текст назви моделі, ЛИШЕ для id, зібраних на фазі 1
// (referenceData.ts, поле modelDesTextId). Не можна зробити це в
// ОДНОМУ проході з фазою 1: на момент, коли зустрічається
// country_designations (звідки й беруться потрібні id), таблиця
// des_texts (1,25 млн рядків) могла в файлі ще не траплятися —
// порядок таблиць у дампі наперед невідомий
// ============================================================

import { readDump } from './dumpReader';

// Точна кількість рядків des_texts у ЦЬОМУ КОНКРЕТНОМУ файлі
// (tecdoc2016q1.sql, з npm run tecdoc:inspect) — лише для раннього
// виходу: якщо побачили стільки рядків des_texts, далі шукати нема
// сенсу, навіть якщо не всі потрібні id знайшлись (значить, для
// частини моделей des_texts просто не містить назви)
const KNOWN_DES_TEXTS_ROWS = 1_251_483;

class EarlyExit extends Error {}

// des_texts.id -> текст, ЛИШЕ для id з neededIds (усі інші рядки
// des_texts просто пропускаються — не тримаємо в пам'яті мільйон
// рядків заради кількох тисяч потрібних)
export async function resolveDesTexts(
  dumpPath: string,
  neededIds: ReadonlySet<number>,
  onProgress?: (linesRead: number, elapsedMs: number, found: number) => void
): Promise<Map<number, string>> {
  const textById = new Map<number, string>();
  if (neededIds.size === 0) return textById;

  let desTextsSeen = 0;

  try {
    await readDump(dumpPath, {
      onInsertRows(table, rows) {
        if (table !== 'des_texts') return;
        desTextsSeen += rows.length;
        for (const row of rows) {
          const id = Number(row[0]);
          if (!neededIds.has(id)) continue;
          const text = String(row[1] ?? '').trim();
          if (text) textById.set(id, text);
        }

        if (textById.size >= neededIds.size || desTextsSeen >= KNOWN_DES_TEXTS_ROWS) {
          throw new EarlyExit();
        }
      },
      progressEveryLines: 5_000_000,
      onProgress: onProgress
        ? (stats) => onProgress(stats.linesRead, stats.elapsedMs, textById.size)
        : undefined,
    });
  } catch (error) {
    if (!(error instanceof EarlyExit)) throw error;
  }

  return textById;
}
