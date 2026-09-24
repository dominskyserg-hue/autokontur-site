// ============================================================
// Ручні SEO-оверрайди сторінки товару — по артикулу.
//
// НАВІЩО: автошаблон (lib/productDetail.ts, buildSeoProductName/
// buildSeoProductDescription) будує H1/title/description з того, що
// реально є в базі (категорія + бренд + артикул [+ марка/модель, якщо
// заповнені постачальником) — це працює для всіх ~20 000 товарів
// одразу, але для конкретного "гарячого" товару (той, що вже отримує
// трафік з Google) часто хочеться написати точніший, людський текст:
// не просто "Кріплення і кронштейни VAG 5G6907455A", а "Кронштейн
// радара сліпих зон Golf 7". Вигадувати такий текст автоматично не
// можна (сторінка не знає, що це саме кронштейн радара Side Assist) —
// тому це ручний, явно підтверджений контент, окремо від автошаблону.
//
// ПРІОРИТЕТ (lib/productDetail.ts): якщо для артикула є запис тут —
// він повністю перекриває і автошаблон, і старе ручне поле
// products.meta_description_override в базі (екран адміна "Товари") —
// останнє свідомо ігнорується, коли є запис тут, щоб не тримати два
// джерела правди для одного й того самого тексту.
//
// КЛЮЧ — артикул у НОРМАЛІЗОВАНОМУ вигляді (як його зберігає
// cleanArticle(), lib/productSearch.ts: верхній регістр, без
// пробілів/дефісів/крапок) — саме так article зберігається в
// products.article, звідти й порівнюється. Тому "5G6 907 455 A",
// "5G6-907-455-A" і "5G6907455A" — це ОДИН і той самий ключ.
//
// Секції (longDescription/specs/applicability/pairPart/faq) —
// НЕОБОВ'ЯЗКОВІ: якщо для товару якоїсь секції немає, вона просто не
// виводиться (ProductDetailContent.tsx). Нічого не вигадуємо для
// товарів, яких немає в цьому файлі, — вони й далі показують лише
// автошаблон, як і раніше.
// ============================================================

import { cleanArticle } from '@/lib/productSearch';

export interface SeoOverrideSpec {
  label: string;
  value: string;
}

// makeSlug — курована марка з lib/carMakes.ts (напр. "volkswagen"):
// якщо задано, пункт застосовності клікабельний і веде на
// /marky/[makeSlug]; якщо не задано — просто текст без посилання
export interface SeoOverrideApplicability {
  label: string;
  makeSlug?: string;
}

// Парна деталь (напр. "лівий/правий" варіант тієї самої запчастини).
// article перевіряється проти каталогу (lib/productDetail.ts) — якщо
// товар з таким артикулом реально є, пункт стає посиланням на нього;
// якщо ні — просто текст note без посилання
export interface SeoOverridePairPart {
  article: string;
  note: string;
}

export interface SeoOverrideFaqItem {
  question: string;
  // Звичайний готовий текст відповіді — БЕЗ конкретних термінів/дат,
  // які застаріють (сторінка може кешуватись, а наявність на складі
  // змінюється щодня) — напр. відповідь про термін доставки навмисно
  // без слова "сьогодні", просто відсилає уточнювати в Telegram/при
  // оформленні
  answer: string;
  // Необов'язкове посилання одразу під відповіддю (напр. на бота
  // Telegram для перевірки VIN) — окремо від тексту, а не заверстане
  // прямо в answer, щоб не парсити markdown/HTML з даних
  link?: { label: string; url: string };
}

export interface SeoOverride {
  h1?: string;
  // title/description — ПОВНІ рядки як є, без додавання шаблонних
  // суфіксів ("купити | DominatorParts" тощо) — те, що написано тут,
  // те й піде в <title>/<meta name="description">
  title?: string;
  description?: string;
  longDescription?: string;
  specs?: SeoOverrideSpec[];
  applicability?: SeoOverrideApplicability[];
  pairPart?: SeoOverridePairPart;
  faq?: SeoOverrideFaqItem[];
}

export const SEO_OVERRIDES: Readonly<Record<string, SeoOverride>> = {
  '5G6907455A': {
    h1: 'Кронштейн радара контролю сліпих зон (Side Assist) задній лівий VAG 5G6907455A',
    title: 'Кронштейн радара сліпих зон Golf 7 VAG 5G6907455A — купити',
    description:
      'Оригінальний кронштейн VAG 5G6907455A для радара контролю сліпих зон (Side Assist) VW Golf 7. Ціна 1737 грн. Оплата при отриманні, 14 днів на повернення.',
    longDescription:
      'Оригінальний кронштейн VAG 5G6907455A призначений для кріплення радара системи контролю сліпих зон (Blind Spot Detection / Side Assist) з лівого боку за заднім бампером. Застосовується на Volkswagen Golf VII (5G), у тому числі Golf GTI та Golf R. Номер 5G6907455A замінює попередню версію 5G6907455. Власники, які встановлюють Side Assist на рестайлінг Golf 7.5, рекомендують саме версію з літерою A — на ній радар розташований вище.',
    specs: [
      { label: 'Виробник', value: 'VAG (оригінал)' },
      { label: 'Артикул', value: '5G6907455A' },
      { label: 'Інші варіанти написання', value: '5G6 907 455 A, 5G6-907-455-A, 5G6.907.455.A' },
      { label: 'Замінює', value: '5G6907455' },
      { label: 'Сторона', value: 'ліва' },
      { label: 'Місце встановлення', value: 'задній бампер' },
      { label: 'Стан', value: 'новий' },
    ],
    applicability: [
      { label: 'Volkswagen Golf VII (5G)', makeSlug: 'volkswagen' },
      { label: 'Volkswagen Golf 7.5', makeSlug: 'volkswagen' },
      { label: 'Volkswagen Golf GTI', makeSlug: 'volkswagen' },
      { label: 'Volkswagen Golf R', makeSlug: 'volkswagen' },
    ],
    pairPart: {
      article: '5G6907456A',
      note: 'Парна деталь: правий кронштейн 5G6907456A',
    },
    faq: [
      {
        question: 'Чим відрізняється 5G6907455 від 5G6907455A?',
        answer:
          'Версія A новіша і замінює 5G6907455; за досвідом власників, на ній радар стоїть вище, що важливо для рестайлінгового бампера Golf 7.5.',
      },
      {
        question: 'Чи підійде кронштейн на мій автомобіль?',
        answer: 'Надішліть VIN у Telegram, ми перевіримо сумісність.',
        link: { label: 'Написати в Telegram', url: 'https://t.me/dominatorparts_orders_bot' },
      },
      {
        question: 'Скільки часу доставка?',
        answer: 'Товар під замовлення. Точний термін доставки уточнюйте в Telegram або при оформленні замовлення.',
      },
      {
        question: 'Чи можна повернути?',
        answer: 'Так, 14 днів на повернення.',
      },
    ],
  },
};

// article — БУДЬ-ЯКЕ написання (з пробілами/дефісами/в іншому
// регістрі) — нормалізується так само, як при збереженні товару в
// базу (cleanArticle, lib/productSearch.ts), тому шукати можна як
// реальним products.article, так і "гарним" написанням з наліпки
// виробника
export function getSeoOverride(article: string): SeoOverride | undefined {
  return SEO_OVERRIDES[cleanArticle(article)];
}
