// ============================================================
// "Родини" брендів для підстановки назви товару з іншого прайсу:
// коли в товару немає власної назви, беремо назву того самого
// артикула в іншого постачальника — але ЛИШЕ якщо це той самий бренд
// або пара, яку власник затвердив як "один виробник під різними
// іменами" (HYUNDAI/KIA <-> MOBIS, VAG <-> VW/Audi/Skoda/Seat,
// GM <-> AC Delco, Ford <-> Motorcraft, Toyota <-> Lexus,
// Nissan <-> Infiniti). Решта збігів за артикулом НЕ використовуються
// — однакові артикули у різних брендів іноді збігаються випадково
// ============================================================

export function normalizeBrandKey(brand: string | null | undefined): string {
  return (brand ?? '').toUpperCase().replace(/[^A-Z0-9А-Я]/g, '');
}

const ALLOWED_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['HYUNDAI', 'MOBIS'], ['KIA', 'MOBIS'],
  ['VAG', 'VW'], ['VAG', 'VOLKSWAGEN'], ['VAG', 'AUDI'], ['VAG', 'SKODA'], ['VAG', 'SEAT'],
  ['GM', 'ACDELCO'], ['FORD', 'MOTORCRAFT'], ['TOYOTA', 'LEXUS'], ['NISSAN', 'INFINITI'],
];

const PAIR_SET: ReadonlySet<string> = new Set(ALLOWED_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

export function brandsAreSameFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const keyA = normalizeBrandKey(a);
  const keyB = normalizeBrandKey(b);
  if (!keyA || !keyB) return false;
  return keyA === keyB || PAIR_SET.has(`${keyA}|${keyB}`);
}
