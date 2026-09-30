// ============================================================
// Узкие категории "деталь + модель" (CategoryDef.catalogVehicle в
// lib/categories.ts) -> какую машину они описывают в СВОИХ данных:
// марка, модель и поколение из lib/carModelDictionary.ts. Товар
// остаётся в такой категории, только если его своя
// применимость (product_vehicles_own) подтверждает эту машину.
//
// Ключ — modelGroup категории (одна модель — несколько категорий:
// колодки, амортизаторы...). generation: null — поколение в названии
// категории не указано ("Toyota Camry", "Daewoo Lanos"), достаточно модели.
// Несколько строк — категория про несколько моделей (Ibiza + Cordoba).
// Категория без строки здесь своими данными не подтверждается — пустеет
// и отдаёт 301 на родительскую (app/category/[slug]/page.tsx)
// ============================================================

export interface NarrowVehicle {
  make: string;
  model: string;
  generation: string | null;
}

const v = (make: string, model: string, generation: string | null = null): NarrowVehicle => ({ make, model, generation });

export const NARROW_CATEGORY_VEHICLES: Record<string, NarrowVehicle[]> = {
  'daewoo-lanos': [v('daewoo', 'Lanos'), v('daewoo', 'Sens')],
  'toyota-camry': [v('toyota', 'Camry')],
  'toyota-corolla-e120': [v('toyota', 'Corolla', 'corolla-e120')],
  'toyota-corolla-e150': [v('toyota', 'Corolla', 'corolla-e150')],
  'toyota-prado-120': [v('toyota', 'Land Cruiser Prado', 'prado-120')],
  'toyota-carina-e': [v('toyota', 'Carina', 'carina-e')],
  'toyota-vitz-echo-verso': [v('toyota', 'Yaris / Vitz', 'vitz-1')],
  'toyota-vitz-2': [v('toyota', 'Yaris / Vitz', 'vitz-2')],
  'lexus-rx350': [v('lexus', 'RX', 'lexus-rx350')],
  'lexus-ls': [v('lexus', 'LS', 'lexus-ls-xf40')],
  'honda-accord-7': [v('honda', 'Accord', 'accord-7')],
  'honda-civic-4d': [v('honda', 'Civic', 'civic-8')],
  'honda-edix': [v('honda', 'FR-V / Edix')],
  'mazda6-gg': [v('mazda', 'Mazda 6', '6-gg')],
  'mazda-cx5': [v('mazda', 'CX-5', 'cx-5-ke')],
  'mazda-626-mk3': [v('mazda', '626', '626-mk3')],
  'mitsubishi-pajero-2': [v('mitsubishi', 'Pajero', 'pajero-2')],
  'mitsubishi-carisma': [v('mitsubishi', 'Carisma')],
  'mitsubishi-galant-4': [v('mitsubishi', 'Galant', 'galant-4')],
  'mitsubishi-legnum-aspire': [v('mitsubishi', 'Legnum / Aspire')],
  'mitsubishi-l400': [v('mitsubishi', 'L400 / Space Gear')],
  'nissan-qashqai-j11': [v('nissan', 'Qashqai', 'qashqai-j11')],
  'nissan-sentra-n15': [v('nissan', 'Sentra', 'sentra-n15')],
  'nissan-sentra-n16': [v('nissan', 'Sentra', 'sentra-n16')],
  'nissan-micra-march-k12': [v('nissan', 'Micra / March', 'micra-k12')],
  'nissan-murano-z51': [v('nissan', 'Murano', 'murano-z51')],
  'nissan-quest-e52': [v('nissan', 'Quest', 'quest-e52')],
  'nissan-maxima-j32': [v('nissan', 'Maxima', 'maxima-j32')],
  'nissan-frontier-d40': [v('nissan', 'Navara / Frontier', 'navara-d40')],
  'suzuki-sx4': [v('suzuki', 'SX4', 'sx4')],
  'subaru-impreza-gc-gf': [v('subaru', 'Impreza', 'impreza-gc')],
  'vw-passat-b5': [v('volkswagen', 'Passat', 'passat-b5')],
  'vw-golf-3': [v('volkswagen', 'Golf', 'golf-3')],
  'vw-golf-4': [v('volkswagen', 'Golf', 'golf-4')],
  'vw-polo-9n': [v('volkswagen', 'Polo', 'polo-9n')],
  'vw-polo-sedan': [v('volkswagen', 'Polo', 'polo-classic')],
  'vw-jetta-4': [v('volkswagen', 'Jetta', 'jetta-4')],
  'vw-touareg': [v('volkswagen', 'Touareg', 'touareg-1')],
  'skoda-octavia-1u': [v('skoda', 'Octavia', 'octavia-1u')],
  'skoda-octavia-1': [v('skoda', 'Octavia', 'octavia-1u')],
  'skoda-octavia-2': [v('skoda', 'Octavia', 'octavia-1z')],
  'skoda-fabia-6y': [v('skoda', 'Fabia', 'fabia-6y')],
  'skoda-fabia-praktik': [v('skoda', 'Fabia', 'fabia-5j')],
  'skoda-superb-2': [v('skoda', 'Superb', 'superb-2')],
  'seat-ibiza-2-cordoba': [v('seat', 'Ibiza', 'ibiza-2'), v('seat', 'Cordoba', 'cordoba-1')],
  'seat-leon-1': [v('seat', 'Leon', 'leon-1')],
  'seat-toledo-2': [v('seat', 'Toledo', 'toledo-2')],
  'audi-a1': [v('audi', 'A1')],
  'audi-a3-8p': [v('audi', 'A3', 'a3-8p')],
  'audi-a4-b5': [v('audi', 'A4', 'a4-b5')],
  'audi-a6-c5': [v('audi', 'A6', 'a6-c5')],
  'audi-q7-4l': [v('audi', 'Q7', 'q7-4l')],
  'bmw-5-e39': [v('bmw', '5 Series', 'bmw-5-e39')],
  'bmw-5-e60': [v('bmw', '5 Series', 'bmw-5-e60')],
  'bmw-7-e38': [v('bmw', '7 Series', 'bmw-7-e38')],
  'bmw-7-e65': [v('bmw', '7 Series', 'bmw-7-e65')],
  'bmw-x5-e53': [v('bmw', 'X5', 'bmw-x5-e53')],
  'mercedes-e-class-c124': [v('mercedes-benz', 'E-Class', 'e-class-124')],
  'mercedes-sprinter-vw-lt': [v('mercedes-benz', 'Sprinter', 'sprinter-1'), v('volkswagen', 'LT')],
  'citroen-berlingo-mf': [v('citroen', 'Berlingo', 'berlingo-mf')],
  'citroen-xsara-n1': [v('citroen', 'Xsara')],
  'opel-vectra-c': [v('opel', 'Vectra', 'vectra-c')],
  'ford-sierra': [v('ford', 'Sierra')],
  'ford-focus-2-cmax': [v('ford', 'Focus', 'focus-2'), v('ford', 'C-Max', 'c-max-1')],
  'renault-clio-3': [v('renault', 'Clio', 'clio-3')],
  'renault-modus': [v('renault', 'Modus')],
};

// Строки для категории (по modelGroup, иначе по slug)
export function narrowCategoryVehicles(category: { slug: string; modelGroup?: string }): NarrowVehicle[] {
  return NARROW_CATEGORY_VEHICLES[category.modelGroup ?? category.slug] ?? [];
}
