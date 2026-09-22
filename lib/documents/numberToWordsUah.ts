// ============================================================
// "Сума прописом" — переводить число (наприклад 1250.5) у текст
// українською мовою ("Одна тисяча двісті п'ятдесят гривень 50
// копійок"), як того вимагає бланк рахунку-фактури й акта повернення.
//
// Українська мова узгоджує "один/одна" і "два/дві" з родом іменника,
// до якого вони відносяться: "тисяча", "гривня" й "копійка" —
// жіночого роду ("одна тисяча", "дві гривні"), а "мільйон" і
// "мільярд" — чоловічого ("один мільйон", "два мільйони"). Тому
// нижче для кожного розряду ("трійки" цифр) явно вказано, якого
// роду іменник, яким цей розряд озвучується.
// ============================================================

type Gender = 'm' | 'f';

const ONES: Record<Gender, string[]> = {
  m: ['', 'один', 'два', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'],
  f: ['', 'одна', 'дві', 'три', 'чотири', 'п’ять', 'шість', 'сім', 'вісім', 'дев’ять'],
};

const TEENS = [
  'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять',
  'п’ятнадцять', 'шістнадцять', 'сімнадцять', 'вісімнадцять', 'дев’ятнадцять',
];

const TENS = [
  '', '', 'двадцять', 'тридцять', 'сорок', 'п’ятдесят',
  'шістдесят', 'сімдесят', 'вісімдесят', 'дев’яносто',
];

const HUNDREDS = [
  '', 'сто', 'двісті', 'триста', 'чотириста',
  'п’ятсот', 'шістсот', 'сімсот', 'вісімсот', 'дев’ятсот',
];

// Три форми іменника залежно від числа, що передує (1 / 2-4 / 5-20,
// а також усі числа, що закінчуються на 5-9, 0 або на 11-14) —
// стандартне правило вибору відмінка після числівника в українській
function pluralForm(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;

  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

// Озвучує число від 0 до 999 (одну "трійку" розряду)
function tripletToWords(n: number, gender: Gender): string {
  const parts: string[] = [];

  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);

  if (rest >= 10 && rest <= 19) {
    parts.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens > 0) parts.push(TENS[tens]);
    if (ones > 0) parts.push(ONES[gender][ones]);
  }

  return parts.join(' ');
}

const SCALES: Array<{ gender: Gender; forms: [string, string, string] }> = [
  { gender: 'f', forms: ['', '', ''] },                                 // одиниці — без назви розряду
  { gender: 'f', forms: ['тисяча', 'тисячі', 'тисяч'] },
  { gender: 'm', forms: ['мільйон', 'мільйони', 'мільйонів'] },
  { gender: 'm', forms: ['мільярд', 'мільярди', 'мільярдів'] },
];

// Озвучує ціле невід'ємне число словами українською
function integerToWords(value: number): string {
  if (value === 0) return 'нуль';

  const triplets: number[] = [];
  let remaining = Math.round(value);
  while (remaining > 0) {
    triplets.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts: string[] = [];
  for (let i = triplets.length - 1; i >= 0; i--) {
    const triplet = triplets[i];
    if (triplet === 0) continue;

    const scale = SCALES[i];
    const words = tripletToWords(triplet, scale.gender);
    parts.push(words);
    if (scale.forms[0]) {
      parts.push(pluralForm(triplet, scale.forms));
    }
  }

  return parts.join(' ');
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Переводить грошову суму (з копійками) у текст: "Одна тисяча двісті
// п'ятдесят гривень 50 копійок". amount округлюється до копійок,
// щоб уникнути похибок плаваючої крапки (0.1 + 0.2 і т.п.)
export function amountToWordsUah(amount: number): string {
  const totalKopecks = Math.round(Math.abs(amount) * 100);
  const hryvnias = Math.floor(totalKopecks / 100);
  const kopecks = totalKopecks % 100;

  const hryvniasWords = capitalize(integerToWords(hryvnias));
  const hryvniasLabel = pluralForm(hryvnias, ['гривня', 'гривні', 'гривень']);
  const kopecksLabel = pluralForm(kopecks, ['копійка', 'копійки', 'копійок']);

  return `${hryvniasWords} ${hryvniasLabel} ${String(kopecks).padStart(2, '0')} ${kopecksLabel}`;
}
