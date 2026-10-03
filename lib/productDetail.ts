// ============================================================
// Дані для сторінки ОДНОГО товару — спільний код для двох місць
// рендеру одного й того самого товару:
//   1. app/p/[id]/[[...slug]]/page.tsx — повна сторінка (пряме
//      посилання, перезавантаження, боти Google)
//   2. app/@modal/(...)p/[id]/[[...slug]]/page.tsx — те саме, але у
//      модальному вікні поверх каталогу (клік по картці товару в
//      components/StorefrontHome.tsx та на сторінках категорій/марок)
//
// Обидва місця показують ОДНІ Й ТІ САМІ дані з бази — тому весь
// доступ до бази винесено сюди один раз, щоб не тримати дві копії
// SQL-запитів, які легко розсинхронізувати при майбутніх правках
// ============================================================

import { cache } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { Pool } from 'pg';
import { buildProductPath, buildProductSlug } from '@/lib/slug';
import { CAR_MAKES, getCarMakeByDbValue } from '@/lib/carMakes';
import { generationLabel, OTHER_GENERATION } from '@/lib/carModelDictionary';
import { detectCategoryForProductName, detectCategoryForProductH1, getCategoryBySlug } from '@/lib/categories';
import { cleanApplicability } from '@/lib/carModelTranslation';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { loadBreadcrumbCategories } from '@/lib/productCategoryLookup';
import { buildDisplayProductNameDetailed } from '@/lib/productNameTranslation';
import { brandsAreSameFamily } from '@/lib/brandFamilies';
import { crossSideMatchesSql } from '@/lib/crossBrandMatch';
import { ensureUkrainianCorpusFresh } from '@/lib/ukrainianCorpus';
import { hubPath, MODEL_HUBS } from '@/lib/modelHubs';
import { loadVisibleHubs } from '@/lib/modelHubData';
import { findNarrowCategoryForOwnVehicle, linkableCategory, loadThinNarrowCategories } from '@/lib/narrowCategoryStatus';
import { SITE_URL } from '@/lib/siteConfig';
import type { BreadcrumbItem } from '@/lib/structuredData';
import { getCustomerPricingRule, computeCustomerPrice } from '@/lib/customerPricing';
import { getCustomerSessionPhone } from '@/lib/customerAuth';
import { getSeoOverride, type SeoOverride, type SeoOverrideFaqItem } from '@/data/seo-overrides';
import { PRODUCT_GROUPS_ACTIVE } from '@/lib/productGroups';
import { publicImageUrl } from '@/lib/imageUrl';
import { isOwnStock } from '@/lib/ownStock';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------
// SEO-ШАБЛОН НАЗВИ ТОВАРУ (H1, <title>, Product.name у JSON-LD)
// ------------------------------------------------------------
// Назва товару приходить з прайсу постачальника як є — часто
// російською і без згадки марки/моделі авто ("G1/ТОРМОЗНЫЕ КОЛОДКИ").
// Замість такого тексту в H1/title показуємо шаблон "Категорія Бренд
// Артикул [для Марка Модель]":
//   - Категорія — визначена ТИМ САМИМ способом (matchGroups), яким уже
//     побудований каталог і хлібні крихти (detectCategoryForProductName)
//     — це не вигадка, а вже наявна в коді класифікація, тому тип
//     деталі спотворити тут не можна
//   - "для Марка Модель" додається, ЛИШЕ якщо ці дані вже реально є в
//     товару в базі (products.car_make/car_model, заповнюються з
//     Excel-прайса постачальника) — жодна сумісність не вигадується
// Якщо категорію розпізнати не вдалось — лишається стара поведінка
// (назва з прайсу, або бренд+артикул, якщо назви взагалі нема)
// Марка авто в базі часто записана КАПСОМ, як прислав постачальник
// ("TOYOTA") — показуємо курировану назву з lib/carMakes.ts
// ("Toyota"), якщо марка курована; інакше просто приводимо регістр
// (перша літера кожного слова — велика) замість сирого капсу
// Чи зустрічається brand як ОКРЕМЕ слово в text (регістронезалежно) —
// потрібно, щоб не додавати бренд деталі ЩЕ РАЗ у H1, коли він і так
// уже є в назві вузької категорії ("...Suzuki SX4" + бренд "SUZUKI").
// На відміну від подібної перевірки в lib/categories.ts
// (containsWholeWord, ігнорує ключі коротші за 3 символи — там це
// ключові слова моделі), тут довжина не обмежена: бренди на
// кшталт "VW" — реальні, короткі за визначенням
function brandMatchesWord(text: string, brand: string): boolean {
  const trimmedBrand = brand.trim();
  if (!trimmedBrand) return false;
  // Екрануємо спецсимволи regex — бренд це вільний текст з прайсу
  // постачальника, а не заздалегідь довірений патерн
  const escaped = trimmedBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^A-ZА-ЯЁІЇЄ0-9])${escaped}(?:[^A-ZА-ЯЁІЇЄ0-9]|$)`, 'i');
  return pattern.test(text);
}

function formatCarMakeDisplay(rawMake: string): string {
  const curated = getCarMakeByDbValue(rawMake);
  if (curated) return curated.name;
  return rawMake
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(' ');
}

// ------------------------------------------------------------
// H1 / TITLE ТОВАРУ: складається з ЧАСТИН, щоб title міг обрізати
// ЛИШЕ назву, а бренд і артикул лишались завжди (див. buildSeoMetaTitle)
// ------------------------------------------------------------
// Правила H1 (власник затвердив):
//   1. Переклад пройшов страховку -> H1 = переведена назва + бренд +
//      артикул (+ "для Марка Модель"). Категорія — лише запасний
//      варіант (переклад відкотився чи назви немає)
//   2. Виняток: у широкій категорії з itemName, якщо переведена назва —
//      це лише тип деталі (<= 3 слів, усі слова є у словнику категорії,
//      без цифр і латиниці) — беремо itemName категорії ("Гальмівний
//      диск", "Оливний фільтр"), бо переклад нічого не додає
//   3. Назва довша за 70 символів обрізається по межі слова (а не
//      відкочується до категорії), далі бренд + артикул
//   4. "для ..." не додається, якщо car_model схожий на код (збігається
//      з артикулом або "ILKR9G8"-подібний) чи марка вже є в H1
interface SeoNameParts {
  // Ручний override.h1 — повністю готовий рядок, частини не потрібні
  fixedH1: string | null;
  name: string;
  brand: string | null;
  article: string | null;
  // true — H1 складається ЛИШЕ з name (запасний варіант "назва без
  // бренду й артикула", коли категорії нема)
  bare: boolean;
  tail: string | null;
}

const H1_NAME_MAX_LENGTH = 70;

function compactText(text: string): string {
  return text.replace(/[^A-Za-z0-9А-Яа-яІіЇїЄєҐґ]/g, '').toUpperCase();
}

// Стемми (перші 4 літери) слів категорії — щоб зрозуміти, чи переведена
// назва додає щось понад сам тип деталі
function isOnlyPartType(name: string, category: { name: string; itemName?: string; matchGroups: string[][] }): boolean {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;
  if (/[0-9A-Za-z]/.test(name)) return false;
  const content = (name.toLowerCase().match(/[а-яіїєґё]+/g) ?? []).filter((word) => word.length >= 3);
  if (content.length === 0) return false;
  const vocabulary = new Set(
    (`${category.name} ${category.itemName ?? ''} ${category.matchGroups.flat().join(' ')}`.toLowerCase().match(/[а-яіїєґё]{3,}/g) ?? []).map(
      (word) => word.slice(0, 4)
    )
  );
  return content.every((word) => vocabulary.has(word.slice(0, 4)));
}

// car_model, який насправді є кодом деталі, а не моделлю авто: збігається
// з артикулом, або одне слово з >= 5 символів, з цифрами й >= 3 літерами
// і без голосних ("GLS450"), або з >= 3 переходами літера<->цифра
// ("ILKR9G8"). Такий текст у "для ..." давав би сміття
function looksLikeCode(model: string, article: string): boolean {
  const compactModel = compactText(model);
  if (compactModel && compactModel === compactText(article)) return true;
  const trimmed = model.trim();
  if (/[\s\-/.,()]/.test(trimmed) || trimmed.length < 5) return false;
  if (!/\d/.test(trimmed) || !/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(trimmed)) return false;
  const letters = trimmed.toLowerCase().replace(/[^a-zа-яіїєґё]/g, '');
  if (!/[aeiouyаеєиіїоуюяы]/.test(letters) && letters.length >= 3) return true;
  let transitions = 0;
  for (let i = 1; i < trimmed.length; i++) {
    if (/\d/.test(trimmed[i]) !== /\d/.test(trimmed[i - 1])) transitions++;
  }
  return transitions >= 3;
}

// Довгу назву (перелік авто через ";" чи ",") ріжемо по останньому
// роздільнику в межах ліміту, щоб не обірвати посеред слова/марки
// ("...Opel Astra H 04-14; ALFA" -> "...Opel Astra H 04-14"); якщо
// роздільника нема (або він надто близько до початку) — по межі слова
function truncateNameForH1(name: string): string {
  const head = name.slice(0, H1_NAME_MAX_LENGTH + 1);
  const separatorIndex = Math.max(head.lastIndexOf(';'), head.lastIndexOf(','));
  const cut = separatorIndex >= 25 ? head.slice(0, separatorIndex) : truncateAtWordBoundary(name, H1_NAME_MAX_LENGTH);
  return cut.replace(/[\s,;:\-–—(/]+$/, '');
}

function buildSeoNameParts(product: {
  name: string | null;
  brand: string | null;
  article: string;
  carMake?: string | null;
  carModel?: string | null;
  fallbackName?: string | null;
}): SeoNameParts {
  // Ручний SEO-оверрайд (data/seo-overrides.ts) — якщо для артикула
  // заданий h1, він ПОВНІСТЮ перекриває автошаблон нижче
  const override = getSeoOverride(product.article);
  if (override?.h1) return { fixedH1: override.h1, name: '', brand: null, article: null, bare: false, tail: null };

  // Власна назва непридатна (порожня, "-", "Зп"...) -> назва з іншого
  // прайсу того ж артикула, якщо вона знайдена (loadProduct)
  const ownNameUsable = (buildCleanProductName(product.name)?.length ?? 0) >= 3;
  const sourceName = ownNameUsable ? product.name : product.fallbackName || product.name;

  // КРОК 1 (очищена назва) — для визначення категорії: вона розпізнає і
  // російські, і українські слова
  const cleanName = buildCleanProductName(sourceName);
  const usableCleanName = cleanName && cleanName.length >= 3 ? cleanName : null;
  // КРОК 2 — переведена назва (зі страховкою) + курований регістр марок
  const displayDetailed = buildDisplayProductNameDetailed(sourceName);
  const displayName = displayDetailed?.text ?? null;
  const usableDisplayName = displayName && displayName.length >= 3 ? displayName : null;
  const translationPassed = Boolean(displayDetailed?.safe && usableDisplayName);

  // Категорія: враховує вузькі "по машині" лише коли марка/модель товару
  // реально збігаються (lib/categories.ts, detectCategoryForProductH1)
  const category = detectCategoryForProductH1(usableCleanName, product.carMake, product.carModel);
  const categoryLabel = category ? category.itemName ?? category.name : null;

  let parts: Omit<SeoNameParts, 'tail'>;
  let usedNarrowCategory = false;
  if (translationPassed) {
    let name = usableDisplayName!;
    if (category && !category.modelGroup && category.itemName && isOnlyPartType(name, category)) {
      name = category.itemName;
    } else if (name.length > H1_NAME_MAX_LENGTH) {
      name = truncateNameForH1(name);
    }
    parts = { fixedH1: null, name, brand: product.brand, article: product.article, bare: false };
  } else if (category) {
    usedNarrowCategory = Boolean(category.modelGroup);
    parts = { fixedH1: null, name: categoryLabel!, brand: product.brand, article: product.article, bare: false };
  } else if (usableDisplayName) {
    parts = { fixedH1: null, name: usableDisplayName, brand: null, article: null, bare: true };
  } else {
    parts = { fixedH1: null, name: '', brand: product.brand, article: product.article, bare: false };
  }

  // "для Марка Модель": вузька категорія вже містить авто в назві;
  // cleanApplicability = null — ненадійна застосовність (код "#..." чи
  // нерозпізнане російське слово) — краще не показувати нічого
  let tail: string | null = null;
  if (product.carMake && !usedNarrowCategory) {
    const cleanedModel = cleanApplicability(product.carModel);
    // Лише ПЕРША модель (до ";" чи "," перед літерою — кома між цифрами
    // "2,4" не роздільник), не довше ~40 символів разом із маркою
    const firstModel =
      cleanedModel === null ? null : cleanedModel.split(/;|,(?=\s*[A-Za-zА-Яа-яІіЇїЄєҐґ])/)[0].trim();
    if (cleanedModel !== null && firstModel && !looksLikeCode(firstModel, product.article)) {
      const rawMake = product.carMake.trim();
      const makeDisplay = formatCarMakeDisplay(rawMake);
      // Деякі постачальники записують carModel уже ІЗ повторенням марки
      // ("MAZDA 323 (BJ)..." при carMake "MAZDA") — замінюємо сире
      // написання на курировану назву, а не дублюємо марку
      const modelAlreadyHasMake = firstModel.toUpperCase().startsWith(rawMake.toUpperCase());
      const vehicleFull = modelAlreadyHasMake
        ? [makeDisplay, firstModel.slice(rawMake.length).trim()].filter(Boolean).join(' ')
        : [makeDisplay, firstModel].filter(Boolean).join(' ');
      const vehicle = truncateAtWordBoundary(vehicleFull, 40).replace(/[\s,;:\-–—(/`'~.]+$/, '');
      tail = `для ${vehicle}`;
      // Марка вже є в самому H1 (в назві чи бренді) — "для Nissan Altima"
      // після "...Nissan Altima 2.5 06-13" було б повтором
      const withoutTail = assembleSeoName({ ...parts, tail: null });
      if (brandMatchesWord(withoutTail, makeDisplay) || brandMatchesWord(withoutTail, rawMake)) tail = null;
    }
  }
  return { ...parts, tail };
}

// Збирає рядок з частин. nameOverride — обрізана назва (для title);
// бренд/артикул не дублюються, якщо вже є у (можливо обрізаній) назві
function assembleSeoName(parts: SeoNameParts, nameOverride?: string, includeTail = true): string {
  if (parts.fixedH1 !== null) return parts.fixedH1;
  const name = nameOverride ?? parts.name;
  const pieces: string[] = [];
  if (name) pieces.push(name);
  if (parts.brand && !(name && brandMatchesWord(name, parts.brand))) pieces.push(parts.brand);
  if (parts.article && !(name && parts.article.length >= 4 && compactText(name).includes(compactText(parts.article)))) {
    pieces.push(parts.article);
  }
  const base = pieces.join(' ') || parts.article || '';
  // Подвійні пробіли з прайсу постачальника ("0w-20  SP") — в один
  return (includeTail && parts.tail ? `${base} ${parts.tail}` : base).replace(/\s+/g, ' ').trim();
}

// Назва-частина, що реально потрапила в H1 (після перекладу/обрізки/
// заміни на itemName категорії) — для рядка "Назва в каталозі
// постачальника": він показується, лише якщо відрізняється від неї
export function getSeoNameInH1(product: {
  name: string | null;
  brand: string | null;
  article: string;
  carMake?: string | null;
  carModel?: string | null;
  fallbackName?: string | null;
}): string {
  const parts = buildSeoNameParts(product);
  return parts.fixedH1 ?? parts.name;
}

export function buildSeoProductName(product: {
  name: string | null;
  brand: string | null;
  article: string;
  carMake?: string | null;
  carModel?: string | null;
  // Сире products.name ТОГО САМОГО артикула з іншого прайсу (той самий
  // бренд або затверджена "родина" брендів, lib/brandFamilies.ts) —
  // використовується ЛИШЕ коли власне ім'я товару порожнє/сміттєве
  fallbackName?: string | null;
}): string {
  return assembleSeoName(buildSeoNameParts(product));
}

// Ціна для meta description/title — той самий формат округлення
// (Math.ceil, без копійок), що й видима ціна на сторінці
// (formatMoney у components/ProductDetailContent.tsx) і ціна в Offer
// JSON-LD (lib/structuredData.ts) — щоб текст ніде не розходився з
// тим, що покупець реально бачить
function formatPriceUk(price: number): string {
  return Math.ceil(price).toLocaleString('uk-UA');
}

// Пріоритет опису (від найвищого до найнижчого):
//   1. Ручний SEO-оверрайд (data/seo-overrides.ts, override.description) —
//      повний готовий текст, вигаданий свідомо і перевірений людиною
//   2. Старе ручне поле products.meta_description_override (екран
//      адміна "Товари") — АЛЕ тільки якщо для артикула взагалі НЕМАЄ
//      запису в SEO_OVERRIDES: якщо запис є (навіть без свого
//      description), файловий оверрайд вважається новим єдиним
//      джерелом правди, і застаріле поле з бази свідомо ігнорується —
//      інакше для товарів на кшталт 5G6907455A й далі показувалась би
//      стара російська meta_description з бази, хоч на цю сторінку і
//      написали новий український опис
//   3. Автошаблон — назва (buildSeoProductName, теж враховує override.h1
//      вище) + РЕАЛЬНА ціна товару + наявність/термін доставки
export function buildSeoProductDescription(product: {
  name: string | null;
  brand: string | null;
  article: string;
  carMake?: string | null;
  carModel?: string | null;
  fallbackName?: string | null;
  metaDescription: string | null;
  metaDescriptionOverride: boolean;
  stock: number;
  deliveryTime?: string | null;
  retailPrice: number;
  groupMinPrice?: number | null;
}): string {
  const override = getSeoOverride(product.article);
  if (override?.description) return override.description;

  if (!override && product.metaDescriptionOverride && product.metaDescription?.trim()) {
    return product.metaDescription.trim();
  }

  // Раніше сюди підставлявся ще й product.deliveryTime ("сьогодні"
  // тощо) — прибрано з тієї самої причини, що й у FAQ (lib/
  // productDetail.ts, resolveFaqItems): сторінка кешується, а
  // deliveryTime — термін ВІДВАНТАЖЕННЯ постачальником (не доставки
  // покупцю) і легко застаріває чи плутає. Лишається лише сам статус
  const displayName = buildSeoProductName(product);
  const stockPart = product.stock > 0 ? 'В наявності' : 'Під замовлення';
  // Главная группы бренд+артикул с более дешёвым предложением — "Ціна від X",
  // как в AggregateOffer (lowPrice) и в пометке "N пропозицій від X грн"
  const pricePart =
    product.groupMinPrice && product.groupMinPrice < product.retailPrice
      ? `Ціна від ${formatPriceUk(product.groupMinPrice)} грн`
      : `Ціна ${formatPriceUk(product.retailPrice)} грн`;
  return `${displayName}. ${pricePart}. ${stockPart}, доставка по Україні, оплата при отриманні.`;
}

// <title> сторінки товару. Пріоритет той самий, що й в описі вище:
//   1. override.title (data/seo-overrides.ts) — ПОВНИЙ рядок як є,
//      без додавання суфіксів
//   2. Автошаблон "{Назва деталі} — купити, ціна | DominatorParts",
//      і якщо це довше за ~65 символів (Google все одно обрізає
//      довший заголовок у сніппеті) — скорочуємо СХОДИНКАМИ, а не
//      одразу ріжемо назву товару:
//        а) прибираємо " | DominatorParts" (сайт і так впізнають з
//           favicon/домену в сніпеті — найменш цінна частина)
//        б) якщо й далі задовго — прибираємо ", ціна" (сама ціна вже
//           окремо видно в сніпеті через Product/Offer JSON-LD)
//        в) і лише як останній засіб — обрізаємо саму назву товару по
//           межі слова (з захистом від висячих прийменників, див.
//           truncateAtWordBoundary нижче), " — купити" лишається
//           завжди: це мінімальний заклик до дії, без нього заголовок
//           перетворюється просто на назву деталі
const META_TITLE_MAX_LENGTH = 65;
const META_TITLE_SUFFIX_FULL = ' — купити, ціна | DominatorParts';
const META_TITLE_SUFFIX_MID = ' — купити, ціна';
const META_TITLE_SUFFIX_MIN = ' — купити';

// Прийменники/сполучники, якими НЕ можна закінчувати обрізаний
// заголовок — інакше після обрізки по межі слова лишається висячий
// прийменник ("Амортизатор Sachs ARTSEO2 для — купити..." замість
// "...для Toyota Corolla — купити...", справжній баг, знайдений на
// товарі ARTSEO2: buildSeoProductName додає "для {марка модель}", і
// якщо саме на цьому місці проходить межа 65 символів, обрізка по
// останньому пробілу лишає "для" самим останнім словом)
const DANGLING_TRAILING_WORD_RE = /\s+(для|і|та|з|із|на|до|від|по|як|що|в|у|або)$/i;

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  // lastSpace > 20 — не обрізати зовсім коротко, якщо пробіл трапився
  // на самому початку (напр. в одного довгого слова без пробілів)
  let result = (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim();
  // Прибираємо висячий прийменник/сполучник в самому кінці (може
  // лишитись і ПІСЛЯ обрізки по пробілу вище) — цикл на випадок двох
  // коротких слів підряд, хоч на практиці досить одного проходу
  let withoutDangling = result.replace(DANGLING_TRAILING_WORD_RE, '');
  while (withoutDangling !== result && withoutDangling.trim()) {
    result = withoutDangling;
    withoutDangling = result.replace(DANGLING_TRAILING_WORD_RE, '');
  }
  return result;
}

export function buildSeoMetaTitle(product: {
  name: string | null;
  brand: string | null;
  article: string;
  carMake?: string | null;
  carModel?: string | null;
  fallbackName?: string | null;
}): string {
  const override = getSeoOverride(product.article);
  if (override?.title) return override.title;

  const parts = buildSeoNameParts(product);
  const suffixes = [META_TITLE_SUFFIX_FULL, META_TITLE_SUFFIX_MID, META_TITLE_SUFFIX_MIN];

  // Ручний override.h1 — готовий рядок без частин: старий спосіб (усі
  // суфікси, далі обрізка всього рядка по межі слова)
  if (parts.fixedH1 !== null) {
    for (const suffix of suffixes) {
      if ((parts.fixedH1 + suffix).length <= META_TITLE_MAX_LENGTH) return parts.fixedH1 + suffix;
    }
    return `${truncateAtWordBoundary(parts.fixedH1, META_TITLE_MAX_LENGTH - META_TITLE_SUFFIX_MIN.length)}${META_TITLE_SUFFIX_MIN}`;
  }

  // Бренд і артикул НІКОЛИ не обрізаються. Що скорочується (у порядку):
  // суфікс (" | DominatorParts", ", ціна") -> "для Марка Модель" -> САМА
  // назва (по одному слову з кінця, без висячих прийменників). Назва
  // скорочується останньою — тому спершу перебираємо довжину назви
  const words = parts.name.split(/\s+/).filter(Boolean);
  for (let count = words.length; count >= 0; count--) {
    let name = words.slice(0, count).join(' ').replace(/[\s,;:\-–—(/]+$/, '');
    while (DANGLING_TRAILING_WORD_RE.test(name) && name.replace(DANGLING_TRAILING_WORD_RE, '').trim()) {
      name = name.replace(DANGLING_TRAILING_WORD_RE, '');
    }
    for (const includeTail of [true, false]) {
      if (includeTail && !parts.tail) continue;
      const core = assembleSeoName(parts, name, includeTail);
      for (const suffix of suffixes) {
        if ((core + suffix).length <= META_TITLE_MAX_LENGTH) return core + suffix;
      }
    }
  }

  // Навіть "бренд + артикул + ' — купити'" довші за ліміт — усе одно не
  // обрізаємо їх
  return assembleSeoName(parts, '', false) + META_TITLE_SUFFIX_MIN;
}

// Готові FAQ-питання/відповіді для показу на сторінці ТА для FAQPage
// JSON-LD (обидва мають збігатися — buildFaqJsonLd викликається з
// ТИМ САМИМ результатом, що й рендериться, у
// components/ProductDetailContent.tsx). undefined — якщо в товару
// взагалі немає FAQ в оверрайді (секція тоді не рендериться)
//
// РАНІШЕ тут була підстановка токена "{{доставка}}" на РЕАЛЬНИЙ термін
// (product.stock/deliveryTime, напр. "сьогодні") — прибрано: текст
// FAQ має лишатись правильним довго (сторінка кешується, а
// product.deliveryTime — це термін відвантаження ПОСТАЧАЛЬНИКОМ, а не
// доставки покупцю, і легко застаріває чи плутає). Тепер FAQ-відповіді
// в data/seo-overrides.ts — завжди звичайний готовий текст, без токенів
export function resolveFaqItems(
  overrideFaq: SeoOverrideFaqItem[] | undefined
): SeoOverrideFaqItem[] | undefined {
  if (!overrideFaq || overrideFaq.length === 0) return undefined;
  return overrideFaq.map((item) => ({
    question: item.question,
    answer: item.answer,
    link: item.link,
  }));
}

export interface ProductDetail {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  imageUrl: string | null;
  metaDescription: string | null;
  // true — адмін вручну переписав meta_description на екрані "Товари"
  // (app/api/products/[id]/route.ts). Автоматичний опис, зібраний при
  // завантаженні прайсу (lib/priceListImport.ts, buildSeoFields), у
  // такому разі більше НЕ підставляється при наступних завантаженнях —
  // і так само на сторінці товару має пріоритет саме ручний варіант,
  // а не автоматично згенерований шаблон (buildSeoProductDescription)
  metaDescriptionOverride: boolean;
  carMake: string | null;
  // Модель авто (напр. "Camry" при carMake "Toyota") — заповнюється з
  // Excel-прайса постачальника так само, як carMake (див.
  // app/api/suppliers/parse-excel/route.ts). Використовується лише
  // для доповнення meta description реальними даними з бази — САМІ
  // МОДЕЛІ ТУТ НІКОЛИ НЕ ВИГАДУЮТЬСЯ, лише те, що реально є в товару
  carModel: string | null;
  // Назва цього ж артикула з іншого прайсу (див. loadFallbackName) —
  // ЛИШЕ якщо власна назва порожня/сміттєва, інакше null
  fallbackName: string | null;
  deliveryTime: string | null;
  updatedAt: string;
  // Группы бренд+артикул (lib/productGroups.ts):
  // canonicalPath — адрес для <link rel="canonical"> и JSON-LD: свой адрес
  //   (слаг из СОБСТВЕННОГО названия, как в sitemap) или, у двойника, адрес
  //   главной страницы группы;
  // alsoKnownAs — другие названия этой детали у поставщиков (до 5), строка
  //   "Також відомий як" под H1 главной;
  // hasGroupOffers — главная страница группы с 2+ предложениями (AggregateOffer)
  canonicalPath: string;
  alsoKnownAs: string[];
  hasGroupOffers: boolean;
  // Самая низкая цена в группе (без персональных цен) — "Ціна від X грн" в описании
  groupMinPrice: number | null;
  // Восстановленная / б/у деталь — бейдж "Відновлена" (products.is_refurbished)
  isRefurbished: boolean;
  // Деталь лежит на НАШЕМ складе (lib/ownStock.ts) — бейдж
  // "На нашому складі · відправка сьогодні". Необязательное: заполняется
  // только в loadProductPageData
  ownStock?: boolean;
}

// Одне ДОДАТКОВЕ фото галереї товару (не плутати з product.imageUrl —
// це головне фото, воно і далі лежить окремо в products.image_url,
// див. schema.sql, таблиця product_images)
export interface ProductImage {
  id: string;
  url: string;
  // Короткий підпис "що на фото" (напр. "упаковка", "маркування") —
  // з нього і бренду/артикула товару збирається унікальний alt для
  // цього конкретного фото (див. components/ProductGallery.tsx)
  label: string | null;
}

// Той самий товар, знайдений в іншого постачальника (буквально той
// самий бренд + артикул) — саме тому, що article/brand+article НЕ
// унікальні (див. коментар в lib/slug.ts), у покупця цілком може бути
// вибір з кількох пропозицій на ту саму деталь
export interface OtherOffer {
  id: string;
  retailPrice: number;
  stock: number;
  isRefurbished: boolean;
  // Срок отгрузки поставщиком этого предложения (suppliers.delivery_time),
  // показывается в раскрытой строке, если товара нет в наличии
  deliveryTime: string | null;
}

export interface CrossRefItem {
  brand: string;
  partNumber: string;
  productId: string | null;
  retailPrice: number | null;
  stock: number | null;
}

// costPrice тут — "гола" ціна постачальника (products.cost_price),
// потрібна ЛИШЕ щоб порахувати персональну ціну покупця (див.
// lib/customerPricing.ts) в loadProductPageData нижче. У ПУБЛІЧНИЙ
// ProductDetail (те, що реально йде в JSX/пропси сторінки) вона НЕ
// потрапляє — щоб оптова собівартість випадково не опинилась у HTML,
// відданому браузеру покупця
// costPrice и supplierName — ТОЛЬКО для расчётов на сервере: в данные
// страницы (и значит в HTML/RSC-ответ покупателю) они не попадают
type ProductDetailRaw = ProductDetail & { costPrice: number; supplierName: string };

// Найчастіша придатна назва (КРОК 1 >= 3 символів) того самого артикула
// в інших активних товарах, де бренд — той самий або з затвердженої
// "родини" (lib/brandFamilies.ts). Повертає СИРЕ products.name (його
// далі проганяє buildSeoProductName через КРОК 1 і 2)
async function loadFallbackName(id: string, article: string, brand: string | null): Promise<string | null> {
  const result = await pool.query(
    `SELECT name, brand FROM products WHERE article = $1 AND id <> $2 AND is_active = true AND name IS NOT NULL`,
    [article, id]
  );
  const counts = new Map<string, { raw: string; n: number }>();
  for (const row of result.rows) {
    if (!brandsAreSameFamily(brand, row.brand)) continue;
    const clean = buildCleanProductName(row.name);
    if (!clean || clean.length < 3) continue;
    const entry = counts.get(clean);
    if (entry) entry.n += 1;
    else counts.set(clean, { raw: row.name, n: 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n || b.raw.length - a.raw.length)[0];
  return best ? best.raw : null;
}

export const loadProduct = cache(async function loadProduct(id: string): Promise<ProductDetailRaw | null> {
  // Свіжий корпус українських слів для страховки H1 (раз на годину, з БД)
  await ensureUkrainianCorpusFresh(pool);
  const result = await pool.query(
    `
    SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.stock, p.image_url, p.is_refurbished,
           p.meta_description, p.meta_description_override, p.car_make, p.car_model, p.updated_at,
           s.name AS supplier_name, s.delivery_time,
           p.is_group_primary, p.group_offer_count, p.group_display_name, p.group_other_names, p.group_min_price,
           gp.id AS primary_id, gp.brand AS primary_brand, gp.article AS primary_article, gp.name AS primary_name
    FROM products p
    JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN products gp ON gp.id = p.group_primary_id AND gp.id <> p.id AND gp.is_active = true
    WHERE p.id = $1 AND p.is_active = true
    `,
    [id]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0];

  // Назва з іншого прайсу того ж артикула — ЛИШЕ для товарів без
  // власної придатної назви (~0.7% каталогу), для решти зайвого запиту
  // немає
  let fallbackName: string | null = null;
  if ((buildCleanProductName(row.name)?.length ?? 0) < 3) {
    fallbackName = await loadFallbackName(row.id, row.article, row.brand);
  }

  // Главная страница группы: H1/title — по самому подробному названию группы
  // ("Сальник штока муфты подключения переднего моста" вместо "Сальник
  // коробки передач"), но canonical — по собственному названию (как в sitemap)
  const groupPrimary = PRODUCT_GROUPS_ACTIVE && row.is_group_primary && row.group_offer_count > 1;
  const seoName: string | null = groupPrimary && row.group_display_name ? row.group_display_name : row.name;
  const canonicalPath =
    PRODUCT_GROUPS_ACTIVE && row.primary_id
      ? buildProductPath(row.primary_id, { brand: row.primary_brand, article: row.primary_article, name: row.primary_name })
      : buildProductPath(row.id, { brand: row.brand, article: row.article, name: row.name });

  return {
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: seoName,
    canonicalPath,
    alsoKnownAs: groupPrimary ? (row.group_other_names ?? []) : [],
    hasGroupOffers: groupPrimary,
    groupMinPrice: groupPrimary && row.group_min_price !== null ? parseFloat(row.group_min_price) : null,
    fallbackName,
    costPrice: parseFloat(row.cost_price),
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    imageUrl: publicImageUrl(row.image_url),
    metaDescription: row.meta_description,
    metaDescriptionOverride: Boolean(row.meta_description_override),
    carMake: row.car_make,
    carModel: row.car_model,
    supplierName: row.supplier_name,
    deliveryTime: row.delivery_time,
    updatedAt: row.updated_at,
    isRefurbished: row.is_refurbished,
  };
});

// Додаткові фото галереї товару (products.image_url — головне фото —
// сюди НЕ входить, воно і так завжди є в product.imageUrl)
const loadProductImages = cache(async function loadProductImages(productId: string): Promise<ProductImage[]> {
  const result = await pool.query(
    `SELECT id, image_url, label FROM product_images WHERE product_id = $1 ORDER BY sort_order, created_at`,
    [productId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    url: publicImageUrl(row.image_url) as string,
    label: row.label,
  }));
});

// supplierName — только внутреннее поле: имя поставщика покупателю не показываем
type OtherOfferRaw = OtherOffer & { costPrice: number; supplierName: string };

const loadOtherOffers = cache(async function loadOtherOffers(
  product: ProductDetail
): Promise<OtherOfferRaw[]> {
  const result = await pool.query(
    `
    SELECT p2.id, p2.cost_price, p2.retail_price, p2.stock, p2.is_refurbished, s2.name AS supplier_name, s2.delivery_time
    FROM products p2
    JOIN suppliers s2 ON s2.id = p2.supplier_id
    WHERE p2.article = $1
      AND ($2::text IS NULL OR p2.brand ILIKE $2)
      AND p2.id <> $3
      AND p2.is_active = true
    ORDER BY (p2.stock > 0) DESC, p2.retail_price ASC
    LIMIT 10
    `,
    [product.article, product.brand, product.id]
  );

  return result.rows.map((row) => ({
    id: row.id,
    costPrice: parseFloat(row.cost_price),
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    isRefurbished: row.is_refurbished,
    supplierName: row.supplier_name,
    deliveryTime: row.delivery_time,
  }));
});

// Посилання на "парну деталь" (напр. лівий/правий варіант тієї самої
// запчастини) — з SEO-оверрайду товару (data/seo-overrides.ts,
// override.pairPart.article). Перевіряємо, чи такий артикул РЕАЛЬНО є
// в каталозі: якщо є — покажемо клікабельне посилання, якщо ні —
// просто текст без посилання (нічого не вигадуємо). Викликається
// ЛИШЕ коли override.pairPart заданий — для решти товарів цей запит
// взагалі не виконується
const loadPairPartPath = cache(async function loadPairPartPath(article: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT id, brand, name, article FROM products WHERE article = $1 AND is_active = true ORDER BY (stock > 0) DESC, retail_price ASC LIMIT 1`,
    [article]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return buildProductPath(row.id, { brand: row.brand, name: row.name, article: row.article });
});

// OEM/кросс-номери — та сама модель "груп взаємозамінності", що і в
// app/api/products/cross-lookup/route.ts (звідти й скопійована логіка
// вибірки, тут вона лише читає дані, без створення нових зв'язків)
type CrossRefItemRaw = CrossRefItem & { costPrice: number | null };

const loadCrossReferences = cache(async function loadCrossReferences(
  product: ProductDetail
): Promise<{ oem: CrossRefItemRaw[]; aftermarket: CrossRefItemRaw[] }> {
  if (!product.brand) return { oem: [], aftermarket: [] };

  const groupsResult = await pool.query(
    `SELECT DISTINCT group_id FROM cross_reference_members WHERE part_number = $1 AND brand ILIKE $2`,
    [product.article, product.brand]
  );
  const groupIds = groupsResult.rows.map((row) => row.group_id as string);
  if (groupIds.length === 0) return { oem: [], aftermarket: [] };

  const membersResult = await pool.query(
    `
    SELECT m.brand, m.part_number, m.part_type, p3.id AS matched_product_id, p3.cost_price, p3.retail_price, p3.stock
    FROM cross_reference_members m
    LEFT JOIN products p3 ON p3.id = m.product_id AND p3.is_active = true
    WHERE m.group_id = ANY($1::uuid[])
      AND NOT (m.part_number = $2 AND m.brand ILIKE $3)
    ORDER BY m.part_type, m.brand
    `,
    [groupIds, product.article, product.brand]
  );

  const oem: CrossRefItemRaw[] = [];
  const aftermarket: CrossRefItemRaw[] = [];
  const seen = new Set<string>();

  for (const row of membersResult.rows) {
    const key = `${row.brand}::${row.part_number}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const item: CrossRefItemRaw = {
      brand: row.brand,
      partNumber: row.part_number,
      productId: row.matched_product_id,
      costPrice: row.cost_price !== null ? parseFloat(row.cost_price) : null,
      retailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
      stock: row.stock,
    };

    if (row.part_type === 'oem') oem.push(item);
    else aftermarket.push(item);
  }

  return { oem, aftermarket };
});

// Аналог/OEM-номер з таблиці part_crosses — кроси з прайсів наших
// постачальників і довідника TRW (scripts/crosses/schema.sql). НЕ те саме,
// що CrossRefItem вище (cross_reference_members — курована адміном модель)
export interface PartCrossItem {
  brand: string;
  article: string;
  // Якщо ця пара бренд+артикул реально є в наявності серед НАШИХ
  // товарів — посилання на її картку (+ ціна/наявність цього
  // конкретного товару); якщо ні — обидва null, і рядок показується
  // просто текстом (саме це і дає SEO-текст під запити на кшталт
  // "OEM 0986424815 купити", навіть якщо такого товару прямо зараз
  // немає в каталозі)
  productPath: string | null;
  retailPrice: number | null;
  stock: number | null;
}

// Застосовність до авто — из своих данных (product_vehicles_own,
// loadOwnCompatibility ниже): годы и двигатель пустые. Названия типа и
// полей исторические. makeSlug —
// null, якщо для цієї марки немає власної сторінки /marky/[slug]
// (курований список, lib/carMakes.ts) — тоді рядок теж просто текст,
// без посилання в нікуди
export interface VehicleCompatibilityItem {
  make: string;
  // Сире значення марки (напр. "VW", а не
  // курована "Volkswagen" з make вище) — потрібне окремо, бо саме в
  // такому написанні марка збережена в CategoryDef.catalogVehicle.make
  // (lib/categories.ts) і саме його звіряє findAnyNarrowPageForVehicle
  // при пошуку посадкової сторінки моделі для бейджа застосовності
  makeRaw: string;
  makeSlug: string | null;
  // Модель або поколение ("Camry XV30") зі своєї применимости; порожній
  // рядок — модель невідома, показується лише марка
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
  // Об'єм двигуна; у своїй применимости його немає — порожній рядок
  engine: string;
  // null — застосовність визначена для САМЕ ЦЬОГО бренду/артикула (своя
  // застосовність зараз завжди дає null). Текст (напр. "за крос-номером
  // OPTIMAL 12192") — застосовність визначена НЕ напряму, а через
  // крос-номер іншого бренду. Для гальмівних колодок (та інших деталей
  // безпеки) це ЗАВЖДИ повинно бути видно покупцю прямо на сторінці, а
  // не подаватись як офіційний каталог виробника
  sourceNote: string | null;
  // Хаб моделі (/marky/{марка}/{модель}, lib/modelHubs.ts), якщо це
  // покоління входить у видимий хаб — бейдж веде туди, а не на сторінку марки
  hubPath: string | null;
  // Марка известна только по бренду самого товара (source = brand, без
  // модели) — это оригинальная запчасть этой марки, бейдж
  // "Оригінальна запчастина {марка}", а не "підходить для"
  originalBrand?: boolean;
  // Живая узкая страница "деталь + модель" для этой машины (не тонкая, без 301)
  narrowPath?: string | null;
}

const PART_CROSSES_LIMIT = 30;
const VEHICLE_COMPATIBILITY_LIMIT = 20;

// article — уже ОЧИЩЕНИЙ (products.article в базі і так зберігається
// очищеним, повторно чистити не треба — див. коментар біля products
// у schema.sql). part_crosses.article_a заповнений тією ж функцією
// cleanArticle() під час імпорту (scripts/crosses/cleanArticle.ts),
// тому пряме порівняння текстом коректне
type PartCrossItemRaw = PartCrossItem & { costPrice: number | null };

// brand — бренд самого товара: строки кроссов берутся только того же
// производителя или длинные номера без бренда (lib/crossBrandMatch.ts),
// иначе совпадение одного артикула у разных брендов давало чужие аналоги.
// is_valid = false — строки, помеченные как ложные или из исключённого
// источника (invalid_reason, scripts/crosses/schema.sql)
const loadPartCrosses = cache(async function loadPartCrosses(
  article: string,
  brand: string | null
): Promise<PartCrossItemRaw[]> {
  if (!brand) return [];

  const result = await pool.query(
    `
    SELECT
      tc.brand_b,
      tc.article_b,
      p.id AS product_id,
      p.brand AS product_brand,
      p.article AS product_article,
      p.name AS product_name,
      p.cost_price,
      p.retail_price,
      p.stock
    FROM (
      SELECT DISTINCT brand_b, article_b
      FROM part_crosses
      -- LENGTH(article_b) >= 3 — відсікає сміттєві "номери" з дампа
      -- на кшталт голого "0" чи "12" (53 420 таких рядків з довжиною
      -- 1 у всій таблиці на момент імпорту) — жоден справжній
      -- OEM/крос-номер настільки коротким не буває
      WHERE article_a = $1 AND article_b <> $1 AND LENGTH(article_b) >= 3
        AND is_valid AND ${crossSideMatchesSql('brand_a', 'article_a', '$2::text')}
    ) tc
    LEFT JOIN LATERAL (
      SELECT id, brand, article, name, cost_price, retail_price, stock
      FROM products p2
      WHERE p2.article = tc.article_b AND UPPER(p2.brand) = UPPER(tc.brand_b) AND p2.is_active = true
      ORDER BY (p2.stock > 0) DESC, p2.retail_price ASC
      LIMIT 1
    ) p ON true
    -- Спершу ті, що реально є в нашому каталозі (клікабельні,
    -- корисніші покупцю) — потім решта, просто текстом
    ORDER BY (p.id IS NOT NULL) DESC, tc.brand_b, tc.article_b
    LIMIT ${PART_CROSSES_LIMIT}
    `,
    [article, brand]
  );

  return result.rows.map((row) => ({
    brand: row.brand_b,
    article: row.article_b,
    productPath:
      row.product_id !== null
        ? buildProductPath(row.product_id, {
            brand: row.product_brand,
            article: row.product_article,
            name: row.product_name,
          })
        : null,
    costPrice: row.cost_price !== null ? parseFloat(row.cost_price) : null,
    retailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
    stock: row.stock,
  }));
});

// Своя применимость (product_vehicles_own, lib/ownVehicles.ts) в том же
// виде, что и VehicleCompatibilityItem выше — блок "Запчастина підходить для авто"
// рисуется тем же бейджем. Годов и двигателей в своих данных нет — поля
// пустые, бейдж их просто не показывает. Берутся строки всех предложений
// этой детали (бренд + артикул): у одного поставщика модель есть в
// названии, у другого — нет. Модель с известным поколением ведёт на хаб
const loadOwnCompatibility = cache(async function loadOwnCompatibility(
  brand: string | null,
  article: string
): Promise<VehicleCompatibilityItem[]> {
  const result = await pool.query(
    `SELECT pvo.make, pvo.model, CASE WHEN pvo.generation = '${OTHER_GENERATION}' OR pvo.generation LIKE 'maybe:%' THEN NULL ELSE pvo.generation END AS generation, bool_and(pvo.source = 'brand') AS only_brand
       FROM product_vehicles_own pvo
       JOIN products p ON p.id = pvo.product_id AND p.is_active
      WHERE p.article = $1 AND UPPER(COALESCE(p.brand, '')) = UPPER(COALESCE($2, ''))
      GROUP BY 1, 2, 3`,
    [article, brand]
  );

  const [visibleHubs, thin] = await Promise.all([loadVisibleHubs(), loadThinNarrowCategories()]);
  const withModel = new Set(result.rows.filter((r) => r.model).map((r) => r.make as string));
  const seen = new Set<string>();
  const items: VehicleCompatibilityItem[] = [];
  // Сначала — с поколением, потом — с моделью, потом — только марка
  const rows = [...result.rows].sort((a, b) => Number(Boolean(b.generation)) - Number(Boolean(a.generation)) || Number(Boolean(b.model)) - Number(Boolean(a.model)));
  for (const row of rows) {
    // Голая марка не нужна, если у этой марки уже есть строка с моделью
    if (!row.model && withModel.has(row.make)) continue;
    const curated = CAR_MAKES.find((m) => m.slug === row.make);
    const makeName = curated?.name ?? (row.make as string).replace(/(^|[-\s])\p{L}/gu, (c: string) => c.toUpperCase());
    const hub = row.generation ? MODEL_HUBS.find((h) => h.makeSlug === row.make && h.slug === row.generation) : undefined;
    const hubVisible = Boolean(hub && visibleHubs.includes(hub));
    // "Mazda 6" у марки Mazda -> "6"; у поколения — подпись хаба ("Camry XV30")
    let model = hub ? hub.label : generationLabel(row.generation) ?? (row.model as string | null) ?? '';
    if (model.toLowerCase().startsWith(`${makeName.toLowerCase()} `)) model = model.slice(makeName.length + 1);
    const key = `${row.make}|${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      make: makeName,
      makeRaw: curated?.dbValues[0] ?? (row.make as string).toUpperCase(),
      makeSlug: curated?.slug ?? null,
      model,
      yearFrom: null,
      yearTo: null,
      engine: '',
      sourceNote: null,
      hubPath: hub && hubVisible ? hubPath(hub) : null,
      narrowPath: (() => {
        const narrow = findNarrowCategoryForOwnVehicle(row.make, row.model, row.generation, thin);
        return narrow ? `/category/${narrow.slug}` : null;
      })(),
      originalBrand: !row.model && Boolean(row.only_brand),
    });
  }
  // Спершу марки з власною сторінкою /marky/[slug] (клікабельні)
  items.sort((a, b) => Number(b.makeSlug !== null) - Number(a.makeSlug !== null));
  return items.slice(0, VEHICLE_COMPATIBILITY_LIMIT);
});

export interface ProductPageData {
  product: ProductDetail;
  images: ProductImage[];
  otherOffers: OtherOffer[];
  crossRefs: { oem: CrossRefItem[]; aftermarket: CrossRefItem[] };
  partCrosses: PartCrossItem[];
  vehicleCompatibility: VehicleCompatibilityItem[];
  breadcrumbItems: BreadcrumbItem[];
  // Ручний SEO-оверрайд товару (data/seo-overrides.ts) — undefined,
  // якщо для артикула запису немає (переважна більшість товарів).
  // h1/title/description із нього вже враховані вище (buildSeoProductName/
  // buildSeoProductDescription/buildSeoMetaTitle) — тут прокидається
  // ЦІЛИМ, щоб ProductDetailContent.tsx міг вивести решту секцій
  // (longDescription/specs/applicability/faq)
  seoOverride: SeoOverride | undefined;
  // Посилання на "парну деталь" з override.pairPart, якщо вона реально
  // є в каталозі (loadPairPartPath) — null, якщо оверрайду/пари немає
  // або товару з таким артикулом у базі не знайшлось
  pairPartPath: string | null;
  // Назва товару в каталозі постачальника — КРОК 1 (без префікса, КАПСУ і
  // службового тексту), але ДО перекладу. Показується рядком у блоці
  // "Характеристики" ЛИШЕ якщо відрізняється від підсумкової (перекладеної)
  // назви — так російський оригінал лишається на сторінці для пошуку.
  // У JSON-LD навмисно НЕ потрапляє
  supplierCatalogName: string | null;
  // Широка категорія деталі (крихти, іконка заглушки без фото, "Схожі
  // товари") — null, якщо тип деталі не розпізнано
  category: { slug: string; name: string } | null;
  similarProducts: SimilarProduct[];
}

// Товар у блоці "Схожі товари" (ціна вже персональна, без costPrice)
export interface SimilarProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  stock: number;
  retailPrice: number;
}

// Повний набір даних для рендеру товару — і на повній сторінці, і в
// модальному вікні. Викликає notFound()/permanentRedirect() сама
// (це нормально для Next.js — обидві функції можна кликати з будь-якої
// async-функції, яку рендер-компонент дожидає через await, не лише
// прямо з тіла компонента сторінки)
export async function loadProductPageData(
  id: string,
  slugParts: string[] | undefined
): Promise<ProductPageData> {
  if (!UUID_PATTERN.test(id)) notFound();

  const product = await loadProduct(id);
  if (!product) notFound();

  // Канонічний слаг перевіряється і тут (не лише в generateMetadata) —
  // якщо адреса в браузері не збігається з ним, назавжди редиректимо
  // на правильну. Саме так у Google лишається ОДНА адреса на товар,
  // навіть якщо назву/бренд товару колись зміняли
  const canonicalSlug = buildProductSlug(product);
  const currentSlug = (slugParts || []).join('/');
  if (currentSlug !== canonicalSlug) {
    permanentRedirect(buildProductPath(id, product));
  }

  const seoOverride = getSeoOverride(product.article);

  const [images, rawOtherOffers, rawCrossRefs, rawPartCrosses, vehicleCompatibility, pairPartPath] =
    await Promise.all([
      loadProductImages(id),
      loadOtherOffers(product),
      loadCrossReferences(product),
      loadPartCrosses(product.article, product.brand),
      // Блок "Запчастина підходить для авто" — из своих данных
      loadOwnCompatibility(product.brand, product.article),
      // Запит на пару виконуємо ЛИШЕ якщо оверрайд її взагалі задає —
      // для решти товарів (без seoOverride.pairPart) зайвий SQL-запит
      // на кожен показ сторінки не потрібен
      seoOverride?.pairPart ? loadPairPartPath(seoOverride.pairPart.article) : Promise.resolve(null),
    ]);

  // Персональна ціна покупця (customer_pricing_rules) — застосовується
  // ТУТ, ОКРЕМИМ фінальним кроком поверх уже завантажених "сирих" даних
  // (а не всередині loadProduct/loadOtherOffers/... вище), щоб самі ці
  // cache()-функції й надалі повертали справжню базову ціну — вона
  // потрібна незміненою в інших місцях (напр. generateMetadata окремо
  // викликає loadProduct без будь-якої персоналізації). cookies() (всередині getCustomerSessionPhone) тут
  // також гарантує, що Next.js не роздасть цю сторінку зі статичного
  // кешу одному покупцю з ціною іншого.
  //
  // computeCustomerPrice рахує від costPrice ("голої" ціни постачальника),
  // а НЕ від retailPrice — інакше для покупця з персональним правилом
  // накрутилась би ще й звичайна націнка магазину поверх його власної.
  // costPrice є лише в *Raw-об'єктах нижче (loadProduct/loadOtherOffers/...
  // повертають розширені типи з costPrice) — у фінальні об'єкти, які
  // йдуть у JSX, costPrice свідомо НЕ включається (перелік полів
  // явний, без spread), щоб оптова собівартість не потрапила в HTML,
  // відданий браузеру покупця
  const customerPricingRule = await getCustomerPricingRule(pool, await getCustomerSessionPhone());
  // Есть ли эта деталь (бренд + артикул) на НАШЕМ складе
  const ownStock = await isOwnStock(pool, product.article, product.brand);

  const personalizedProduct: ProductDetail = {
    id: product.id,
    article: product.article,
    brand: product.brand,
    name: product.name,
    fallbackName: product.fallbackName,
    retailPrice: computeCustomerPrice(product.costPrice, product.retailPrice, customerPricingRule),
    stock: product.stock,
    imageUrl: product.imageUrl,
    metaDescription: product.metaDescription,
    metaDescriptionOverride: product.metaDescriptionOverride,
    carMake: product.carMake,
    carModel: product.carModel,
    deliveryTime: product.deliveryTime,
    updatedAt: product.updatedAt,
    canonicalPath: product.canonicalPath,
    alsoKnownAs: product.alsoKnownAs,
    hasGroupOffers: product.hasGroupOffers,
    groupMinPrice: product.groupMinPrice,
    isRefurbished: product.isRefurbished,
    ownStock,
  };
  const otherOffers: OtherOffer[] = rawOtherOffers.map((offer) => ({
    id: offer.id,
    retailPrice: computeCustomerPrice(offer.costPrice, offer.retailPrice, customerPricingRule),
    stock: offer.stock,
    isRefurbished: offer.isRefurbished,
    deliveryTime: offer.deliveryTime,
  }));
  const toPublicCrossRef = (item: CrossRefItemRaw): CrossRefItem => ({
    brand: item.brand,
    partNumber: item.partNumber,
    productId: item.productId,
    retailPrice:
      item.retailPrice !== null && item.costPrice !== null
        ? computeCustomerPrice(item.costPrice, item.retailPrice, customerPricingRule)
        : null,
    stock: item.stock,
  });
  const crossRefs = {
    oem: rawCrossRefs.oem.map(toPublicCrossRef),
    aftermarket: rawCrossRefs.aftermarket.map(toPublicCrossRef),
  };
  const partCrosses: PartCrossItem[] = rawPartCrosses.map((item) => ({
    brand: item.brand,
    article: item.article,
    productPath: item.productPath,
    retailPrice:
      item.retailPrice !== null && item.costPrice !== null
        ? computeCustomerPrice(item.costPrice, item.retailPrice, customerPricingRule)
        : null,
    stock: item.stock,
  }));

  // Категорія деталі ("Гальмівні колодки") — з таблиці product_categories,
  // тобто та сама, на сторінці якої товар реально лежить
  // (lib/productCategoryLookup.ts). Запасний варіант, якщо в таблиці
  // нічого немає (латинські літери всередині слова "Свiчка", назва лише з
  // іншого прайсу, товар щойно з'явився і ще не перерахований), — як
  // раніше, за словами в ОЧИЩЕНІЙ назві. Крихти (рішення власника):
  // Головна › Категорія › Бренд Артикул — без марки авто
  // Тонкая узкая категория (отдаёт 301, lib/narrowCategoryStatus.ts) —
  // в крошках и ссылках сразу её категория назначения
  const category = linkableCategory(
    (await loadBreadcrumbCategories(pool, [product.id])).get(product.id) ??
      detectCategoryForProductName(buildCleanProductName(product.name) ?? buildCleanProductName(product.fallbackName)),
    await loadThinNarrowCategories()
  );
  const breadcrumbItems: BreadcrumbItem[] = [
    { name: 'Головна', url: SITE_URL },
    ...(category ? [{ name: category.name, url: `${SITE_URL}/category/${category.slug}` }] : []),
    {
      name: `${product.brand ? product.brand + ' ' : ''}${product.article}`,
      url: `${SITE_URL}${buildProductPath(id, product)}`,
    },
  ];

  // Рядок показується, лише якщо назва КРОКУ 1 відрізняється від назви,
  // що потрапила в H1: коли H1 зібрано з перекладеної назви — порівнюємо
  // з нею; коли переклад відкотився і H1 = "Категорія Бренд Артикул" —
  // у H1 назви взагалі нема, тож рядок показуємо
  const stage1Name = buildCleanProductName(product.name);
  const nameInH1 = getSeoNameInH1(personalizedProduct);
  const supplierCatalogName =
    stage1Name && stage1Name.length >= 3 && stage1Name.toLowerCase() !== nameInH1.toLowerCase() ? stage1Name : null;

  const similarRaw = category ? await loadSimilarProducts(category.slug, product.id) : [];
  const similarProducts: SimilarProduct[] = similarRaw.map((item) => ({
    id: item.id,
    article: item.article,
    brand: item.brand,
    name: item.name,
    imageUrl: item.imageUrl,
    stock: item.stock,
    retailPrice: computeCustomerPrice(item.costPrice, item.retailPrice, customerPricingRule),
  }));

  return {
    product: personalizedProduct,
    images,
    otherOffers,
    crossRefs,
    partCrosses,
    vehicleCompatibility,
    breadcrumbItems,
    seoOverride,
    pairPartPath,
    supplierCatalogName,
    category: category ? { slug: category.slug, name: category.name } : null,
    similarProducts,
  };
}

// ------------------------------------------------------------
// "Схожі товари" — 8 товарів тієї ж категорії, лише в наявності, спершу
// з фото. Ті самі ключові слова категорії (matchGroups/excludeWords), що
// й сторінка категорії, але пошук по p.name_search (нижній регістр,
// pg_trgm GIN-індекс) — інакше ILIKE по p.name перечитував би весь
// каталог на КОЖНОМУ показі товару. Не більше одного товару з тим самим
// бренд+артикул (одна деталь у кількох постачальників)
// ------------------------------------------------------------
const loadSimilarProducts = cache(async function loadSimilarProducts(
  categorySlug: string,
  excludeId: string
): Promise<Array<SimilarProduct & { costPrice: number }>> {
  const category = getCategoryBySlug(categorySlug);
  if (!category) return [];
  const params: unknown[] = [excludeId];
  const conditions = ['p.is_active = true', 'p.stock > 0', 'p.id <> $1'];
  for (const group of category.matchGroups) {
    params.push(group.map((word) => `%${word.toLowerCase()}%`));
    conditions.push(`p.name_search ILIKE ANY($${params.length}::text[])`);
  }
  if (category.excludeWords?.length) {
    params.push(category.excludeWords.map((word) => `%${word.toLowerCase()}%`));
    conditions.push(`NOT (p.name_search ILIKE ANY($${params.length}::text[]))`);
  }
  // Беремо 60 кандидатів (спершу з фото) і прибираємо дублі бренд+артикул
  // у JS — DISTINCT ON у SQL змушував би сортувати ВСІ товари категорії
  const result = await pool.query(
    `
    SELECT p.id, p.article, p.brand, p.name, p.image_url, p.stock, p.cost_price, p.retail_price, p.group_primary_id
    FROM products p
    WHERE ${conditions.join(' AND ')}
    ORDER BY (p.image_url IS NOT NULL) DESC
    LIMIT 60
    `,
    params
  );
  const seen = new Set<string>();
  return result.rows
    .filter((row) => {
      const key = `${(row.brand ?? '').toUpperCase()}|${row.article}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      // Ссылка "схожого" — на главную страницу группы бренд+артикул (lib/productGroups.ts)
      id: PRODUCT_GROUPS_ACTIVE ? row.group_primary_id ?? row.id : row.id,
      article: row.article,
      brand: row.brand,
      name: row.name,
      imageUrl: publicImageUrl(row.image_url),
      stock: row.stock,
      costPrice: parseFloat(row.cost_price),
      retailPrice: parseFloat(row.retail_price),
    }))
    .filter((item) => item.id !== excludeId)
    .slice(0, 8);
});
