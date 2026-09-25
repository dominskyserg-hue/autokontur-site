// ============================================================
// КРОК 2 очистки назв товарів: переклад російських слів на українські
// ПРИ ВИВОДІ (products.name у базі НЕ змінюється). Працює поверх
// результату КРОКУ 1 (lib/productNameCleanup.ts, buildCleanProductName).
//
// СТАТУС: підготовлено, але ще НЕ підключено до сайту (не імпортується
// в lib/productDetail.ts) — чекає підтвердження словника власником.
//
// Правила:
//   - Заміни лише ЦІЛИМИ словами (з словника RU_UA_DICTIONARY), регістр
//     першої літери зберігається ("Крышка" -> "Кришка", "КРЫШКА" ->
//     "КРИШКА")
//   - Фразові правила застосовуються ДО пословних — там, де
//     узгодження роду/відмінка залежить від сусіднього слова
//     ("рулевой рейки" -> "рульової рейки", "передней двери" ->
//     "передніх дверей": двері — лише множина)
//   - "масло" -> "олива" (ср. рід -> жін.), тому прикметники, що
//     стоять поряд ("моторное", "синтетическое"...), теж переводяться
//     у жіночий рід — але ЛИШЕ якщо в назві є саме "масло/масла/маслом"
//   - СТРАХОВКА: якщо після перекладу в назві лишились літери ы/э/ъ/ё
//     АБО будь-яке кириличне слово на -ое/-ая/-ее (ознака російської
//     форми, яку словник не покрив), АБО слово з "неоднозначного"
//     списку (рулевой... без відомого іменника) — переклад НЕ
//     застосовується взагалі, повертається назва КРОКУ 1 без змін
//     (краще залишити цілу російську назву, ніж показати суржик).
//     Тому й правило "масло не перекладати, якщо поруч лишився
//     неперекладений прикметник середнього роду" виконується
//     автоматично: така назва залишається як у КРОКУ 1
//   - Курований список марок (lib/carMakes.ts) застосовується до
//     назви ЗАВЖДИ (і коли переклад відкинуто страховкою): "toyota mark 2"
//     -> "Toyota mark 2"
// ============================================================

import { RU_UA_DICTIONARY } from '@/lib/productNameDictionary';
import { CAR_MAKES } from '@/lib/carMakes';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { isWhitelistedWord } from '@/lib/productNameWhitelist';

const CYR = 'а-яёіїєґ';
const WORD_RE = new RegExp(`[${CYR}]+`, 'gi');

// Зберігає регістр оригіналу: ВЕЛИКІ -> ВЕЛИКІ, "Перша" -> "Перша", інакше як є
function preserveCase(original: string, translated: string): string {
  const letters = original.replace(new RegExp(`[^${CYR}A-Za-z]`, 'gi'), '');
  if (letters.length >= 2 && letters === letters.toUpperCase()) return translated.toUpperCase();
  if (original.charAt(0) !== original.charAt(0).toLowerCase()) {
    return translated.charAt(0).toUpperCase() + translated.slice(1);
  }
  return translated;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Фраза "слово1 слово2" -> регістронезалежний regex з межами слів
// (кирилиця не входить у \w, тому \b тут не годиться) і гнучким пробілом
function phraseRegex(phrase: string): RegExp {
  const body = phrase.split(/\s+/).map(escapeRegex).join('\\s+');
  return new RegExp(`(?<![${CYR}])${body}(?![${CYR}])`, 'gi');
}

// Фразові правила — ДО пословного словника
const PHRASE_PAIRS: ReadonlyArray<[string, string]> = [
  ['рулевой рейки', 'рульової рейки'],
  ['рулевой тяги', 'рульової тяги'],
  ['рулевой колонки', 'рульової колонки'],
  ['рулевой трапеции', 'рульової трапеції'],
  ['рулевая рейка', 'рульова рейка'],
  ['рулевая тяга', 'рульова тяга'],
  ['рулевые тяги', 'рульові тяги'],
  ['рулевой наконечник', 'рульовий наконечник'],
  ['рулевого наконечника', 'рульового наконечника'],
  ['рулевые наконечники', 'рульові наконечники'],
  ['шаровой опоры', 'кульової опори'],
  // "Г/Б" у прайсі AVDOC = "головки блока" (прокладка Г/Б)
  ['г/б', 'ГБЦ'],
  // "двері" — лише множина: "ручка двери" = "ручка дверей"
];
const PHRASES: ReadonlyArray<[RegExp, string]> = PHRASE_PAIRS.map(([ru, ua]) => [phraseRegex(ru), ua]);

// Двері — лише множина, тому всі прикметники-визначення (родовий відмінок
// однини жін. роду) поряд із "двери" переходять у множину РАЗОМ із
// іменником: "задней левой двери" -> "задніх лівих дверей",
// "двери задней" -> "дверей задніх". Дозволена цифра в дужках між ними
// ("задней (5) двери")
const DOOR_ADJ_UA: Readonly<Record<string, string>> = {
  передней: 'передніх', задней: 'задніх', левой: 'лівих', правой: 'правих',
  верхней: 'верхніх', нижней: 'нижніх', боковой: 'бічних',
};
const DOOR_ADJ_NOM_UA: Readonly<Record<string, string>> = {
  передняя: 'передні', задняя: 'задні', левая: 'ліві', правая: 'праві',
  верхняя: 'верхні', нижняя: 'нижні', боковая: 'бічні',
};
const DOOR_ADJ_ALT = Object.keys(DOOR_ADJ_UA).join('|');
const DOOR_ADJ_NOM_ALT = Object.keys(DOOR_ADJ_NOM_UA).join('|');
const DOOR_CHAIN_BEFORE_RE = new RegExp(
  `(?<![${CYR}])((?:(?:${DOOR_ADJ_ALT})\\s+(?:\\(\\d+\\)\\s+)?)+)двери(?![${CYR}])`,
  'gi'
);
const DOOR_CHAIN_AFTER_RE = new RegExp(`(?<![${CYR}])двери((?:\\s+(?:${DOOR_ADJ_ALT}))+)(?![${CYR}])`, 'gi');
const DOOR_NOM_BEFORE_RE = new RegExp(`(?<![${CYR}])((?:(?:${DOOR_ADJ_NOM_ALT})\\s+)+)дверь(?![${CYR}])`, 'gi');

function translateDoorAdjectives(chain: string, table: Readonly<Record<string, string>>): string {
  return chain.replace(WORD_RE, (word) => {
    const translated = table[word.toLowerCase()];
    return translated ? preserveCase(word, translated) : word;
  });
}

// "лев." -> "лів." (крапка входить у слово, тому окремо від словника)
const LEV_ABBREVIATION_RE = new RegExp(`(?<![${CYR}])лев\\.`, 'gi');
// "груз." (вантажний) -> "вантаж." — так само окремо, бо з крапкою
const GRUZ_ABBREVIATION_RE = new RegExp(`(?<![${CYR}])груз\\.`, 'gi');

// Прикметники поряд із "масло" (ср. рід -> жін. рід "оливи")
const OIL_NOUN_RE = new RegExp(`(?<![${CYR}])(масло|масла|маслом)(?![${CYR}])`, 'i');
const OIL_ADJECTIVES: Readonly<Record<string, string>> = {
  моторное: 'моторна', моторного: 'моторної', моторным: 'моторною',
  трансмиссионное: 'трансмісійна', трансмиссионного: 'трансмісійної', трансмиссионным: 'трансмісійною',
  синтетическое: 'синтетична', синтетического: 'синтетичної', синтетическим: 'синтетичною',
  полусинтетическое: 'напівсинтетична', полусинтетического: 'напівсинтетичної', полусинтетическим: 'напівсинтетичною',
  минеральное: 'мінеральна', минерального: 'мінеральної', минеральным: 'мінеральною',
};

// Слова, які НЕ перекладаємо без додаткової умови: "полосовидный" ->
// "поліклиновий" лише коли в назві є маркування \d+PK (напр. 6PK1200);
// без нього слово лишається російським, а отже й УСЯ назва відкидається
// страховкою (щоб не вийшов суржик "Ремінь полосовидный")
const POLOSOVIDNY_WORDS: ReadonlySet<string> = new Set(['полосовидный', 'полосовидная', 'полосовидные', 'полосовидного']);
const POLI_V_MARKING_RE = /\d+\s*PK/i;

const RUSSIAN_LETTERS_RE = /[ыэъё]/i;
// Закінчення, яких НЕМАЄ в українській: -ое/-ая/-ее (укр. -е/-а), -ой
// (укр. -ої/-ою), -ция/-ции/-цию (укр. -ція/-ції/-цію), -ния/-нии/-ние
// (укр. -ння/-нні), -ский/-ские/-ских/-ского/-ской/-скую (укр. -ський/
// -ські/-ських/-ського/-ської/-ську — з м'яким знаком)
// Відомі РОСІЙСЬКІ слова без характерних літер/закінчень (найчастіші серед
// назв, що проходять за правилом "є і/ї/є/ґ") — перекладу в словнику для
// них поки нема, тож вони блокують назву. Кандидати в словник: отопителя ->
// опалювача, винт -> гвинт, палец -> палець, сеточка -> сіточка,
// дифференциала -> диференціала, ограничитель -> обмежувач
const KNOWN_RUSSIAN_WORDS: ReadonlySet<string> = new Set([
  'отопитель', 'отопителя', 'винт', 'винта', 'палец', 'пальца', 'сеточка', 'сеточки', 'возд',
  // "груз" без крапки (з крапкою — окреме правило "груз." -> "вантаж.")
  'груз',
  'дифференциал', 'дифференциала', 'ограничитель', 'ограничителя', 'диаметр', 'диаметра', 'звездочка', 'звездочки',
]);
const RUSSIAN_ENDING_RE = /(ое|ая|ее|ой|ции|ция|цию|ния|нии|ние|ский|ские|ских|ского|ской|скую|ющий|ющая)$/i;

// СТРАХОВКА v2: слова, які СЛОВНИК САМ ВИДАЄ як результат перекладу
// (значення словника, фраз, оливних та дверних прикметників) — вони
// свідомо українські. Будь-яке ІНШЕ кириличне слово в підсумковій
// назві має бути в білому списку (lib/productNameWhitelist.ts) або
// містити і/ї/є/ґ — інакше переклад відкидається
const PRODUCED_WORDS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  const sources: string[] = [
    ...Object.values(RU_UA_DICTIONARY),
    ...PHRASE_PAIRS.map(([, ua]) => ua),
    ...Object.values(OIL_ADJECTIVES),
    ...Object.values(DOOR_ADJ_UA),
    ...Object.values(DOOR_ADJ_NOM_UA),
    'дверей', 'двері', 'лів.', 'вантаж.', 'поліклиновий',
  ];
  for (const source of sources) for (const word of source.match(WORD_RE) ?? []) set.add(word.toLowerCase());
  return set;
})();

// Українські слова, які випадково закінчуються як російські ("плоский" —
// однаково в обох мовах; "ОЕ" кирилицею — маркування "оригінальне
// обладнання")
const RUSSIAN_ENDING_EXCEPTIONS: ReadonlySet<string> = new Set(['плоский', 'плоского', 'ое']);

// Ключ словника, що ЛИШИВСЯ в тексті після перекладу, — ознака російського
// слова. Але частина ключів перекладається САМА В СЕБЕ ("система",
// "вал", "болт", "фара" — однакові в обох мовах): такі не є ознакою
function isUntranslatedRussianKey(lowerWord: string): boolean {
  return Object.prototype.hasOwnProperty.call(RU_UA_DICTIONARY, lowerWord) && RU_UA_DICTIONARY[lowerWord] !== lowerWord;
}

/** Кириличні слова тексту, які страховка v2 не визнає (ні значення словника, ні білий список). */
// Одна ЗАГЛАВНА кирилична літера перед "-подібн..." — позначення форми
// ("П-подібна", "Г-подібний"), а не слово; не блокує переклад
const SHAPE_LETTER_RE = new RegExp(`(?<![${CYR}])[А-ЯІЇЄҐ](?=-подібн)`, 'g');

export function findBlockingWords(text: string): string[] {
  const blocking: string[] = [];
  for (const word of text.replace(SHAPE_LETTER_RE, '').match(WORD_RE) ?? []) {
    const lower = word.toLowerCase();
    if (!PRODUCED_WORDS.has(lower) && !isWhitelistedWord(lower)) blocking.push(lower);
  }
  return blocking;
}

/**
 * Переклад назви КРОКУ 1 на українську за словником. Якщо після
 * перекладу лишилось щось російське/невідоме (див. страховку v2) —
 * повертає назву КРОКУ 1 без змін.
 */
export function translateProductNameDetailed(stage1Name: string): { text: string; droppedBySafety: boolean; attempted: string; blockingWords: string[]; safe: boolean } {
  let text = stage1Name;

  text = text
    .replace(DOOR_CHAIN_BEFORE_RE, (match, chain: string) =>
      preserveCase(match, translateDoorAdjectives(chain, DOOR_ADJ_UA) + 'дверей')
    )
    .replace(DOOR_CHAIN_AFTER_RE, (match, chain: string) =>
      preserveCase(match, 'дверей' + translateDoorAdjectives(chain, DOOR_ADJ_UA))
    )
    .replace(DOOR_NOM_BEFORE_RE, (match, chain: string) =>
      preserveCase(match, translateDoorAdjectives(chain, DOOR_ADJ_NOM_UA) + 'двері')
    );

  // "С/б" на самому початку назви = сайлентблок (не чіпаємо "п/б", "б/у")
  text = text.replace(/^с\/б(?![а-яёіїєґ])/i, 'Сайлентблок');

  for (const [re, replacement] of PHRASES) {
    text = text.replace(re, (match) => preserveCase(match, replacement));
  }
  text = text.replace(LEV_ABBREVIATION_RE, (match) => preserveCase(match, 'лів.'));
  text = text.replace(GRUZ_ABBREVIATION_RE, (match) => preserveCase(match, 'вантаж.'));

  const hasOilNoun = OIL_NOUN_RE.test(stage1Name);
  const hasPolyVMarking = POLI_V_MARKING_RE.test(stage1Name);

  text = text.replace(WORD_RE, (word) => {
    const lower = word.toLowerCase();
    const oilAdjective = hasOilNoun ? OIL_ADJECTIVES[lower] : undefined;
    const translated =
      oilAdjective ?? (POLOSOVIDNY_WORDS.has(lower) ? (hasPolyVMarking ? 'поліклиновий' : undefined) : RU_UA_DICTIONARY[lower]);
    return translated ? preserveCase(word, translated) : word;
  });

  // droppedBySafety — переклад щось змінив би, але страховка його відкинула
  const changedByDictionary = text !== stage1Name;
  const blockingWords = findBlockingWords(text);

  // Російські ознаки: ы/э/ъ/ё, закінчення, яких немає в українській
  // (RUSSIAN_ENDING_RE), відомі російські слова (KNOWN_RUSSIAN_WORDS),
  // неперекладені ключі російського словника, "полосовидный" без PK.
  //
  // ВІДХИЛЕНЕ правило (не вмикати без нової перевірки): "є літера і/ї/є/ґ
  // і немає російських ознак -> назва проходить, навіть зі словами поза
  // корпусом". На випадковій вибірці 100 таких назв 28 були змішаними
  // ("Сетка паливного фільтра", "Гальмівна жидкость", "Подшипники опор
  // підвіски") — поріг власника був <= 5 зі 100. Тому слово поза
  // корпусом/білим списком, як і раніше, блокує переклад
  const words = text.match(WORD_RE) ?? [];
  const hasRussianSign =
    RUSSIAN_LETTERS_RE.test(text) ||
    words.some((word) => {
      const lower = word.toLowerCase();
      return (RUSSIAN_ENDING_RE.test(lower) && !RUSSIAN_ENDING_EXCEPTIONS.has(lower)) || KNOWN_RUSSIAN_WORDS.has(lower) || POLOSOVIDNY_WORDS.has(lower) || isUntranslatedRussianKey(lower);
    });

  if (hasRussianSign || blockingWords.length > 0) {
    return { text: stage1Name, droppedBySafety: changedByDictionary, attempted: text, blockingWords, safe: false };
  }
  return { text, droppedBySafety: false, attempted: text, blockingWords, safe: true };
}

export function translateProductName(stage1Name: string): string {
  return translateProductNameDetailed(stage1Name).text;
}

// ------------------------------------------------------------
// Курований список марок -> правильне написання ("toyota" -> "Toyota")
// ------------------------------------------------------------
// Береться курована назва (CarMakeDef.name) та значення dbValues
// довжиною >= 4 символів (щоб короткі абревіатури на кшталт "VW" не
// розгорталися в "Volkswagen" без потреби)
const MAKE_BY_LOWER: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const make of CAR_MAKES) {
    map.set(make.name.toLowerCase(), make.name);
    for (const value of make.dbValues) {
      if (value.length >= 4) map.set(value.toLowerCase(), make.name);
    }
  }
  return map;
})();

const MAKE_RE: RegExp = (() => {
  const keys = Array.from(MAKE_BY_LOWER.keys()).sort((a, b) => b.length - a.length);
  const alternatives = keys.map((key) => key.split(/\s+/).map(escapeRegex).join('\\s+')).join('|');
  return new RegExp(`(?<![A-Za-z0-9${CYR}])(${alternatives})(?![A-Za-z0-9${CYR}])`, 'gi');
})();

export function applyCuratedMakeNames(text: string): string {
  return text.replace(MAKE_RE, (match) => MAKE_BY_LOWER.get(match.toLowerCase().replace(/\s+/g, ' ')) ?? match);
}

/**
 * Повна назва для показу: КРОК 1 -> КРОК 2 (переклад зі страховкою) ->
 * курований регістр марок. null — якщо сире products.name порожнє.
 */
export function buildDisplayProductName(rawName: string | null | undefined): string | null {
  return buildDisplayProductNameDetailed(rawName)?.text ?? null;
}

/**
 * Те саме, але з ознакою safe: true — назва пройшла страховку (у ній
 * немає російських/невідомих слів), тобто її МОЖНА показувати як
 * українську назву в H1. false — переклад відкинуто, text — КРОК 1
 * (лише з куре регістром марок).
 */
export function buildDisplayProductNameDetailed(
  rawName: string | null | undefined
): { text: string; safe: boolean } | null {
  const stage1 = buildCleanProductName(rawName);
  if (!stage1) return null;
  const detailed = translateProductNameDetailed(stage1);
  return { text: applyCuratedMakeNames(detailed.text), safe: detailed.safe };
}
