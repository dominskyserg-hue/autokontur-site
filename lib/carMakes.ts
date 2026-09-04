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
}

export const CAR_MAKES: CarMakeDef[] = [
  { slug: 'toyota', name: 'Toyota', dbValues: ['TOYOTA'], logo: '/car-logos/toyota.png' },
  { slug: 'nissan', name: 'Nissan', dbValues: ['NISSAN'], logo: '/car-logos/nissan.png' },
  { slug: 'mitsubishi', name: 'Mitsubishi', dbValues: ['MITSUBISHI'], logo: '/car-logos/mitsubishi.png' },
  { slug: 'hyundai', name: 'Hyundai', dbValues: ['HYUNDAI'], logo: '/car-logos/hyundai.png' },
  { slug: 'mazda', name: 'Mazda', dbValues: ['MAZDA'], logo: '/car-logos/mazda.png' },
  { slug: 'honda', name: 'Honda', dbValues: ['HONDA'], logo: '/car-logos/honda.png' },
  { slug: 'kia', name: 'Kia', dbValues: ['KIA'], logo: '/car-logos/kia.png' },
  { slug: 'suzuki', name: 'Suzuki', dbValues: ['SUZUKI'], logo: '/car-logos/suzuki.png' },
  { slug: 'subaru', name: 'Subaru', dbValues: ['SUBARU'], logo: '/car-logos/subaru.png' },
  { slug: 'ssangyong', name: 'SsangYong', dbValues: ['SSANG YONG', 'SSANGYONG'], logo: '/car-logos/ssangyong.png' },
  { slug: 'isuzu', name: 'Isuzu', dbValues: ['ISUZU'], logo: '/car-logos/isuzu.png' },
  { slug: 'ford', name: 'Ford', dbValues: ['FORD'], logo: '/car-logos/ford.png' },
  { slug: 'mercedes-benz', name: 'Mercedes-Benz', dbValues: ['MERCEDES', 'MERCEDES-BENZ'], logo: '/car-logos/mercedes-benz.png' },
  { slug: 'daewoo', name: 'Daewoo', dbValues: ['DAEWOO'], logo: '/car-logos/daewoo.png' },
  { slug: 'daihatsu', name: 'Daihatsu', dbValues: ['DAIHATSU'], logo: '/car-logos/daihatsu.png' },
  { slug: 'bmw', name: 'BMW', dbValues: ['BMW'], logo: '/car-logos/bmw.png' },
  { slug: 'renault', name: 'Renault', dbValues: ['RENAULT'], logo: '/car-logos/renault.png' },
  { slug: 'volkswagen', name: 'Volkswagen', dbValues: ['VW', 'VOLKSWAGEN'], logo: '/car-logos/volkswagen.png' },
  { slug: 'opel', name: 'Opel', dbValues: ['OPEL'], logo: '/car-logos/opel.png' },
  { slug: 'jeep', name: 'Jeep', dbValues: ['JEEP'], logo: '/car-logos/jeep.png' },
  { slug: 'fiat', name: 'Fiat', dbValues: ['FIAT'], logo: '/car-logos/fiat.png' },
  { slug: 'land-rover', name: 'Land Rover', dbValues: ['LAND ROVER'], logo: '/car-logos/land-rover.png' },
  { slug: 'audi', name: 'Audi', dbValues: ['AUDI'], logo: '/car-logos/audi.png' },
  { slug: 'peugeot', name: 'Peugeot', dbValues: ['PEUGEOT'], logo: '/car-logos/peugeot.png' },
  { slug: 'dodge', name: 'Dodge', dbValues: ['DODGE'], logo: '/car-logos/dodge.png' },
  { slug: 'chevrolet', name: 'Chevrolet', dbValues: ['CHEVROLET'], logo: '/car-logos/chevrolet.png' },
];

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
