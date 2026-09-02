// ============================================================
// Довідник "розділів" автомобіля для великої іконної сітки на
// головній (за мотивами каталогу конкурента lr-parts.com.ua — це
// стандартна для авто-запчастин категорійна структура, яку
// використовує ціла низка подібних магазинів) — на відміну від
// lib/categories.ts, це НЕ окремі SEO-сторінки з товарами, а спосіб
// згрупувати вже наявні вузькі категорії (гальмівні колодки,
// амортизатори, фільтри...) під звичні покупцю широкі розділи авто.
//
// categorySlugs — посилання на CategoryDef.slug з lib/categories.ts.
// Порожній масив означає, що під цей розділ у нас поки що НЕМАЄ
// жодної категорії товару (наприклад, паливна система чи система
// випуску — таких запчастин ми ще не продаємо) — такі розділи на
// головній ведуть не на порожню сторінку, а в підбір за VIN
// (див. components/StorefrontHome.tsx), щоб не обіцяти те, чого
// фактично немає в каталозі. Один і той же підкатегорія (наприклад,
// "Салонні фільтри") цілком може входити одразу у два розділи —
// і в "Запчастини для ТО", і в "Елементи салону" — так само, як і в
// реальних каталогах
// ============================================================

export interface DepartmentDef {
  slug: string;
  name: string;
  // Категорії з lib/categories.ts, які входять у цей розділ.
  categorySlugs: string[];
}

export const DEPARTMENTS: DepartmentDef[] = [
  {
    slug: 'to',
    name: 'Запчастини для ТО',
    categorySlugs: [
      'oliyni-filtry',
      'povitryani-filtry',
      'salonni-filtry',
      'svichky-zapaliuvannia',
      'remeni-rolyky-grm',
      'motorni-olyvy',
    ],
  },
  { slug: 'dvyhun-detali', name: 'Деталі двигуна', categorySlugs: [] },
  { slug: 'palyvna', name: 'Паливна система', categorySlugs: [] },
  { slug: 'vypusk', name: 'Система випуску', categorySlugs: [] },
  { slug: 'oholodzhennya', name: 'Система охолодження', categorySlugs: [] },
  { slug: 'dvyhun-v-zbori', name: 'Двигун в зборі', categorySlugs: [] },
  { slug: 'opalennya', name: 'Опалення і клімат', categorySlugs: [] },
  { slug: 'transmisiya', name: 'Трансмісія і КПП', categorySlugs: [] },
  {
    slug: 'hodova',
    name: 'Ходова, підвіска',
    categorySlugs: ['amortyzatory', 'sailentbloky-vazhelia', 'vtulky-stabilizatora', 'kulovi-opory', 'pidshypnyky-matochyny'],
  },
  { slug: 'kuzov', name: 'Деталі кузова', categorySlugs: [] },
  { slug: 'kriplennya', name: "Кріплення і кронштейни", categorySlugs: [] },
  { slug: 'halmivna', name: 'Гальмівна система', categorySlugs: ['halmivni-kolodky', 'halmivni-dysky'] },
  { slug: 'kermo', name: 'Кермове управління', categorySlugs: [] },
  { slug: 'salon', name: 'Елементи салону', categorySlugs: ['salonni-filtry'] },
  { slug: 'dysky', name: 'Колісні диски', categorySlugs: [] },
  { slug: 'bezpeka', name: 'Система безпеки', categorySlugs: [] },
  { slug: 'elektro', name: 'Електрообладнання', categorySlugs: [] },
  { slug: 'aksesuary', name: 'Аксесуари', categorySlugs: [] },
];

export function getDepartmentBySlug(slug: string): DepartmentDef | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}
