// ============================================================
// ФАЗА 1 імпорту: один прохід по дампу, який будує в пам'яті ЛИШЕ
// те, що потрібно для фази 2 (scripts/tecdoc/import-dump.ts) — і
// НІКОЛИ не тримає в пам'яті повні таблиці articles (5 млн рядків):
//
//   brandsById         — id -> назва бренду запчастини (таблиця
//                         `brands`, 3068 рядків, тримаємо ВСЮ — крихітна)
//   manufacturersById  — id -> назва виробника/марки авто (таблиця
//                         `manufacturers`, 657 рядків, тримаємо ВСЮ)
//   modelsById         — id -> {manufacturerId, yearFrom, yearTo}
//                         (таблиця `models`, 12 500 рядків, тримаємо ВСЮ)
//   matchedArticles    — tecdoc article_id -> {brand, article}, і ЛИШЕ
//                         для тих рядків `articles`, чий очищений
//                         артикул реально є у ВАШІЙ products.article.
//                         Це і є те звуження "тільки перетин з нашим
//                         каталогом", яке ви попросили — замість усіх
//                         4 981 555 рядків articles у пам'яті лишається
//                         щонайбільше стільки записів, скільки різних
//                         артикулів у вашому власному каталозі
//
// Структура реального дампу з'ясована ЕМПІРИЧНО (зразки реальних
// рядків, не документація TecDoc — офіційної схеми в дампі немає:
// це HeidiSQL/MySQL-експорт БЕЗ жодного CREATE TABLE):
//
//   brands(id, code, full_name, ???)
//   manufacturers(id, ?, ?, ?, ?, ?, code, full_name, ???)
//   articles(id, article_number, brand_id, ?, ?, ...)
//   models(id, manufacturer_id, tecdoc_type_code, year_from_yyyymm,
//          year_to_yyyymm, ...)
//
// Колонки поза цим списком (є в реальних рядках, але не потрібні для
// кросів/застосовності) свідомо ігноруються
// ============================================================

import { readDump } from './dumpReader';
import { cleanArticle } from './cleanArticle';

// Точні кількості рядків у ЦЬОМУ КОНКРЕТНОМУ файлі
// (tecdoc2016q1.sql), отримані одноразовим повним `npm run
// tecdoc:inspect`. Використовуються ЛИШЕ як необов'язкова оптимізація
// раннього виходу зі сканування (щоб не читати весь 12,7-гігабайтний
// файл до кінця, якщо потрібні таблиці вже повністю зібрані) — якщо
// ви імпортуєте ІНШИЙ дамп TecDoc, ці числа не збігатимуться: нічого
// не зламається, скрипт просто прочитає файл повністю, а не зупиниться
// раніше (early exit — це прискорення, не умова коректності)
const KNOWN_ROW_COUNTS = {
  articles: 4_981_555,
  brands: 3_068,
  manufacturers: 657,
};

export interface ModelInfo {
  manufacturerId: number;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface MatchedArticle {
  brand: string;
  article: string;
}

export interface ReferenceData {
  brandsById: Map<number, string>;
  manufacturersById: Map<number, string>;
  modelsById: Map<number, ModelInfo>;
  matchedArticles: Map<number, MatchedArticle>;
}

// YYYYMM (напр. 199109) -> рік (1991). null для порожніх/нульових значень
function yearFromYyyymm(value: unknown): number | null {
  const num = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  const year = Math.floor(num / 100);
  return year > 1900 && year < 2100 ? year : null;
}

class EarlyExit extends Error {}

export async function loadReferenceData(
  dumpPath: string,
  ourArticles: ReadonlySet<string>,
  onProgress?: (linesRead: number, elapsedMs: number) => void
): Promise<ReferenceData> {
  const brandsById = new Map<number, string>();
  const manufacturersById = new Map<number, string>();
  const modelsById = new Map<number, ModelInfo>();
  const matchedArticles = new Map<number, MatchedArticle>();

  // Окремий лічильник — скільки рядків articles РЕАЛЬНО побачили
  // (а не скільки з них збіглося з нашим каталогом): matchedArticles.size
  // для цього не годиться, бо майже завжди набагато МЕНШИЙ за повну
  // кількість рядків articles у дампі
  let articlesSeen = 0;

  // articleId -> brandId для зматчених артикулів. Заповнюється під час
  // читання файлу (коли brandsById може ще бути неповним — порядок
  // таблиць у дампі наперед невідомий), а резолвиться у справжню назву
  // бренду вже ПІСЛЯ читання, коли brandsById гарантовано повний
  const matchedArticleBrandIds = new Map<number, number>();

  try {
    await readDump(dumpPath, {
      onInsertRows(table, rows) {
        if (table === 'brands') {
          for (const row of rows) {
            const id = Number(row[0]);
            const name = String(row[2] ?? row[1] ?? '').trim();
            if (Number.isFinite(id) && name) brandsById.set(id, name);
          }
        } else if (table === 'manufacturers') {
          for (const row of rows) {
            const id = Number(row[0]);
            const name = String(row[7] ?? row[6] ?? '').trim();
            if (Number.isFinite(id) && name) manufacturersById.set(id, name);
          }
        } else if (table === 'models') {
          for (const row of rows) {
            const id = Number(row[0]);
            if (!Number.isFinite(id)) continue;
            modelsById.set(id, {
              manufacturerId: Number(row[1]),
              yearFrom: yearFromYyyymm(row[3]),
              yearTo: yearFromYyyymm(row[4]),
            });
          }
        } else if (table === 'articles') {
          articlesSeen += rows.length;
          for (const row of rows) {
            const clean = cleanArticle(row[1]);
            if (clean && ourArticles.has(clean)) {
              matchedArticles.set(Number(row[0]), { brand: '', article: clean });
              // brand заповнюємо пізніше, ОДНИМ проходом по matchedArticles
              // вже ПІСЛЯ повного читання файлу — на момент цього рядка
              // маппінг brandsById може ще не бути повним (порядок таблиць
              // у дампі наперед невідомий), тому зберігаємо тут id бренду
              // окремо і резолвимо назву вже потім
              matchedArticleBrandIds.set(Number(row[0]), Number(row[2]));
            }
          }
        }

        if (
          brandsById.size >= KNOWN_ROW_COUNTS.brands &&
          manufacturersById.size >= KNOWN_ROW_COUNTS.manufacturers &&
          articlesSeen >= KNOWN_ROW_COUNTS.articles
        ) {
          throw new EarlyExit();
        }
      },
      progressEveryLines: 5_000_000,
      onProgress: onProgress ? (stats) => onProgress(stats.linesRead, stats.elapsedMs) : undefined,
    });
  } catch (error) {
    if (!(error instanceof EarlyExit)) throw error;
  }

  // Резолвимо назву бренду для кожного зматченого артикула тепер, коли
  // brandsById гарантовано повний (файл дочитано повністю або раннього
  // виходу досягнуто ЛИШЕ після того, як brands теж повністю зібрано)
  for (const [articleId, match] of matchedArticles) {
    const brandId = matchedArticleBrandIds.get(articleId);
    match.brand = (brandId !== undefined ? brandsById.get(brandId) : undefined) || 'TECDOC';
  }

  return { brandsById, manufacturersById, modelsById, matchedArticles };
}
