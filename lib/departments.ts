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
  { slug: 'dvyhun-detali', name: 'Деталі двигуна', categorySlugs: ['prokladky-dvyhuna'] },
  { slug: 'palyvna', name: 'Паливна система', categorySlugs: ['palyvna-systema'] },
  { slug: 'vypusk', name: 'Система випуску', categorySlugs: ['systema-vypusku'] },
  { slug: 'oholodzhennya', name: 'Система охолодження', categorySlugs: ['systema-oholodzhennya'] },
  // dvyhun-v-zbori ("Двигун в зборі" — цілі контрактні двигуни) лишається
  // порожнім навмисно: перевірено запитом до бази, товарів із такою
  // назвою в каталозі практично немає (одиниці) — на відміну від решти
  // розділів нижче, де знайшлися тисячі реальних товарів
  { slug: 'dvyhun-v-zbori', name: 'Двигун в зборі', categorySlugs: [] },
  { slug: 'opalennya', name: 'Опалення і клімат', categorySlugs: ['opalennya-klimat'] },
  { slug: 'transmisiya', name: 'Трансмісія і КПП', categorySlugs: ['transmisiya-kpp'] },
  {
    slug: 'hodova',
    name: 'Ходова, підвіска',
    categorySlugs: ['amortyzatory', 'sailentbloky-vazhelia', 'vtulky-stabilizatora', 'kulovi-opory', 'pidshypnyky-matochyny'],
  },
  { slug: 'kuzov', name: 'Деталі кузова', categorySlugs: ['kuzov-detali'] },
  { slug: 'kriplennya', name: "Кріплення і кронштейни", categorySlugs: ['kriplennya-kronshteiny'] },
  { slug: 'halmivna', name: 'Гальмівна система', categorySlugs: ['halmivni-kolodky', 'halmivni-dysky'] },
  { slug: 'kermo', name: 'Кермове управління', categorySlugs: ['kermove-upravlinnya'] },
  { slug: 'salon', name: 'Елементи салону', categorySlugs: ['salonni-filtry'] },
  // dysky ("Колісні диски" — легкосплавні/штамповані ОБОДИ, а не
  // halmivni-dysky) і bezpeka лишаються порожніми: перевірено запитом
  // до бази — товарів під ці два розділи в каталозі одиниці (29 і 50
  // відповідно), окрема сторінка категорії поки не виправдана
  { slug: 'dysky', name: 'Колісні диски', categorySlugs: [] },
  { slug: 'bezpeka', name: 'Система безпеки', categorySlugs: [] },
  { slug: 'elektro', name: 'Електрообладнання', categorySlugs: ['generatory-startery'] },
  { slug: 'aksesuary', name: 'Аксесуари', categorySlugs: [] },
];

export function getDepartmentBySlug(slug: string): DepartmentDef | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}
