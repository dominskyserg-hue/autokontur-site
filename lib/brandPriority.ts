// ============================================================
// ГРУППЫ БРЕНДОВ для сортировки "За популярністю".
//
// Порядок сортировки (lib/popularitySort.ts): наличие → была продажа за
// 180 дней → есть фото → ГРУППА БРЕНДА (этот файл) → цена по возрастанию.
//
//   Группа 1 — поднимать выше всех (оригинал и проверенные бренды);
//   Группа 2 — обычные;
//   всё, чего нет в списках, — группа 3.
//
// КАК МЕНЯТЬ: просто допишите или удалите название в нужном списке и
// выложите сайт. Сравнение идёт БЕЗ учёта регистра, пробелов и дефисов:
// "Mann-Filter", "MANN FILTER" и "MANNFILTER" — одно и то же. А вот
// "HYUNDAI / KIA" и "HYUNDAI" — разные строки (в прайсах поставщиков это
// разные написания), поэтому варианты написания перечислены отдельно,
// с пометкой "вариант написания".
//
// Остальные символы (/, \, точки) при сравнении СОХРАНЯЮТСЯ: "KNECHT/MAHLE"
// и "KNECHT-MAHLE" — разные строки, поэтому указаны обе.
// ============================================================

export const BRAND_GROUP_1: string[] = [
  // ---- японские и корейские марки (оригинал) ----
  'TOYOTA',
  'TOYOTA / LEXUS', // вариант написания
  'TOYOTA LEXUS SCION', // вариант написания
  'NISSAN',
  'NISSAN / INFINITI', // вариант написания
  'NISSAN INFINITI RENAULT', // вариант написания (оригинал Nissan)
  'MITSUBISHI',
  'MAZDA',
  'SUBARU',
  'HONDA',
  'HONDA / ACURA', // вариант написания
  'HONDA/ACURA', // вариант написания
  'LEXUS',
  'INFINITI',
  'SUZUKI',
  'SUZUKI-MARUTI', // вариант написания
  'ISUZU',
  'MOBIS',
  'HYUNDAI',
  'KIA',
  'HYUNDAI / KIA', // вариант написания
  'HYUNDAI/KIA', // вариант написания
  'HYUNDAI KIA', // вариант написания

  // ---- японские производители запчастей ----
  'DENSO',
  'AISIN',
  'NGK',
  'KYB',
  'KAYABA', // вариант написания (KYB = Kayaba)
  'NSK',
  'KOYO',
  'NISSHINBO',
  'AKEBONO',
  'GMB',
  'TAIHO',
  'TEIKIN',
  'ASHIKA',
  'JAPANPARTS',
  'JAPAN PARTS', // вариант написания
  'JAPANPARTS/ ASHIKA', // вариант написания
  'BLUE PRINT', // "BLUEPRINT" совпадает автоматически (без пробела)

  // ---- европейские производители запчастей ----
  'BOSCH',
  'MANN',
  'MANN-FILTER', // "MANN FILTER" совпадает автоматически
  'MAHLE',
  'MAHLE ORIGINAL', // вариант написания
  'MAHLE / KNECHT', // вариант написания
  'KNECHT',
  'KNECHT-MAHLE', // вариант написания
  'KNECHT/MAHLE', // вариант написания
  'HENGST',
  'HENGST FILTER', // вариант написания
  'LEMFORDER',
  'SACHS',
  'ELRING',
  'CORTECO',
  'AJUSA',
  'NISSENS',
  'VALEO',
  'VALEO PHC', // вариант написания (корейское подразделение Valeo)
  'BREMBO',
  'FERODO',
  'TRW',
  'TRW AUTOMOTIVE', // вариант написания
  'TRW ENGINE COMPONENT', // вариант написания
  'SKF',
  'INA',
  'LUK',
  'GATES',
  'CONTITECH',
  'ZIMMERMANN',
  'TEXTAR',
  'ATE',
  'FEBI',
  'FEBI BILSTEIN', // вариант написания
  'MITSUBISHI ELECTRIC',
  'NTK', // свечи и датчики, дочерний бренд NGK
  'FAG', // подшипники, группа Schaeffler (как INA и LUK)
  'CONTINENTAL',
  'CONTINENTAL / VDO', // "CONTINENTAL/VDO" совпадает автоматически
  'VALEO/MANDO',
  'VICTOR REINZ/MAHLE',
];

export const BRAND_GROUP_2: string[] = [
  'VAG',
  'FORD',
  'BMW',
  'MERCEDES',
  'MERCEDES-BENZ', // "MERCEDES BENZ" совпадает автоматически
  'RENAULT',
  'CTR',
  'SANGSIN',
  'SANGSIN BRAKE', // вариант написания
  'GSP',
  'GSP/NTY', // вариант написания
  'DENCKERMANN',
  'DENKERMANN', // вариант написания (опечатка в прайсе)
  'CARGO',
  'HC-CARGO', // вариант написания (CARGO — это HC-Cargo)
  'AS',
  'AS-PL', // вариант написания (AS — это AS-PL)
  'NTY',
  'NTY\\SKV', // вариант написания
  'PROFIT',
  'POLCAR',
  'POLCAR/SRL', // вариант написания
  'TENACITY',
  'LUCAS', // тормоза TRW Lucas
  'KOYORAD', // радиаторы (другая компания, не подшипники Koyo)
];

// Ключ для сравнения: верхний регистр, без пробелов и дефисов.
// ТА ЖЕ нормализация в SQL — в lib/popularitySort.ts (BRAND_KEY_SQL)
export function normalizeBrandKey(brand: string | null | undefined): string {
  return (brand || '').toUpperCase().replace(/[\s-]/g, '');
}

const GROUP_1_KEYS = new Set(BRAND_GROUP_1.map(normalizeBrandKey));
const GROUP_2_KEYS = new Set(BRAND_GROUP_2.map(normalizeBrandKey));

export const BRAND_GROUP_1_KEYS: string[] = [...GROUP_1_KEYS];
export const BRAND_GROUP_2_KEYS: string[] = [...GROUP_2_KEYS];

// 1, 2 или 3 — для сортировки в JavaScript (хабы моделей)
export function getBrandGroup(brand: string | null | undefined): 1 | 2 | 3 {
  const key = normalizeBrandKey(brand);
  if (GROUP_1_KEYS.has(key)) return 1;
  if (GROUP_2_KEYS.has(key)) return 2;
  return 3;
}
