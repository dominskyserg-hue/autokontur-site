// ============================================================
// Сопоставление строк tecdoc_crosses с товаром по БРЕНДУ + артикулу.
//
// Раньше блок "Аналоги" на странице товара брал все строки с тем же
// артикулом (article_a), не глядя на бренд. Короткие и "круглые" номера
// встречаются у разных производителей, и товару доставались чужие
// аналоги: наш CARGO 12345 получал кроссы детали ELSTOCK 12345.
//
// Теперь строка подходит, только если её бренд (brand_a) — это:
//   1) тот же бренд после нормализации (регистр, пробелы, точки,
//      умлауты: "LEMFÖRDER" = "Lemforder");
//   2) тот же производитель в другом написании (SPELLING_GROUPS ниже —
//      пары взяты из реальных несовпадений в базе);
//   3) одобренная "родня" брендов из lib/brandFamilies.ts
//      (VAG <-> VW, MOBIS <-> HYUNDAI...);
//   4) для ОРИГИНАЛЬНЫХ запчастей (бренд — автопроизводитель) — ещё и
//      номера из прайсов с неизвестным брендом ('OEM/аналог'): это
//      OEM-номер, а его производитель и есть бренд нашего товара.
//
// Ключ бренда в JS (crossBrandKey) и в SQL (crossBrandKeySql) считается
// ОДИНАКОВО — иначе фильтр молча перестанет совпадать
// ============================================================

import { CAR_MAKES } from '@/lib/carMakes';
import { sameFamilyKeys } from '@/lib/brandFamilies';

// Метка скриптов импорта из прайсов для номера без известного бренда
// (scripts/tecdoc/import-*-crosses.ts, CROSS_BRAND_LABEL)
const PRICE_LABEL = 'OEM/аналог';

const UMLAUTS_FROM = 'ÄÖÜäöüÉÈéèß';
const UMLAUTS_TO = 'AOUaoueEeeS';

export function crossBrandKey(brand: string | null | undefined): string {
  let value = brand ?? '';
  for (let i = 0; i < UMLAUTS_FROM.length; i++) {
    value = value.split(UMLAUTS_FROM[i]).join(UMLAUTS_TO[i]);
  }
  return value.replace(/[^A-Za-z0-9А-Яа-я]/g, '').toUpperCase();
}

// Тот же ключ в SQL для колонки column
export function crossBrandKeySql(column: string): string {
  return `upper(regexp_replace(translate(${column}, '${UMLAUTS_FROM}', '${UMLAUTS_TO}'), '[^A-Za-z0-9А-Яа-я]', '', 'g'))`;
}

// Один производитель — разные написания (ключи уже нормализованы)
const SPELLING_GROUPS: string[][] = [
  ['AUTOFREN', 'AUTOFRENSEINSA'],
  ['WAI', 'WAIGLOBAL'],
  ['CARGO', 'HCCARGO'],
  ['VICTORREINZ', 'REINZ'],
  ['MAHLE', 'MAHLEORIGINAL', 'KNECHT'],
  ['FISCHER', 'FA1'],
  ['FEBI', 'FEBIBILSTEIN'],
  ['TOYOTALEXUS', 'TOYOTA', 'LEXUS'],
  ['HYUNDAIKIA', 'HYUNDAI', 'KIA', 'MOBIS'],
  ['NISSANINFINITI', 'NISSAN', 'INFINITI'],
];

// Бренды оригинальных запчастей: автопроизводители из lib/carMakes.ts
// и оригинальные "подбренды" поставщиков
const OEM_BRAND_KEYS = new Set<string>([
  ...CAR_MAKES.flatMap((make) => make.dbValues.map(crossBrandKey)),
  'VAG',
  'MOBIS',
  'TOYOTALEXUS',
  'HYUNDAIKIA',
  'NISSANINFINITI',
  'GM',
  'MOTORCRAFT',
]);

// Все ключи brand_a, которые считаются "тем же брендом", что и brand
export function crossBrandKeys(brand: string | null | undefined): string[] {
  const key = crossBrandKey(brand);
  if (!key) return [];

  const keys = new Set<string>([key]);
  for (const group of SPELLING_GROUPS) {
    if (group.includes(key)) group.forEach((k) => keys.add(k));
  }
  for (const k of [...keys]) sameFamilyKeys(k).forEach((f) => keys.add(f));

  if ([...keys].some((k) => OEM_BRAND_KEYS.has(k))) keys.add(crossBrandKey(PRICE_LABEL));
  return [...keys];
}
