// ============================================================
// Пошук за ключовими словами з урахуванням багатомовного словника
// синонімів (search_synonym_groups, schema.sql) — щоб запит
// "гальмівні колодки rav 4" знаходив товари, у назві яких написано
// "brake pads rav4" або "тормозные колодки rav4" тощо.
//
// Як це працює, крок за кроком (на прикладі "гальмівні колодки rav 4"):
//   1. У словнику є група з terms = ["гальмівні колодки", "тормозні
//      колодки", "brake pads", ...] — фраза "гальмівні колодки"
//      ЗНАЙДЕНА в запиті покупця (порівняння йде по цілих словах,
//      не по підрядку — інакше "колодки" всередині іншого слова теж
//      би зарахувалось).
//   2. Знайдену фразу "вирізаємо" із запиту. Група запам'ятовується:
//      далі товар шукатиметься за БУДЬ-ЯКИМ з termів цієї групи одразу
//      ("ALL of them", а не тільки той, що написав покупець).
//   3. Те, що лишилось від запиту ("rav 4"), очищується від пробілів/
//      дефісів так само, як cleanArticle() очищує артикул — щоб
//      "rav 4", "rav-4" і "rav4" вважались одним і тим же.
//   4. Товар підходить, якщо (а) його назва містить БУДЬ-ЯКИЙ термін
//      з кожної знайденої групи (по одній з кожної, якщо груп кілька)
//      І (б) його назва (так само очищена від пробілів/дефісів)
//      містить залишок запиту.
//
// Довжина фрази має значення: групи з словника сортуються від
// найдовшої фрази до найкоротшої, щоб спершу шукати "гальмівні
// колодки" цілком, а не окремо "гальмівні" й окремо "колодки".
// ============================================================

import type { Pool } from 'pg';

export interface SynonymGroup {
  id: string;
  label: string;
  terms: string[];
}

// Приймає вже наявний Pool (замість того, щоб заводити ще один окремий
// інстанс у цьому файлі) — на проді кожен окремий Pool додає ризик
// вичерпати ліміт з'єднань Supabase (див. коментар "max: 3" в
// app/api/products/route.ts), тож новий пул тут ні до чого
export async function loadSynonymDictionary(pool: Pool): Promise<SynonymGroup[]> {
  const result = await pool.query('SELECT id, label, terms FROM search_synonym_groups');
  return result.rows.map((row) => ({ id: row.id, label: row.label, terms: row.terms }));
}

// Прибирає зайві пробіли, приводить до нижнього регістру — для
// порівняння ЦІЛИХ ФРАЗ (слова відділені пробілами лишаються словами)
function normalizeForPhraseMatch(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Прибирає пробіли/дефіси/крапки повністю — та сама ідея, що й
// cleanArticle() в app/api/products/route.ts, потрібна для порівняння
// моделей на кшталт "rav 4" / "rav-4" / "rav4" як одного й того ж
function stripSeparators(text: string): string {
  return text.toLowerCase().replace(/[\s\-_./\\]+/g, '');
}

export interface ExpandedSearch {
  // Кожен масив — терміни ОДНІЄЇ знайденої групи (для SQL: ILIKE ANY(...))
  synonymTermGroups: string[][];
  // Залишок запиту після вирізання відомих словнику фраз, очищений
  // від розділювачів. null, якщо після вирізання нічого не лишилось
  leftover: string | null;
  // Той самий залишок, але БЕЗ очищення від пробілів — потрібен
  // lib/searchCarText.ts, де марка/рік/модель розпізнаються по цілих
  // словах ("мазда", "1992"), а не по злитому в одне слово тексту.
  // null з тієї ж причини, що й leftover вище
  leftoverRaw: string | null;
}

export function expandSearchQuery(rawQuery: string, dictionary: SynonymGroup[]): ExpandedSearch {
  const query = normalizeForPhraseMatch(rawQuery);
  if (!query) return { synonymTermGroups: [], leftover: null, leftoverRaw: null };

  // Плоский список усіх термінів з усіх груп, найдовші фрази (за
  // кількістю слів) — першими
  const allTerms: { normalized: string; groupId: string }[] = [];
  for (const group of dictionary) {
    for (const term of group.terms) {
      const normalized = normalizeForPhraseMatch(term);
      if (normalized) allTerms.push({ normalized, groupId: group.id });
    }
  }
  allTerms.sort((a, b) => b.normalized.split(' ').length - a.normalized.split(' ').length);

  // Пробіли з боків — щоб шукати ЦІЛІ слова/фрази, а не підрядок
  // всередині іншого слова ("колодки" не повинно зловити "накладки")
  let remaining = ` ${query} `;
  const matchedGroupIds: string[] = [];

  for (const { normalized, groupId } of allTerms) {
    if (matchedGroupIds.includes(groupId)) continue;
    const needle = ` ${normalized} `;
    const idx = remaining.indexOf(needle);
    if (idx !== -1) {
      remaining = remaining.slice(0, idx) + ' ' + remaining.slice(idx + needle.length);
      matchedGroupIds.push(groupId);
    }
  }

  const synonymTermGroups = matchedGroupIds.map((groupId) => {
    const group = dictionary.find((g) => g.id === groupId)!;
    return group.terms.map((term) => normalizeForPhraseMatch(term)).filter(Boolean);
  });

  const leftoverTrimmed = remaining.trim();
  const leftover = leftoverTrimmed ? stripSeparators(leftoverTrimmed) : null;

  return { synonymTermGroups, leftover, leftoverRaw: leftoverTrimmed || null };
}

// Перетворює результат expandSearchQuery() на SQL-умову й параметри —
// АБО між "кожен товар з назвою, що містить якийсь з термінів групи"
// (по одній умові на кожну знайдену групу, об'єднані через AND), плюс
// (якщо є) умова на залишок запиту за назвою, з якої прибрані пробіли/
// дефіси. Порожній результат (нічого не розпізнано) — null, значить
// цей шлях пошуку взагалі нічого не додає до запиту
// Той самий regex-паттерн, що й для normalize на боці Node.js
// (stripSeparators) — але тут він виконує ТУ САМУ роботу вже
// ВСЕРЕДИНІ Postgres, над назвою товару (regexp_replace). ЗАВЖДИ
// передається як параметр запиту ($n), а не текстом прямо в SQL —
// плутанина з подвійним екрануванням бекслешів (JS-рядок → SQL-рядок
// → regex) на практиці ламає патерн, якщо вписати його літералом
const SEPARATORS_REGEX = '[\\s\\-_./\\\\]+';

export function buildSynonymWhereClause(
  expanded: ExpandedSearch,
  startParamIndex: number
): { clause: string; params: unknown[] } | null {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = startParamIndex;

  for (const terms of expanded.synonymTermGroups) {
    params.push(terms.map((t) => `%${t}%`));
    conditions.push(`p.name ILIKE ANY($${paramIndex})`);
    paramIndex++;
  }

  if (expanded.leftover) {
    params.push(SEPARATORS_REGEX, `%${expanded.leftover}%`);
    conditions.push(
      `regexp_replace(LOWER(p.name), $${paramIndex}, '', 'g') ILIKE $${paramIndex + 1}`
    );
    paramIndex += 2;
  }

  if (conditions.length === 0) return null;
  return { clause: conditions.join(' AND '), params };
}
