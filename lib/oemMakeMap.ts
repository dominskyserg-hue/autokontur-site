// ============================================================
// Справочник "производитель OEM-номера -> марка авто" — один из источников
// своей применимости (lib/ownVehicles.ts, источник oem).
//
// Идея: у товара есть кроссы (таблица part_crosses) — из прайсов
// поставщиков и справочника TRW. Если среди них есть OEM-номер
// автопроизводителя (бренд строки — TOYOTA, MOBIS, VAG...), то деталь
// ставится на машины этой марки. Так же — если бренд самого товара —
// автопроизводитель (оригинальная запчасть TOYOTA).
//
// Бренды сравниваются по ключу crossBrandKey (lib/crossBrandMatch.ts):
// верхний регистр, без пробелов, точек и дефисов. Ключ считается маркой,
// если он РАВЕН ключу из справочника или НАЧИНАЕТСЯ с него — так ловятся
// варианты вроде "FORD ASIA & OCEANIA", "TOYOTA/LEXUS", "HYUNDAI/KIA"
// ============================================================

import { CAR_MAKES } from '@/lib/carMakes';
import { crossBrandKey } from '@/lib/crossBrandMatch';

// Ключ производителя -> slug-и марок (lib/carMakes.ts). Концерны, чьи
// номера подходят нескольким маркам, дают несколько марок сразу
const EXTRA_OEM_BRANDS: Record<string, string[]> = {
  LEXUS: ['lexus', 'toyota'],
  TOYOTALEXUS: ['toyota'],
  MOBIS: ['hyundai', 'kia'],
  HYUNDAIKIA: ['hyundai', 'kia'],
  NISSANINFINITI: ['nissan'],
  INFINITI: ['nissan'],
  HONDAACURA: ['honda'],
  ACURA: ['honda'],
  VAG: ['volkswagen', 'audi'],
  SKODA: ['skoda'],
  SEAT: ['seat'],
  MOTORCRAFT: ['ford'],
  MERCEDESBENZ: ['mercedes-benz'],
  PEUGEOTCITROEN: ['peugeot', 'citroen'],
  PSA: ['peugeot', 'citroen'],
  CITROEN: ['citroen'],
  GMDAEWOO: ['daewoo', 'chevrolet'],
};

// Ключи, которые начинаются с названия марки, но маркой не являются
// (бренды запчастей). Дополняется по мере находок
const NOT_A_MAKE = new Set<string>(['FORDPARTS', 'OPELPARTS']);

const MAKE_KEYS: Array<[string, string[]]> = (() => {
  const map = new Map<string, Set<string>>();
  const add = (key: string, slugs: string[]) => {
    if (!key) return;
    const set = map.get(key) ?? new Set<string>();
    slugs.forEach((s) => set.add(s));
    map.set(key, set);
  };
  for (const make of CAR_MAKES) {
    for (const value of make.dbValues) add(crossBrandKey(value), [make.slug]);
  }
  for (const [key, slugs] of Object.entries(EXTRA_OEM_BRANDS)) add(key, slugs);
  // Длинные ключи проверяются первыми: "TOYOTALEXUS" раньше "TOYOTA"
  return [...map].map(([k, v]) => [k, [...v]] as [string, string[]]).sort((a, b) => b[0].length - a[0].length);
})();

// Ключи брендов-автопроизводителей — для предварительного фильтра в SQL
// (строка подходит, если ключ её бренда начинается с одного из них;
// окончательно решает makesForOemBrand)
export const OEM_MAKE_KEYS: string[] = MAKE_KEYS.map(([key]) => key);

// Марки авто (slug-и) для бренда OEM-номера; [] — это не автопроизводитель
export function makesForOemBrand(brand: string | null | undefined): string[] {
  const key = crossBrandKey(brand);
  if (key.length < 2 || NOT_A_MAKE.has(key)) return [];
  for (const [makeKey, slugs] of MAKE_KEYS) {
    if (key === makeKey || (makeKey.length >= 3 && key.startsWith(makeKey))) return slugs;
  }
  return [];
}
