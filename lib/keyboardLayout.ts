// ============================================================
// Исправление ошибки раскладки клавиатуры в поиске.
//
// Покупатель часто печатает артикул, забыв переключить язык:
// хотел "oc90", а набрал "щс90" (те же клавиши на украинской/русской
// раскладке). switchKeyboardLayout переводит текст на другую раскладку
// по положению клавиш: кириллица -> латиница и наоборот.
//
// Используется, когда поиск ничего не нашёл: пробуем ещё раз с
// исправленной раскладкой (components/StorefrontHome.tsx — основной
// поиск, components/SearchSuggestions.tsx — подсказки при вводе).
// ============================================================

// Клавиши латинской раскладки (QWERTY) и что на них стоит в
// украинской (ЙЦУКЕН). Русские буквы, которых нет в украинской
// раскладке (ы, э, ъ, ё), добавлены отдельно ниже
const LATIN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const UKRAINIAN = 'йцукенгшщзхїфівапролджєячсмитьбю\'';

const CYR_TO_LAT: Record<string, string> = {};
const LAT_TO_CYR: Record<string, string> = {};
for (let i = 0; i < LATIN.length; i++) {
  CYR_TO_LAT[UKRAINIAN[i]] = LATIN[i];
  LAT_TO_CYR[LATIN[i]] = UKRAINIAN[i];
}
// Русская раскладка: на тех же клавишах
Object.assign(CYR_TO_LAT, { ы: 's', э: "'", ъ: ']', ё: '`' });

const CYRILLIC_RE = /[а-яёіїєґ]/i;
const LATIN_RE = /[a-z]/i;

// Возвращает текст в другой раскладке или null, если менять нечего
// (нет букв или текст смешанный — тогда это, скорее всего, не ошибка)
export function switchKeyboardLayout(text: string): string | null {
  const value = text.trim();
  const hasCyrillic = CYRILLIC_RE.test(value);
  const hasLatin = LATIN_RE.test(value);
  if (hasCyrillic === hasLatin) return null;

  const map = hasCyrillic ? CYR_TO_LAT : LAT_TO_CYR;
  const switched = Array.from(value)
    .map((char) => {
      const lower = char.toLowerCase();
      const mapped = map[lower];
      if (mapped === undefined) return char;
      return char === lower ? mapped : mapped.toUpperCase();
    })
    .join('');
  return switched !== value ? switched : null;
}
