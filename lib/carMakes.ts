// ============================================================
// Довідник марок авто для SEO-сторінок /marky/[slug].
//
// На відміну від категорій деталей (lib/categories.ts, де немає
// власного поля в базі), марка авто — це РЕАЛЬНЕ поле products.car_make,
// яке вже заповнюється при завантаженні прайсу (див. supplier_excel_mappings
// .car_make_column і app/api/suppliers/parse-excel/route.ts). Але
// значення там — вільний текст, який ввів поставщик/адмін ("TOYOTA",
// "VW", "MERCEDES", а є й сміття на кшталт "Universal", "GM", "EEP"),
// тому сторінки робимо не під КОЖНЕ значення з бази, а під курований
// список реальних марок — з прив'язкою до того, як саме вони записані
// в car_make (dbValues, може бути декілька варіантів написання на одну
// марку).
//
// Список і значення dbValues звірені з реальними даними каталогу
// (запит SELECT car_make, COUNT(*) ... GROUP BY car_make) — це
// найпопулярніші марки, які там дійсно є, а не довільний список
// "популярних у світі" марок
// ============================================================

export interface CarMakeDef {
  slug: string;
  name: string;
  // Точні значення car_make в базі, які відносяться до цієї марки
  // (порівняння регістронезалежне — див. buildMakeWhereClause)
  dbValues: string[];
  // Шлях до логотипу марки в /public/car-logos — офіційні лого,
  // взяті з відкритого датасету car-logos-dataset (filippofilip95),
  // приведені до єдиного розміру (lib/carMakes.ts їх лише перелічує,
  // самі файли не редагуються цим файлом)
  logo: string;
  // Кириличні "корені" марки для розпізнавання в довільному тексті
  // пошуку (напр. "ремінь грм на мазду 626" — покупець пише марку
  // українською чи російською, у будь-якому відмінку). Це НЕ повні
  // слова, а ПОЧАТОК слова: "мазд" знаходить і "мазда", і "мазду", і
  // "мазди" одним записом, без окремого перелічення відмінків. Див.
  // detectCarMakeInText нижче — саме він порівнює по цьому префіксу
  cyrillicStems: string[];
}

export const CAR_MAKES: CarMakeDef[] = [
  { slug: 'toyota', name: 'Toyota', dbValues: ['TOYOTA'], logo: '/car-logos/toyota.png', cyrillicStems: ['тойот'] },
  { slug: 'nissan', name: 'Nissan', dbValues: ['NISSAN'], logo: '/car-logos/nissan.png', cyrillicStems: ['ніссан', 'нисан', 'нісан'] },
  { slug: 'mitsubishi', name: 'Mitsubishi', dbValues: ['MITSUBISHI'], logo: '/car-logos/mitsubishi.png', cyrillicStems: ['мітсубіс', 'митсубис', 'міцубіс', 'мицубис'] },
  { slug: 'hyundai', name: 'Hyundai', dbValues: ['HYUNDAI'], logo: '/car-logos/hyundai.png', cyrillicStems: ['хюнда', 'хендай', 'гюндай', 'гундай'] },
  { slug: 'mazda', name: 'Mazda', dbValues: ['MAZDA'], logo: '/car-logos/mazda.png', cyrillicStems: ['мазд'] },
  { slug: 'honda', name: 'Honda', dbValues: ['HONDA'], logo: '/car-logos/honda.png', cyrillicStems: ['хонд'] },
  { slug: 'kia', name: 'Kia', dbValues: ['KIA'], logo: '/car-logos/kia.png', cyrillicStems: ['кіа', 'киа'] },
  { slug: 'suzuki', name: 'Suzuki', dbValues: ['SUZUKI'], logo: '/car-logos/suzuki.png', cyrillicStems: ['сузук'] },
  { slug: 'subaru', name: 'Subaru', dbValues: ['SUBARU'], logo: '/car-logos/subaru.png', cyrillicStems: ['субар'] },
  { slug: 'ssangyong', name: 'SsangYong', dbValues: ['SSANG YONG', 'SSANGYONG'], logo: '/car-logos/ssangyong.png', cyrillicStems: ['сангйон', 'ссангйон', 'санг йон'] },
  { slug: 'isuzu', name: 'Isuzu', dbValues: ['ISUZU'], logo: '/car-logos/isuzu.png', cyrillicStems: ['ісузу', 'исузу'] },
  { slug: 'ford', name: 'Ford', dbValues: ['FORD'], logo: '/car-logos/ford.png', cyrillicStems: ['форд'] },
  { slug: 'mercedes-benz', name: 'Mercedes-Benz', dbValues: ['MERCEDES', 'MERCEDES-BENZ'], logo: '/car-logos/mercedes-benz.png', cyrillicStems: ['мерседес', 'мерс '] },
  { slug: 'daewoo', name: 'Daewoo', dbValues: ['DAEWOO'], logo: '/car-logos/daewoo.png', cyrillicStems: ['деу', 'дэу'] },
  { slug: 'daihatsu', name: 'Daihatsu', dbValues: ['DAIHATSU'], logo: '/car-logos/daihatsu.png', cyrillicStems: ['дайхатс'] },
  { slug: 'bmw', name: 'BMW', dbValues: ['BMW'], logo: '/car-logos/bmw.png', cyrillicStems: ['бмв'] },
  { slug: 'renault', name: 'Renault', dbValues: ['RENAULT'], logo: '/car-logos/renault.png', cyrillicStems: ['рено'] },
  { slug: 'volkswagen', name: 'Volkswagen', dbValues: ['VW', 'VOLKSWAGEN'], logo: '/car-logos/volkswagen.png', cyrillicStems: ['фольксваген', 'вольксваген'] },
  { slug: 'opel', name: 'Opel', dbValues: ['OPEL'], logo: '/car-logos/opel.png', cyrillicStems: ['опел'] },
  { slug: 'jeep', name: 'Jeep', dbValues: ['JEEP'], logo: '/car-logos/jeep.png', cyrillicStems: ['джип'] },
  { slug: 'fiat', name: 'Fiat', dbValues: ['FIAT'], logo: '/car-logos/fiat.png', cyrillicStems: ['фіат', 'фиат'] },
  { slug: 'land-rover', name: 'Land Rover', dbValues: ['LAND ROVER'], logo: '/car-logos/land-rover.png', cyrillicStems: ['ленд ровер', 'лендровер', 'ленд-ровер'] },
  { slug: 'audi', name: 'Audi', dbValues: ['AUDI'], logo: '/car-logos/audi.png', cyrillicStems: ['ауді', 'ауди'] },
  { slug: 'peugeot', name: 'Peugeot', dbValues: ['PEUGEOT'], logo: '/car-logos/peugeot.png', cyrillicStems: ['пежо'] },
  { slug: 'dodge', name: 'Dodge', dbValues: ['DODGE'], logo: '/car-logos/dodge.png', cyrillicStems: ['додж'] },
  { slug: 'chevrolet', name: 'Chevrolet', dbValues: ['CHEVROLET'], logo: '/car-logos/chevrolet.png', cyrillicStems: ['шевроле', 'шевролє'] },
];

// Марки, яких НЕМАЄ серед курованих CAR_MAKES вище (немає готового
// лого в /public/car-logos і власної сторінки /marky/[slug]) — але
// покупці все одно можуть шукати їх вільним текстом ("лексус",
// "шкода"...), і в базі (products.car_make / tecdoc_compatibility.make)
// такі значення реально трапляються. Легша структура: лише те, що
// потрібно для розпізнавання тексту й SQL-фільтра, без slug/name/logo,
// які використовує ТІЛЬКИ куратор сторінок марок
interface SearchOnlyCarMake {
  dbValues: string[];
  cyrillicStems: string[];
}

const SEARCH_ONLY_CAR_MAKES: SearchOnlyCarMake[] = [
  { dbValues: ['LEXUS'], cyrillicStems: ['лексус'] },
  { dbValues: ['SKODA', 'ŠKODA'], cyrillicStems: ['шкод'] },
  { dbValues: ['VOLVO'], cyrillicStems: ['вольво', 'волво'] },
  { dbValues: ['CITROEN', 'CITROËN'], cyrillicStems: ['сітроен', 'ситроен'] },
  { dbValues: ['SEAT'], cyrillicStems: ['сеат', 'сіат'] },
  { dbValues: ['CHERY'], cyrillicStems: ['чері', 'чери'] },
  { dbValues: ['GEELY'], cyrillicStems: ['джилі', 'джили'] },
  { dbValues: ['INFINITI'], cyrillicStems: ['інфініті', 'инфинити'] },
  { dbValues: ['ACURA'], cyrillicStems: ['акура'] },
  { dbValues: ['GREAT WALL', 'GREATWALL'], cyrillicStems: ['грейт вол', 'грейтвол'] },
];

// Українські/російські прийменники й "шумові" слова, які трапляються
// поруч із маркою/роком у вільному тексті запиту ("на", "для", "року")
// і не несуть сенсу для пошуку моделі — прибираються при виділенні
// "залишку" (див. extractCarReference у lib/searchCarText.ts)
export const CAR_QUERY_STOPWORDS = [
  'на',
  'для',
  'до',
  'року',
  'р',
  'рік',
  'год',
  'года',
  'г',
  'авто',
  'автомобіль',
  'автомобіля',
  'машину',
  'машина',
  'машини',
];

// Результат розпізнавання марки у вільному тексті — навмисно НЕ
// CarMakeDef цілком: dbValues потрібні для SQL-фільтра, matchedText —
// щоб вирізати саме ці символи з тексту запиту й лишити тільки
// модель/рік. slug/name/logo (є лише в курованих CAR_MAKES) для
// самого розпізнавання не потрібні
export interface DetectedCarMake {
  dbValues: string[];
  matchedText: string;
}

// Розпізнає марку авто у ДОВІЛЬНОМУ тексті запиту — шукає ціле слово,
// що ПОЧИНАЄТЬСЯ з одного з кириличних коренів (див. cyrillicStems
// вище), а також пряме входження латинської назви/dbValues (якщо
// покупець написав марку англійською, напр. "mazda"). Перевіряє і
// куровані CAR_MAKES (є сторінка /marky), і SEARCH_ONLY_CAR_MAKES
// (є лише в базі, без власної сторінки) — для пошуку різниці немає.
// Повертає марку з НАЙДОВШИМ співпадінням кореня — так "ленд ровер"
// (два слова) переважає над випадковим коротким збігом
export function detectCarMakeInText(text: string): DetectedCarMake | null {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  if (normalized.trim().length === 0) return null;

  const allMakes: SearchOnlyCarMake[] = [
    ...CAR_MAKES.map((m) => ({ dbValues: m.dbValues, cyrillicStems: [...m.cyrillicStems, m.name.toLowerCase()] })),
    ...SEARCH_ONLY_CAR_MAKES,
  ];

  let best: DetectedCarMake | null = null;
  let bestStemLength = 0;

  for (const make of allMakes) {
    const candidates = [...make.cyrillicStems, ...make.dbValues.map((v) => v.toLowerCase())];
    for (const stem of candidates) {
      const stemTrimmed = stem.trim();
      if (!stemTrimmed) continue;
      // Шукаємо слово, що ПОЧИНАЄТЬСЯ зі stem одразу після межі слова
      // (пробіл/початок рядка) — самі stems містять лише літери/пробіли,
      // спецсимволів regex тут нема, тому звичайний indexOf безпечний
      const idx = normalized.indexOf(` ${stemTrimmed}`);
      if (idx === -1) continue;

      // Знаходимо повне слово, що містить це співпадіння, аби вирізати
      // з тексту саме те, що покупець реально написав ("мазду", а не
      // лише корінь "мазд")
      const afterStemStart = idx + 1;
      let wordEnd = normalized.indexOf(' ', afterStemStart);
      if (wordEnd === -1) wordEnd = normalized.length;
      const fullWord = normalized.slice(afterStemStart, wordEnd);

      if (stemTrimmed.length > bestStemLength) {
        bestStemLength = stemTrimmed.length;
        best = { dbValues: make.dbValues, matchedText: fullWord };
      }
    }
  }

  return best;
}

export function getCarMakeBySlug(slug: string): CarMakeDef | undefined {
  return CAR_MAKES.find((m) => m.slug === slug);
}

// Зворотний пошук — за значенням products.car_make конкретного товару
// знайти відповідну марку зі списку (для хлібних крихт на сторінці
// товару, app/p/[id]/[[...slug]]/page.tsx). null/невідоме значення —
// не помилка, просто товар без розпізнаної марки (крихта тоді не
// показується)
export function getCarMakeByDbValue(value: string | null | undefined): CarMakeDef | undefined {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return CAR_MAKES.find((m) => m.dbValues.includes(upper));
}

// Зворотний пошук — за КУРОВАНОЮ назвою марки (тим, що показує сам
// покупець у випадаючому списку на вітрині, напр. "Volkswagen") знайти
// її означення зі списком усіх варіантів написання. Потрібен там, де
// покупач вже обрав марку зі списку card-options (field=make — див.
// app/api/products/car-options/route.ts), а її треба зіставити з
// products.car_make/tecdoc_compatibility.make, де ця сама марка може
// бути записана як завгодно ("VW", "VOLKSWAGEN"...)
export function getCarMakeByName(name: string | null | undefined): CarMakeDef | undefined {
  if (!name) return undefined;
  const trimmed = name.trim().toLowerCase();
  return CAR_MAKES.find((m) => m.name.toLowerCase() === trimmed);
}

// Приводить значення марки, обране покупцем у випадаючому списку, до
// масиву варіантів написання для точного (регістронезалежного) SQL-
// порівняння через "UPPER(колонка) = ANY($N::text[])" — однаково
// придатний і для products.car_make, і для tecdoc_compatibility.make.
// Якщо марка курована (є в CAR_MAKES) — повертає ВСІ її варіанти
// написання одразу (наприклад, для Volkswagen — і "VW", і "VOLKSWAGEN"),
// інакше — просто саме передане значення (некурована марка, є лише в
// products.car_make одним написанням)
export function resolveMakeDbValues(make: string): string[] {
  const curated = getCarMakeByName(make);
  return curated ? curated.dbValues : [make.trim().toUpperCase()];
}

// (name ILIKE ANY(...) з lib/categories.ts тут не підходить — car_make
// порівнюємо ТОЧНИМ значенням, регістронезалежно, а не пошуком
// підрядка: інакше "VW" підхопив би, наприклад, помилково будь-яке
// слово з цими літерами всередині
export function buildMakeWhereClause(make: CarMakeDef, paramIndex: number): { clause: string; param: string[] } {
  return {
    // p. — розраховано на запит виду "FROM products p" (не голе
    // car_make): сторінки марок JOIN'ять suppliers за delivery_time,
    // а без префіксу car_make був би неоднозначним відносно
    // suppliers.* при такому JOIN
    clause: `UPPER(p.car_make) = ANY($${paramIndex})`,
    param: make.dbValues.map((v) => v.toUpperCase()),
  };
}
