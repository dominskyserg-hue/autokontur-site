// ============================================================
// Побудова "красивого" (але не авторитетного) слага для сторінки
// товару — /p/[id]/[[...slug]] (app/p/[id]/[[...slug]]/page.tsx).
//
// Джерело правди для пошуку товару — ЗАВЖДИ [id] (UUID), а не цей
// слаг: назви й бренди в products приходять з прайс-листів
// постачальників різними мовами (укр./рос./англ. впереміш) і НЕ
// гарантовано унікальні навіть у парі (brand, article) — перевірено
// прямим запитом до бойової бази:
//   7 709 різних article зустрічаються у 2+ товарів різних постачальників
//   4 745 різних пар (brand, article) — теж у 2+ товарів
// Тобто URL виду /product/[article] або /p/[brand]-[article]
// призвів би до реальних колізій на десятках тисяч товарів. Слаг тут
// існує ЛИШЕ заради ключових слів у видимій частині URL — сторінка
// однаково відкриється і без нього, і зі старим/невірним слагом
// (page.tsx сам редиректить на актуальний, canonical, варіант)
// ============================================================

// Транслітерація українських (і поширених російських) літер —
// назви товарів і бренди в прайсах постачальників трапляються
// обома мовами впереміш
const TRANSLIT_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie',
  ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
  ю: 'iu', я: 'ia', ъ: '',
  // Літери, яких немає в українському алфавіті, але трапляються в
  // назвах/брендах з російськомовних прайсів
  ё: 'e', ы: 'y', э: 'e',
};

function transliterate(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT_MAP[char] ?? char)
    .join('');
}

// Перетворює довільний текст на URL-безпечний слаг: транслітерація
// кирилиці, тільки латиниця/цифри/дефіс, без подвійних дефісів
export function slugify(text: string): string {
  return transliterate(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export interface SlugSource {
  brand: string | null;
  article: string;
  name: string | null;
}

const MAX_SLUG_LENGTH = 80;

// Слаг збирається з бренду + назви + артикула — саме в такому порядку
// ключові слова найкорисніші для пошуку ("bosch гальмівні колодки
// 0986424815"). Довжину обмежуємо: занадто довгий URL Google сам
// обрізає в сніпеті, а сенсу в цьому нема
export function buildProductSlug(product: SlugSource): string {
  const parts = [product.brand, product.name, product.article].filter(
    (part): part is string => Boolean(part && part.trim())
  );
  const raw = slugify(parts.join(' '));
  return raw.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '') || 'tovar';
}

// Відносне посилання на сторінку товару — використовується і зі
// сторінок категорій/марок (замість старого /?article=...), і в
// structuredData.ts (Product.url), і самою сторінкою товару (canonical)
export function buildProductPath(id: string, product: SlugSource): string {
  return `/p/${id}/${buildProductSlug(product)}`;
}
