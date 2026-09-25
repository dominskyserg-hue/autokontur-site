// ============================================================
// Латинські "двійники" кириличних літер усередині кириличних слів.
// У прайсах постачальників часто трапляється "Фiльтр", де "i" — ЛАТИНСЬКА
// (виглядає як українська "і", але це інший символ) — такий текст не
// знаходиться пошуком за "фільтр" і ламає розпізнавання слів.
//
// fixLatinLookalikes — для ВИВОДУ (назви товарів): виправляє лише ті
// слова, де є хоч одна кирилична літера, УСІ латинські літери — з
// таблиці двійників, а кириличних літер СТРОГО більше, ніж латинських
// ("Фiльтр" -> "Фільтр", "U-обpазный" -> "U-образный"). Чисто латинські
// слова (Toyota, KIA, ABS) та слова, де латиниці не менше, ніж
// кирилиці, не чіпаються.
//
// foldLookalikes — для ПОШУКУ: без розбору слів заміняє ВСІ двійники на
// кирилицю в нижньому регістрі. Застосовується СИМЕТРИЧНО до запиту і
// до назви товару (в SQL — той самий translate), тому збіг працює
// незалежно від того, якою літерою написано слово з якого боку
// ============================================================

const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = {
  i: 'і', a: 'а', o: 'о', e: 'е', c: 'с', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в',
  I: 'І', A: 'А', O: 'О', E: 'Е', C: 'С', P: 'Р', X: 'Х', Y: 'У', K: 'К', M: 'М', T: 'Т', H: 'Н', B: 'В',
};

// Для SQL translate(): рядки однакової довжини (нижній регістр)
export const LOOKALIKE_LATIN_LOWER = 'iaoecpxykmthb';
export const LOOKALIKE_CYRILLIC_LOWER = 'іаоесрхукмтнв';

const TOKEN_RE = /[A-Za-zА-Яа-яЁёІіЇїЄєҐґ]+/g;
const CYRILLIC_LETTER_RE = /[А-Яа-яЁёІіЇїЄєҐґ]/g;
const LATIN_LETTER_RE = /[A-Za-z]/g;

export function fixLatinLookalikes(text: string): string {
  return text.replace(TOKEN_RE, (token) => {
    const cyrillicCount = (token.match(CYRILLIC_LETTER_RE) ?? []).length;
    if (cyrillicCount === 0) return token;
    const latinLetters = token.match(LATIN_LETTER_RE) ?? [];
    if (latinLetters.length === 0 || cyrillicCount <= latinLetters.length) return token;
    if (latinLetters.some((letter) => !(letter in LATIN_TO_CYRILLIC))) return token;
    return token.replace(LATIN_LETTER_RE, (letter) => LATIN_TO_CYRILLIC[letter]);
  });
}

export function foldLookalikes(text: string): string {
  const lower = text.toLowerCase();
  let result = '';
  for (const char of lower) {
    const index = LOOKALIKE_LATIN_LOWER.indexOf(char);
    result += index === -1 ? char : LOOKALIKE_CYRILLIC_LOWER[index];
  }
  return result;
}
