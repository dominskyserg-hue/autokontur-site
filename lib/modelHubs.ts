// ============================================================
// ХАБИ МОДЕЛЕЙ АВТО — сторінки /marky/{марка}/{модель-покоління}
// (app/marky/[make]/[model]/page.tsx), напр. /marky/toyota/camry-xv40.
//
// Кожен хаб описаний ВРУЧНУ: у TecDoc та сама машина часто записана
// під іншою (японською/британською) назвою — Mazda 6 GG = "ATENZA",
// Nissan Qashqai J10 = "DUALIS", Mitsubishi Pajero II = "SHOGUN II", —
// а автоматичне склеювання за кодом шасі об'єднує чужі моделі
// (перевірено на даних: Carisma з Libero, Accord з City). Тому для
// кожного хабу тут явно перелічені ТОЧНІ записи tecdoc_compatibility.model
// (так само, як tecdocVehicle у вузьких сторінках lib/categories.ts).
//
// Товари хабу — ЛИШЕ з TecDoc-сумісності (рішення власника): товар
// потрапляє в хаб, якщо в tecdoc_compatibility є рядок з його
// brand+article і одним із models нижче. Поля car_make/car_model з
// прайсів постачальників не використовуються — покоління з них не
// визначити.
//
// Хаб, у якого менше MIN_HUB_PRODUCTS товарів, не показується (404 і
// немає в списках/сайтмапі) — "тонкий" контент шкодить SEO.
// ============================================================

import { CATEGORIES, type CategoryDef } from '@/lib/categories';

export const MIN_HUB_PRODUCTS = 30;

export interface ModelHubDef {
  // slug марки з lib/carMakes.ts (/marky/{makeSlug})
  makeSlug: string;
  // Марка так, як вона записана в tecdoc_compatibility.make
  tecdocMake: string;
  // Друга частина адреси: /marky/{makeSlug}/{slug}
  slug: string;
  // Назва для покупця (як шукають в Україні), без марки: "Camry XV40"
  label: string;
  // Назва в TecDoc, якщо відрізняється від ринкової — згадується в
  // тексті сторінки ("Mazda 6 GG (Atenza)"), щоб сторінку знаходили й
  // за нею
  altNames?: string;
  yearFrom: number;
  yearTo: number;
  // Точні записи tecdoc_compatibility.model цього покоління. ПЕРШИЙ —
  // основний кузов: його підставляємо у фільтр категорії
  // (/category/{slug}?marka=...&model=...), бо той фільтр приймає лише
  // одну модель
  tecdocModels: string[];
  // modelGroup вузьких сторінок "модель + деталь" (lib/categories.ts),
  // на які хаб посилається і які посилаються на хаб
  modelGroups: string[];
  // Текст сторінки (2–3 речення, українською) — пише людина
  intro: string;
}

export const MODEL_HUBS: ModelHubDef[] = [
  {
    makeSlug: 'toyota',
    tecdocMake: 'TOYOTA',
    slug: 'camry-xv30',
    label: 'Camry XV30',
    yearFrom: 2001,
    yearTo: 2006,
    tecdocModels: ['CAMRY Stufenheck (MCV3_, ACV3_, _XV3_)'],
    modelGroups: ['toyota-camry'],
    intro:
      'Запчастини для Toyota Camry XV30 (2001–2006) з бензиновими двигунами 2.4 і 3.0. Сумісність кожної деталі перевірена за каталогом TecDoc саме для цього покоління, тож підібрані тут деталі підходять для XV30.',
  },
  {
    makeSlug: 'toyota',
    tecdocMake: 'TOYOTA',
    slug: 'camry-xv40',
    label: 'Camry XV40',
    yearFrom: 2006,
    yearTo: 2011,
    tecdocModels: ['CAMRY Stufenheck (_XV4_)'],
    modelGroups: ['toyota-camry'],
    intro:
      'Запчастини для Toyota Camry XV40 (2006–2011) — седана з двигунами 2.4 і 3.5. Усі деталі на сторінці підібрані за каталогом TecDoc саме під це покоління. Якщо потрібної деталі немає, підберемо її за VIN-кодом.',
  },
  {
    makeSlug: 'toyota',
    tecdocMake: 'TOYOTA',
    slug: 'corolla-e120',
    label: 'Corolla E12',
    altNames: 'седан Altis, хетчбек RunX',
    yearFrom: 2001,
    yearTo: 2007,
    tecdocModels: ['AXIO/ALTIS Stufenheck (_E12J_, _E12T_)', 'RUNX (ZZE12_, NDE12_, ZDE12_)', 'COROLLA Combi (_E12J_, _E12T_)'],
    modelGroups: ['toyota-corolla-e120'],
    intro:
      "Запчастини для Toyota Corolla E12 (2001–2007): седан, хетчбек і універсал. У каталозі TecDoc ця Corolla записана також як Altis (седан) і RunX (хетчбек) — деталі для всіх трьох кузовів зібрані тут в одному місці.",
  },
  {
    makeSlug: 'toyota',
    tecdocMake: 'TOYOTA',
    slug: 'corolla-e150',
    label: 'Corolla E150',
    altNames: 'Altis',
    yearFrom: 2006,
    yearTo: 2013,
    tecdocModels: ['ALTIS Stufenheck (E15_)', 'COROLLA Hatchback (E15)'],
    modelGroups: ['toyota-corolla-e150'],
    intro:
      'Запчастини для Toyota Corolla E150 (2006–2013). У каталозі TecDoc седан цього покоління записаний як Corolla Altis — сумісність деталей нижче перевірена саме для нього.',
  },
  {
    makeSlug: 'honda',
    tecdocMake: 'HONDA',
    slug: 'accord-7',
    label: 'Accord VII',
    altNames: 'CL/CM',
    yearFrom: 2003,
    yearTo: 2008,
    tecdocModels: ['ACCORD EURO VIII (CL)', 'ACCORD VII Tourer (CM)'],
    modelGroups: ['honda-accord-7'],
    intro:
      'Запчастини для Honda Accord VII (2003–2008) — європейського седана CL і універсала Tourer CM. Американський Accord з кузовом CG — інша машина, деталі для нього тут не зібрані.',
  },
  {
    makeSlug: 'honda',
    tecdocMake: 'HONDA',
    slug: 'civic-8',
    label: 'Civic VIII',
    altNames: 'хетчбек FN/FK, седан FD',
    yearFrom: 2005,
    yearTo: 2011,
    tecdocModels: ['CIVIC VIII Hatchback (FN, FK)', 'BALLADE VIII Stufenheck (FD, FA)'],
    modelGroups: ['honda-civic-4d'],
    intro:
      'Запчастини для Honda Civic VIII (2005–2011): хетчбек 5D (FN, FK) і седан 4D (FD). Кузови відрізняються підвіскою та багатьма деталями, тому сумісність кожної деталі перевірена за каталогом TecDoc.',
  },
  {
    makeSlug: 'mazda',
    tecdocMake: 'MAZDA',
    slug: '6-gg',
    label: '6 GG',
    altNames: 'Atenza',
    yearFrom: 2002,
    yearTo: 2008,
    tecdocModels: ['ATENZA (GG)', 'ATENZA Schrägheck (GG)', 'ATENZA Kombi (GY)'],
    modelGroups: ['mazda6-gg'],
    intro:
      'Запчастини для Mazda 6 GG (2002–2008) — седан, ліфтбек і універсал GY. У каталозі TecDoc ця модель записана як Mazda Atenza, тому деталі з позначкою Atenza теж підходять на вашу «шістку».',
  },
  {
    makeSlug: 'mazda',
    tecdocMake: 'MAZDA',
    slug: '3-bk',
    label: '3 BK',
    altNames: 'Axela',
    yearFrom: 2003,
    yearTo: 2009,
    tecdocModels: ['3 (BK)', 'AXELA Stufenheck (BK)'],
    modelGroups: ['mazda-3'],
    intro:
      'Запчастини для Mazda 3 першого покоління BK (2003–2009): хетчбек і седан. У каталозі TecDoc седан цього покоління записаний як Mazda Axela — так модель називалась у Японії, тож деталі з такою позначкою теж підходять.',
  },
  {
    // Пілот: 27 унікальних запчастин < MIN_HUB_PRODUCTS — хаб прихований
    // (404, немає в списках і сайтмапі), доки товарів не стане більше
    makeSlug: 'mazda',
    tecdocMake: 'MAZDA',
    slug: 'cx-5-ke',
    label: 'CX-5 KE',
    yearFrom: 2011,
    yearTo: 2017,
    tecdocModels: ['CX-5 (KE, GH)'],
    modelGroups: ['mazda-cx5'],
    intro:
      'Запчастини для Mazda CX-5 першого покоління KE (2011–2017). Деталі підібрані за каталогом TecDoc саме під цей кросовер; потрібну позицію також можна знайти за артикулом або VIN-кодом.',
  },
  {
    makeSlug: 'nissan',
    tecdocMake: 'NISSAN',
    slug: 'qashqai-j10',
    label: 'Qashqai J10',
    altNames: 'Dualis',
    yearFrom: 2007,
    yearTo: 2013,
    tecdocModels: ['DUALIS (J10, JJ10)'],
    modelGroups: [],
    intro:
      'Запчастини для Nissan Qashqai першого покоління J10 (2007–2013), включно з семимісною версією Qashqai+2 (JJ10). У каталозі TecDoc ця модель записана як Nissan Dualis — так вона називалась на ринку Японії.',
  },
  {
    makeSlug: 'nissan',
    tecdocMake: 'NISSAN',
    slug: 'x-trail-t31',
    label: 'X-Trail T31',
    yearFrom: 2007,
    yearTo: 2014,
    tecdocModels: ['X-TRAIL (T31)'],
    modelGroups: [],
    intro:
      'Запчастини для Nissan X-Trail T31 (2007–2014). Деталі перевірені за каталогом TecDoc саме для цього покоління — вони відрізняються від попереднього X-Trail T30.',
  },
  {
    makeSlug: 'mitsubishi',
    tecdocMake: 'MITSUBISHI',
    slug: 'pajero-2',
    label: 'Pajero II',
    altNames: 'Shogun II / Montero',
    yearFrom: 1990,
    yearTo: 2006,
    tecdocModels: [
      'SHOGUN II (V3_W, V2_W, V4_W)',
      'SHOGUN II Geländewagen offen (V2_W, V4_W)',
      'PAJERO/SHOGUN CLASSIC (V2_W)',
      'MONTERO II (V3_W)',
    ],
    modelGroups: ['mitsubishi-pajero-2'],
    intro:
      'Запчастини для Mitsubishi Pajero II (1990–2006), включно з Pajero Classic. У каталозі TecDoc цей позашляховик записаний як Shogun II та Montero — так його продавали у Великій Британії та Америці.',
  },
  {
    makeSlug: 'suzuki',
    tecdocMake: 'SUZUKI',
    slug: 'sx4',
    label: 'SX4',
    yearFrom: 2006,
    yearTo: 2014,
    tecdocModels: ['SX4 (EY, GY)', 'SX4 Stufenheck (GY)'],
    modelGroups: ['suzuki-sx4'],
    intro:
      'Запчастини для Suzuki SX4 першого покоління (2006–2014): хетчбек і седан. Сумісність кожної деталі перевірена за каталогом TecDoc; чого немає в наявності — привеземо під замовлення.',
  },
];

// Порядок категорій у блоці хабу (рішення власника): спершу те, що
// найчастіше шукають для обслуговування й ремонту — гальма, фільтри,
// підвіска, кермо, ГРМ, зчеплення, деталі ремонту двигуна; далі решта
// категорій — за кількістю товарів. Точні slug широких категорій
// lib/categories.ts, у потрібному порядку
export const PRIORITY_CATEGORY_SLUGS: string[] = [
  'halmivni-kolodky',
  'halmivni-dysky',
  'oliyni-filtry',
  'povitryani-filtry',
  'salonni-filtry',
  'amortyzatory',
  'sailentbloky-vazhelia',
  'kulovi-opory',
  'vazheli-pidvisky',
  'vtulky-stabilizatora',
  'pidshypnyky-matochyny',
  'kermove-upravlinnya',
  'remeni-rolyky-grm',
  'transmisiya-kpp',
  'prokladky-dvyhuna',
];

// Вузькі сторінки "модель + деталь", які НЕ пов'язуються з хабами (ні
// посиланням з хабу, ні "Всі запчастини для ..." з самої сторінки):
// товари на них підібрані за словом у назві, а не за TecDoc-поколінням
// (рішення власника: "Camry колодки" — для всіх поколінь Camry одразу)
const HUB_EXCLUDED_NARROW_SLUGS: ReadonlySet<string> = new Set(['camry-halmivni-kolodky-peredni']);

export function getHub(makeSlug: string, slug: string): ModelHubDef | undefined {
  return MODEL_HUBS.find((hub) => hub.makeSlug === makeSlug && hub.slug === slug);
}

export function getHubsForMake(makeSlug: string): ModelHubDef[] {
  return MODEL_HUBS.filter((hub) => hub.makeSlug === makeSlug);
}

export function hubPath(hub: ModelHubDef): string {
  return `/marky/${hub.makeSlug}/${hub.slug}`;
}

// Хаб для рядка сумісності TecDoc (блок "Запчастина підходить для авто"
// у картці товару): точний збіг марки й запису моделі
export function findHubForTecdocModel(tecdocMake: string, tecdocModel: string): ModelHubDef | undefined {
  const make = tecdocMake.toUpperCase();
  return MODEL_HUBS.find((hub) => hub.tecdocMake === make && hub.tecdocModels.includes(tecdocModel));
}

// Хаби, пов'язані з вузькою сторінкою "модель + деталь" (за modelGroup,
// крім HUB_EXCLUDED_NARROW_SLUGS) —
// для посилання "Всі запчастини для {модель}"
export function findHubsForNarrowCategory(category: CategoryDef): ModelHubDef[] {
  if (!category.modelGroup || HUB_EXCLUDED_NARROW_SLUGS.has(category.slug)) return [];
  return MODEL_HUBS.filter((hub) => hub.modelGroups.includes(category.modelGroup!));
}

// Вузька сторінка "модель + деталь" для категорії в межах хабу (якщо є)
export function findNarrowCategoryForHub(hub: ModelHubDef, broadSlug: string): CategoryDef | undefined {
  return CATEGORIES.find(
    (category) =>
      category.parentCategorySlug === broadSlug &&
      Boolean(category.modelGroup) &&
      hub.modelGroups.includes(category.modelGroup!) &&
      !HUB_EXCLUDED_NARROW_SLUGS.has(category.slug)
  );
}
