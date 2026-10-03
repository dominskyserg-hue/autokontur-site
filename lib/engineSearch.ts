// ============================================================
// Поиск запчастей по коду мотора ("4G18", "4D56", "1NZ-FE", "K24A").
//
// Отдельной таблицы моторов у нас нет — после удаления данных TecDoc
// (30.09.2026) единственное, что связывает деталь с мотором, это код
// мотора В НАЗВАНИИ товара: "Поршень STD 4G18 Lancer 9", "Помпа
// 4G13/4G18", "Кольца поршневые ... Lancer IX 1.6 4G18". Поэтому
// поиск по мотору — это точное совпадение кода как отдельного "слова"
// в products.name_search.
//
// Почему не обычный поиск: он ищет подстроку в артикуле (article ILIKE
// '%4G18%'), из-за чего в выдачу попадают чужие детали, у которых
// "4G18" случайно оказался внутри артикула.
//
// Режим "мотор" включается, только если выполнены ВСЕ условия:
//   1. запрос похож на код мотора (буквы + цифры, 3-8 символов);
//   2. это не очевидно не-моторное обозначение (4WD, 5W30, 4X4...);
//   3. код как отдельное слово есть в названиях минимум
//      ENGINE_MIN_MATCHES товаров (иначе это что-то другое);
//   4. если при этом есть товар с ТАКИМ артикулом, то название должно
//      встречаться заметно чаще (ENGINE_MIN_MATCHES_WITH_ARTICLE) —
//      иначе это артикул детали. Сам товар с этим артикулом в
//      выдаче остаётся.
// Иначе поиск работает как раньше.
// ============================================================

import type { Pool } from 'pg';
import { foldLookalikes } from './latinLookalikes';

// Сколько товаров с кодом в названии нужно, чтобы считать запрос
// кодом мотора, а не случайным совпадением
const ENGINE_MIN_MATCHES = 5;
// То же, но когда есть товар с артикулом, равным запросу (например,
// у мотора 4D56 есть деталь с артикулом "4D56")
const ENGINE_MIN_MATCHES_WITH_ARTICLE = 15;

// Тот же набор разделителей, что в lib/searchSynonyms.ts и в индексе
// idx_products_name_search_compact_trgm (schema.sql) — передаётся
// параметром, иначе из-за двойного экранирования бэкслешей он ломается
const SEPARATORS_REGEX = '[\\s\\-_./\\\\]+';

// Границы "слова": любая не-буква и не-цифра (латиница, кириллица)
const WORD_EDGE = '[^a-zа-яіїєґ0-9]';

export interface EngineQuery {
  // Код мотора для показа покупателю: "4G18", "1NZFE"
  code: string;
  // Условие WHERE для products p и параметры (нумерация с startParamIndex)
  clause: string;
  params: unknown[];
}

// Обозначения, которые выглядят как код мотора (буквы + цифры), но
// моторами не являются: привод, вязкость масла, схема колёс, размеры
function isNotEngine(flat: string): boolean {
  return (
    /^[24]WD$/.test(flat) || // 4WD, 2WD — привод
    /^[0-9]{1,2}W[0-9]{2}$/.test(flat) || // 5W30, 10W40 — вязкость масла
    /^[0-9]X[0-9]$/.test(flat) || // 4X4, 6X4 — колёсная формула
    /^[0-9]+(MM|CM|KG|ML|PCS|SM|SD|FS)$/.test(flat) || // размеры и единицы
    /^[0-9]+Z?R[0-9]+$/.test(flat) // 205R16 — шины
  );
}

// Приводит ввод покупателя к коду без разделителей или null, если
// ввод на код мотора не похож
export function parseEngineCode(search: string): string | null {
  const text = search.trim().toUpperCase().replace(/\s+/g, ' ');
  // "4G18", "K24A", "SR20DE", "1NZ-FE", "1NZ FE"
  if (!/^[A-Z0-9]{2,6}(?:[- ][A-Z0-9]{1,4})?$/.test(text)) return null;

  const flat = text.replace(/[- ]/g, '');
  if (flat.length < 3 || flat.length > 8) return null;
  if (!/[A-Z]/.test(flat) || !/[0-9]/.test(flat)) return null;
  if (isNotEngine(flat)) return null;
  return flat;
}

// Регулярное выражение для name_search: код целым "словом", между
// группами букв и цифр допускаются пробел или дефис ("1NZ-FE" найдёт
// и "1NZFE", и "1NZ FE"). Буквы-двойники сворачиваются так же, как в
// самой колонке name_search
function buildEngineRegex(code: string): string {
  const runs = code.match(/[A-Z]+|[0-9]+/g) ?? [];
  const body = runs.map((run) => foldLookalikes(run)).join('[ -]?');
  return `(^|${WORD_EDGE})${body}($|${WORD_EDGE})`;
}

// Проверяет, что запрос — код мотора, и собирает условие поиска.
// Возвращает null, если это не мотор (тогда работает обычный поиск)
export async function detectEngineQuery(
  pool: Pool,
  search: string,
  startParamIndex: number
): Promise<EngineQuery | null> {
  const code = parseEngineCode(search);
  if (!code) return null;

  // Есть ли товар с таким артикулом (тогда нужен более строгий порог)
  const articleHit = await pool.query('SELECT 1 FROM products WHERE article = $1 LIMIT 1', [code]);
  const hasArticle = (articleHit.rowCount ?? 0) > 0;
  const needed = hasArticle ? ENGINE_MIN_MATCHES_WITH_ARTICLE : ENGINE_MIN_MATCHES;

  const regex = buildEngineRegex(code);
  const compactLike = `%${foldLookalikes(code)}%`;

  // Условие 3: код встречается в названиях достаточно часто.
  // Сначала грубый отбор по индексу без разделителей (быстро), потом
  // точная проверка регуляркой
  const hits = await pool.query(
    `SELECT 1 FROM products p
     WHERE p.is_active = true AND p.stock > 0
       AND regexp_replace(p.name_search, $1, '', 'g') ILIKE $2
       AND p.name_search ~ $3
     LIMIT ${needed}`,
    [SEPARATORS_REGEX, compactLike, regex]
  );
  if ((hits.rowCount ?? 0) < needed) return null;

  const i = startParamIndex;
  return {
    code,
    // Название с кодом мотора ИЛИ товар с таким артикулом (если он есть).
    // Товары с нулевой ценой не показываем: это сбойные строки прайса
    clause: `(p.stock > 0 AND p.retail_price > 0 AND ((regexp_replace(p.name_search, $${i}, '', 'g') ILIKE $${i + 1} AND p.name_search ~ $${i + 2}) OR p.article = $${i + 3}))`,
    params: [SEPARATORS_REGEX, compactLike, regex, code],
  };
}
