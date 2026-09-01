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
}

export const CAR_MAKES: CarMakeDef[] = [
  { slug: 'toyota', name: 'Toyota', dbValues: ['TOYOTA'] },
  { slug: 'nissan', name: 'Nissan', dbValues: ['NISSAN'] },
  { slug: 'mitsubishi', name: 'Mitsubishi', dbValues: ['MITSUBISHI'] },
  { slug: 'hyundai', name: 'Hyundai', dbValues: ['HYUNDAI'] },
  { slug: 'mazda', name: 'Mazda', dbValues: ['MAZDA'] },
  { slug: 'honda', name: 'Honda', dbValues: ['HONDA'] },
  { slug: 'kia', name: 'Kia', dbValues: ['KIA'] },
  { slug: 'suzuki', name: 'Suzuki', dbValues: ['SUZUKI'] },
  { slug: 'subaru', name: 'Subaru', dbValues: ['SUBARU'] },
  { slug: 'ssangyong', name: 'SsangYong', dbValues: ['SSANG YONG', 'SSANGYONG'] },
  { slug: 'isuzu', name: 'Isuzu', dbValues: ['ISUZU'] },
  { slug: 'ford', name: 'Ford', dbValues: ['FORD'] },
  { slug: 'mercedes-benz', name: 'Mercedes-Benz', dbValues: ['MERCEDES', 'MERCEDES-BENZ'] },
  { slug: 'daewoo', name: 'Daewoo', dbValues: ['DAEWOO'] },
  { slug: 'daihatsu', name: 'Daihatsu', dbValues: ['DAIHATSU'] },
  { slug: 'bmw', name: 'BMW', dbValues: ['BMW'] },
  { slug: 'renault', name: 'Renault', dbValues: ['RENAULT'] },
  { slug: 'volkswagen', name: 'Volkswagen', dbValues: ['VW', 'VOLKSWAGEN'] },
  { slug: 'opel', name: 'Opel', dbValues: ['OPEL'] },
  { slug: 'jeep', name: 'Jeep', dbValues: ['JEEP'] },
  { slug: 'fiat', name: 'Fiat', dbValues: ['FIAT'] },
  { slug: 'land-rover', name: 'Land Rover', dbValues: ['LAND ROVER'] },
  { slug: 'audi', name: 'Audi', dbValues: ['AUDI'] },
  { slug: 'peugeot', name: 'Peugeot', dbValues: ['PEUGEOT'] },
  { slug: 'dodge', name: 'Dodge', dbValues: ['DODGE'] },
  { slug: 'chevrolet', name: 'Chevrolet', dbValues: ['CHEVROLET'] },
];

export function getCarMakeBySlug(slug: string): CarMakeDef | undefined {
  return CAR_MAKES.find((m) => m.slug === slug);
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
