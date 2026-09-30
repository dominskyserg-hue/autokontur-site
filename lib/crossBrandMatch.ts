// ============================================================
// Проверка бренда для строк таблицы кроссов part_crosses (кроссы и
// OEM-номера из прайсов поставщиков и справочника TRW).
//
// Раньше кроссы брались по одному артикулу, без бренда. Короткие и
// "круглые" номера встречаются у разных производителей, и товару
// доставались чужие аналоги: наш CARGO 12345 получал кроссы детали
// ELSTOCK 12345. Теперь сторона строки (бренд + артикул) "принадлежит"
// товару, только если:
//   1) бренд строки и бренд товара — один производитель. Бренд сводится
//      к ключу группы (crossBrandGroup): нормализация (регистр, пробелы,
//      точки, умлауты: "LEMFÖRDER" = "Lemforder"), разные написания
//      одной компании и группы компаний (MANUFACTURER_GROUPS ниже) и
//      "родня" брендов из lib/brandFamilies.ts (VAG <-> VW, MOBIS <-> KIA);
//   2) или бренд строки неизвестен ('OEM/аналог' — номер из прайса без
//      бренда), и при этом номер длинный (от 8 символов: случайное
//      совпадение такого номера у разных деталей маловероятно) или товар
//      оригинальный (бренд — автопроизводитель: номер без бренда в
//      его строке и есть OEM-номер этого производителя).
//
// Используется в трёх местах одним и тем же SQL:
//   - блок "Аналоги" на странице товара (lib/productDetail.ts);
//   - поиск по номеру (lib/productSearch.ts);
//   - своя применимость по OEM-номерам в кроссах (lib/ownVehicles.ts).
//
// Ключ в JS (crossBrandKey) и в SQL (crossBrandKeySql) считается
// ОДИНАКОВО — иначе фильтр молча перестанет совпадать
// ============================================================

import { CAR_MAKES } from '@/lib/carMakes';
import { ALLOWED_PAIRS } from '@/lib/brandFamilies';

// Метка скриптов импорта из прайсов для номера без известного бренда
// (scripts/tecdoc/import-*-crosses.ts, CROSS_BRAND_LABEL)
export const PRICE_LABEL = 'OEM/аналог';

// Номер без бренда засчитывается, если он не короче этого (артикулы в
// part_crosses уже очищены: без пробелов, точек, дефисов)
export const UNBRANDED_MIN_LENGTH = 8;

const UMLAUTS_FROM = 'ÄÖÜäöüÉÈéèß';
const UMLAUTS_TO = 'AOUaoueEeeS';

export function crossBrandKey(brand: string | null | undefined): string {
  let value = brand ?? '';
  for (let i = 0; i < UMLAUTS_FROM.length; i++) {
    value = value.split(UMLAUTS_FROM[i]).join(UMLAUTS_TO[i]);
  }
  return value.replace(/[^A-Za-z0-9А-Яа-я]/g, '').toUpperCase();
}

// Тот же ключ в SQL для выражения expr
export function crossBrandKeySql(expr: string): string {
  return `upper(regexp_replace(translate(${expr}, '${UMLAUTS_FROM}', '${UMLAUTS_TO}'), '[^A-Za-z0-9А-Яа-я]', '', 'g'))`;
}

// Один производитель под разными именами (ключи уже нормализованы).
// Первый ключ в группе — её имя. Пары взяты из реальных несовпадений
// бренда на одном артикуле в базе либо это известные группы компаний
const MANUFACTURER_GROUPS: string[][] = [
  // Разные написания одного бренда
  ['AUTOFREN', 'AUTOFRENSEINSA'],
  ['WAI', 'WAIGLOBAL'],
  ['CARGO', 'HCCARGO'],
  ['ASPL', 'AS'],
  ['FEBI', 'FEBIBILSTEIN'],
  ['MANN', 'MANNFILTER'],
  ['WIX', 'WIXFILTERS'],
  ['VICTORREINZ', 'VICTREINZ', 'REINZ'],
  ['RIKEN', 'RIK'],
  ['GOETZE', 'GOETZEENGINE'],
  ['PRESTOLITE', 'PRESTOLITEELECTRIC'],
  ['NIPPONMOTORS', 'NIPPON'],
  ['AVA', 'AVAQUALITYCOOLING'],
  ['VALEO', 'VALEOPHC'],
  ['HELLA', 'HELLAPAGID'],
  ['FISCHER', 'FA1'],
  // Группы компаний: одна нумерация деталей под несколькими марками
  ['MAHLE', 'MAHLEORIGINAL', 'MAHLEFILTER', 'KNECHT', 'MAHLEKNECHT', 'KNECHTMAHLE'],
  ['CONTINENTAL', 'CONTINENTALCTAM', 'CONTITECH'],
  ['SCHAEFFLER', 'SCHAEFFLERGRUPPE', 'INA', 'LUK', 'FAG'],
  ['ZF', 'ZFPARTS', 'LEMFORDER', 'SACHS'],
  // TRW — отдельно от группы ZF: у марок разная нумерация деталей, пара
  // давала только ложные совпадения (решение владельца)
  ['TRW', 'TRWAUTOMOTIVE'],
  ['JAPANPARTS', 'ASHIKA'],
  ['NTN', 'SNR', 'NTNSNR'],
  // Оригинальные запчасти: одна нумерация у марок одного концерна
  ['TOYOTA', 'TOYOTALEXUS', 'LEXUS'],
  ['HYUNDAI', 'HYUNDAIKIA', 'KIA', 'MOBIS'],
  ['NISSAN', 'NISSANINFINITI', 'INFINITI'],
  ['HONDA', 'HONDAACURA', 'ACURA'],
  ['MERCEDESBENZ', 'MERCEDES'],
  ['PEUGEOTCITROEN', 'PEUGEOT', 'CITROEN'],
];

// Ключ -> имя группы. Группы и пары "родни" объединяются транзитивно
// (VW - VAG - AUDI -> одна группа)
const GROUP_OF = new Map<string, string>();
{
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    while (parent.has(k) && parent.get(k) !== k) k = parent.get(k)!;
    return k;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const group of MANUFACTURER_GROUPS) group.forEach((k) => union(group[0], k));
  for (const [a, b] of ALLOWED_PAIRS) union(crossBrandKey(a), crossBrandKey(b));
  for (const k of parent.keys()) {
    const root = find(k);
    if (root !== k) GROUP_OF.set(k, root);
  }
}

export function crossBrandGroup(brand: string | null | undefined): string {
  const key = crossBrandKey(brand);
  return GROUP_OF.get(key) ?? key;
}

// Тот же ключ группы в SQL. Ключи содержат только [A-Z0-9А-Я], поэтому
// их безопасно подставлять в текст запроса литералами
export function crossBrandGroupSql(expr: string): string {
  const whens = [...GROUP_OF].map(([k, g]) => `WHEN '${k}' THEN '${g}'`).join(' ');
  return `(CASE ${crossBrandKeySql(expr)} ${whens} ELSE ${crossBrandKeySql(expr)} END)`;
}

// Группы оригинальных запчастей: автопроизводители из lib/carMakes.ts
// и оригинальные "подбренды" поставщиков
const OEM_GROUPS: string[] = [
  ...new Set(
    [...CAR_MAKES.flatMap((make) => make.dbValues), 'VAG', 'MOBIS', 'GM', 'MOTORCRAFT'].map(crossBrandGroup)
  ),
];

// SQL-условие: сторона строки кросса (rowBrand, rowArticle) относится к
// товару с брендом productBrand (правила 1 и 2 из шапки файла)
export function crossSideMatchesSql(rowBrand: string, rowArticle: string, productBrand: string): string {
  const productGroup = crossBrandGroupSql(productBrand);
  const oemList = OEM_GROUPS.map((g) => `'${g}'`).join(', ');
  return `(
    ${crossBrandGroupSql(rowBrand)} = ${productGroup}
    OR (${rowBrand} = '${PRICE_LABEL}'
        AND (LENGTH(${rowArticle}) >= ${UNBRANDED_MIN_LENGTH} OR ${productGroup} IN (${oemList})))
  )`;
}
