// ============================================================
// Розпізнавання марки/моделі/року авто у ВІЛЬНОМУ тексті пошуку —
// щоб запит на кшталт "ремінь грм на мазду 626 1992 року" знаходив
// деталь, навіть коли покупець не знає точний артикул і просто описує
// деталь + авто одним реченням.
//
// Використовується в app/api/products/route.ts ПІСЛЯ того, як з
// тексту вже вирізана категорія деталі (lib/searchSynonyms.ts,
// "ремінь грм" → категорія "ремені ГРМ") — сюди приходить те, що
// лишилось: "на мазду 626 1992 року". Ця функція:
//   1. знаходить марку (lib/carMakes.ts, detectCarMakeInText) —
//      "мазду" → Mazda, dbValues ["MAZDA"];
//   2. знаходить 4-значний рік (1900-2099) — "1992";
//   3. усе, що лишилось після цього ("626"), очищене від прийменників
//      ("на", "року" тощо) — це "натяк" на модель, шукається як
//      підрядок у p.car_model / tecdoc_compatibility.model.
//
// Якщо марка НЕ розпізнана — повертає null: тоді запит обробляється
// так само, як і раніше (звичайний пошук підрядка в назві товару),
// без жодної зміни поведінки для вже працюючих запитів
// ============================================================

import { detectCarMakeInText, CAR_QUERY_STOPWORDS, type DetectedCarMake } from './carMakes';
import { stripPartVocabularyWords } from './categories';

// Слова "словника запчастин", яких НЕМАЄ в lib/categories.ts — там
// навмисно вузькі стеми (точність важливіша для категорійних сторінок:
// наприклад "ремінь" там відсутній, бо сам по собі він занадто
// широкий для категорії "Ремені та ролики ГРМ" — це міг би бути й
// ремінь генератора). Тут навпаки: чим ширше, тим краще — зайве
// "вилучене" з тексту слово нічого не ламає, а от зайве слово, що
// ЛИШИЛОСЬ у modelHint (напр. "ремінь 626" замість "626"), псує
// пошук моделі авто
const EXTRA_PART_WORDS = [
  'ремін', 'ремен', 'ролик', 'натяжувач', 'натяжител',
  'прокладк', 'помп', 'насос', 'зчеплен', 'сцеплен',
  'підшипник', 'подшипник', 'датчик', 'глушник', 'глушител',
  'радіатор', 'радиатор', 'кермов', 'рульов', 'рулев',
  'генератор', 'стартер', 'акумулятор', 'аккумулятор',
  'пружин', 'важіль', 'рычаг', 'кулис',
];

function stripAllPartVocabulary(text: string): string {
  const afterCategories = stripPartVocabularyWords(text);
  return afterCategories
    .split(/\s+/)
    .filter((word) => word.trim().length > 0)
    .filter((word) => !EXTRA_PART_WORDS.some((term) => word.toLowerCase().includes(term)))
    .join(' ')
    .trim();
}

export interface CarTextReference {
  makeDbValues: string[];
  year: string | null;
  modelHint: string | null;
}

// 1900-2099 — той самий діапазон, що вже неявно мається на увазі в
// tc.year_from/year_to (app/api/products/route.ts, BETWEEN ... 1900
// AND ... 2100). Рік розпізнається лише як ОКРЕМЕ "слово" з 4 цифр,
// щоб не зачепити частину артикула чи номера моделі
const YEAR_PATTERN = /\b(19|20)\d{2}\b/;

function stripStopwords(text: string): string {
  const words = text
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !CAR_QUERY_STOPWORDS.includes(w.toLowerCase()));
  return words.join(' ').trim();
}

export function extractCarReference(rawText: string): CarTextReference | null {
  const detected: DetectedCarMake | null = detectCarMakeInText(rawText);
  if (!detected) return null;

  // Вирізаємо саме те слово марки, яке реально знайшлось ("мазду"), —
  // регістронезалежно, першу появу
  let remaining = rawText.replace(new RegExp(detected.matchedText, 'i'), ' ');

  const yearMatch = remaining.match(YEAR_PATTERN);
  const year = yearMatch ? yearMatch[0] : null;
  if (yearMatch) {
    remaining = remaining.slice(0, yearMatch.index) + ' ' + remaining.slice((yearMatch.index || 0) + yearMatch[0].length);
  }

  // Прибираємо і прийменники ("на", "року"), і "словник запчастин"
  // ("ремінь", "грм", "колодки"...) — інакше вони потрапили б у
  // modelHint і зіпсували б пошук моделі авто ("ремінь грм 626"
  // замість чистого "626")
  const withoutStopwords = stripStopwords(remaining);
  const cleaned = stripAllPartVocabulary(withoutStopwords);
  const modelHint = cleaned.length > 0 ? cleaned : null;

  return { makeDbValues: detected.dbValues, year, modelHint };
}
