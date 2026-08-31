// ============================================================
// Розшифровка VIN-коду БЕЗ звернення до будь-якого зовнішнього
// сервісу — повністю офлайн, безкоштовно, без лімітів на кількість
// запитів. Використовує тільки те, що прямо закодовано в самому
// VIN за міжнародним стандартом ISO 3779:
//
//   1. Перші символи VIN (WMI — World Manufacturer Identifier)
//      називають виробника. Таблиця WMI_TO_MAKE нижче — це НЕ повний
//      офіційний реєстр (він налічує тисячі кодів для заводів і країн
//      складання), а вибірка з кодів марок, які реально є в нашому
//      каталозі (див. lib/carMakes.ts) — цього достатньо, щоб
//      підказати покупцю марку і одразу показати наявні запчастини.
//   2. 10-й символ VIN кодує рік випуску за фіксованою таблицею, яка
//      повторюється циклом у 30 років.
//
// Це навмисно НЕ точна розшифровка (модель, комплектацію, об'єм
// двигуна з самого VIN дізнатись не можна без платної бази даних
// виробника) — лише найкраща безкоштовна здогадка "марка + рік",
// якої достатньо, щоб одразу підставити її в уже наявний пошук
// "за автомобілем" (див. handleCarSearchSubmit у StorefrontHome.tsx)
// замість того, щоб покупець сам шукав свою марку у випадаючому списку.
//
// Якщо VIN не розпізнано (невідомий WMI, брак у переліку нижче) —
// це не помилка: покупець просто бачить форму заявки, як і раніше.
// ============================================================

// Ключ — WMI-префікс (3, 2 або 1 символ, перевіряються від
// найдовшого до найкоротшого), значення — марка САМЕ в такому
// вигляді, в якому вона зберігається в products.car_make (щоб
// збігтися з ILIKE-пошуком у app/api/products/route.ts) — див.
// реальні значення в lib/carMakes.ts
const WMI_TO_MAKE: Record<string, string> = {
  // Toyota (Японія)
  JT: 'TOYOTA',
  // Nissan (Японія)
  JN: 'NISSAN',
  // Nissan, зібраний у Великобританії (завод Сандерленд) — окремий
  // WMI від японського JN, тому потрібен окремим записом. Саме такий
  // код у VIN, наприклад, Nissan Qashqai/Juke/Note європейської збірки
  SJN: 'NISSAN',
  // Mitsubishi (Японія)
  JA: 'MITSUBISHI',
  JM: 'MAZDA',
  MMC: 'MITSUBISHI',
  // Honda (Японія)
  JH: 'HONDA',
  // Suzuki (Японія)
  JS: 'SUZUKI',
  // Subaru (Японія)
  JF: 'SUBARU',
  // Daihatsu (Японія)
  JD: 'DAIHATSU',
  // Isuzu (Японія)
  JAA: 'ISUZU',
  JAB: 'ISUZU',
  JAC: 'ISUZU',
  JAE: 'ISUZU',
  JAL: 'ISUZU',
  JAM: 'ISUZU',
  // Hyundai (Корея)
  KMH: 'HYUNDAI',
  KME: 'HYUNDAI',
  KMF: 'HYUNDAI',
  KMJ: 'HYUNDAI',
  KM8: 'HYUNDAI',
  // Kia (Корея)
  KNA: 'KIA',
  KNC: 'KIA',
  KNE: 'KIA',
  KND: 'KIA',
  KNM: 'KIA',
  // Daewoo / GM Korea (Корея)
  KL: 'DAEWOO',
  // SsangYong (Корея)
  KPA: 'SSANG YONG',
  KPT: 'SSANG YONG',
  // BMW (Німеччина)
  WBA: 'BMW',
  WBS: 'BMW',
  WBX: 'BMW',
  WBY: 'BMW',
  // Mercedes-Benz (Німеччина)
  WDB: 'MERCEDES',
  WDC: 'MERCEDES',
  WDD: 'MERCEDES',
  WDF: 'MERCEDES',
  // Volkswagen (Німеччина)
  WVW: 'VW',
  WV1: 'VW',
  WV2: 'VW',
  // Audi (Німеччина)
  WAU: 'AUDI',
  TRU: 'AUDI',
  // Opel (Німеччина)
  W0L: 'OPEL',
  W0V: 'OPEL',
  // Ford (Європа / США)
  WF0: 'FORD',
  '1FA': 'FORD',
  '1FB': 'FORD',
  '1FC': 'FORD',
  '1FD': 'FORD',
  '1FM': 'FORD',
  '1FT': 'FORD',
  // Renault (Франція)
  VF1: 'RENAULT',
  // Peugeot (Франція)
  VF3: 'PEUGEOT',
  // Citroen (Франція)
  VF7: 'CITROEN',
  // Fiat (Італія)
  ZFA: 'FIAT',
  // Alfa Romeo (Італія)
  ZAR: 'ALFA ROMEO',
  // Skoda (Чехія)
  TMB: 'SKODA',
  // Volvo (Швеція)
  YV1: 'VOLVO',
  // Land Rover (Великобританія)
  SAL: 'LAND ROVER',
  // Jeep / Dodge / Chrysler (США)
  '1J4': 'JEEP',
  '1J8': 'JEEP',
  '1B3': 'DODGE',
  '1B4': 'DODGE',
  '2B3': 'DODGE',
  '1C3': 'CHRYSLER',
  // Chevrolet (США)
  '1G1': 'CHEVROLET',
  '1GC': 'CHEVROLET',
  // Lada / AvtoVAZ (Росія)
  XTA: 'LADA',
};

// Найдовший WMI-ключ у таблиці вище — щоб знати, з скількох символів
// починати пошук (спочатку пробуємо 3, потім 2, потім 1)
const MAX_WMI_LENGTH = Math.max(...Object.keys(WMI_TO_MAKE).map((k) => k.length));

function matchMake(vin: string): string | null {
  for (let len = MAX_WMI_LENGTH; len >= 1; len--) {
    const prefix = vin.slice(0, len);
    if (WMI_TO_MAKE[prefix]) return WMI_TO_MAKE[prefix];
  }
  return null;
}

// Таблиця "символ на 10-й позиції -> рік" за ISO 3779. Літери I, O,
// Q, U, Z і цифра 0 у стандарті не використовуються. Код циклічно
// повторюється кожні 30 років (наприклад, "A" — і 1980, і 2010) —
// оскільки в запчастинах для вживаних авто 1980-і практично не
// зустрічаються, завжди беремо СВІЖІШИЙ варіант цього ж символу
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
const YEAR_CYCLE_START = 2010; // A -> 2010 у поточному циклі

function matchYear(vin: string): number | null {
  const char = vin[9]; // 10-й символ, індекс 9
  const index = YEAR_CODES.indexOf(char);
  if (index === -1) return null;
  return YEAR_CYCLE_START + index;
}

export interface VinDecodeResult {
  make: string | null;
  year: number | null;
}

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export function decodeVin(rawVin: string): VinDecodeResult {
  const vin = rawVin.trim().toUpperCase();
  if (!VIN_PATTERN.test(vin)) {
    return { make: null, year: null };
  }
  return { make: matchMake(vin), year: matchYear(vin) };
}
