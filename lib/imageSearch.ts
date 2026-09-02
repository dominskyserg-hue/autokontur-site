// ============================================================
// Пошук фото товару в інтернеті БЕЗ платних API (Google Custom
// Search API, SerpApi тощо) — розбір звичайної HTML-видачі
// Bing Images за текстовим запитом "бренд + артикул".
//
// Чому Bing, а не DuckDuckGo (як часто радять): перевірено наживо —
// у 2026 році внутрішній JSON-ендпоінт DuckDuckGo (i.js) віддає 403
// на будь-який запит без справжнього браузера (там тепер серйозний
// антибот-захист, який неможливо обійти простим fetch без Playwright).
// Bing Images віддає звичайну HTML-сторінку зі status 200 і без
// JavaScript — фото вже лежать прямо в розмітці у вигляді невеликого
// JSON-блоку на кожен результат, тому парсити можна регуляркою, без
// браузера й без жодного платного ключа.
//
// ВАЖЛИВО розуміти межі цього підходу: це розбір чужої HTML-сторінки,
// а не офіційний API — Bing може в будь-який момент змінити розмітку
// або посилити захист, і тоді парсер треба буде поправити. Це саме
// той компроміс, на який свідомо йдуть заради 0$ бюджету.
// ============================================================

// Невеликий пул реалістичних User-Agent — використовується разом із
// затримками між запитами (див. lib/productImagePipeline.ts), щоб
// автоматичні запити менше виділялись на тлі звичайних відвідувачів
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Проста затримка — використовується МІЖ запитами до Bing і між
// обробкою товарів у черзі (див. app/api/cron/fetch-product-images),
// щоб не бити по чужому серверу пачкою запитів одночасно
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Випадкова затримка в діапазоні — так інтервал між запитами не
// виглядає підозріло рівним (як у справжнього бота), а трохи
// "тремтить", як у людини
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return sleep(ms);
}

export interface ImageCandidate {
  // Пряме посилання на повнорозмірне фото (те, що показуємо покупцю)
  url: string;
  // Сторінка, де Bing знайшов це фото — лишаємо для діагностики
  // (наприклад, щоб вручну перевірити, чому підібралось невдале фото)
  sourcePageUrl: string;
  // Короткий підпис/назва зображення за версією Bing — використовуємо
  // лише для логів, на сайті покупцю не показуємо
  title: string;
}

// Bing віддає метадані кожного результату в атрибуті m="{...}" —
// значення HTML-екрановане (&quot; замість "), тому спочатку знімаємо
// екранування, а потім розбираємо як звичайний JSON
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Кожен результат пошуку зображень на сторінці Bing лежить у вигляді
// <a class="iusc" m="{&quot;murl&quot;:&quot;https://...&quot;, ...}">
// m — це JSON-об'єкт із повним посиланням (murl), сторінкою-джерелом
// (purl) і підписом (t). Тут ми просто витягуємо всі такі блоки
// регуляркою — повноцінний HTML-парсер тут зайвий, розмітка Bing для
// цього конкретного атрибута дуже стабільна
const RESULT_BLOCK_PATTERN = /m="(\{[^}]*&quot;murl&quot;[^}]*\})"/g;

function parseSearchResultsHtml(html: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];

  for (const match of html.matchAll(RESULT_BLOCK_PATTERN)) {
    const rawJson = decodeHtmlEntities(match[1]);
    try {
      const parsed = JSON.parse(rawJson) as { murl?: string; purl?: string; t?: string };
      if (parsed.murl && parsed.murl.startsWith('http')) {
        candidates.push({
          url: parsed.murl,
          sourcePageUrl: parsed.purl || '',
          title: parsed.t || '',
        });
      }
    } catch {
      // Одна битий блок не повинен ламати весь пошук — просто
      // пропускаємо його й ідемо далі
      continue;
    }
  }

  return candidates;
}

export interface SearchImagesOptions {
  // Скільки кандидатів повернути максимум (пайплайн все одно
  // перебирає їх по черзі, поки не знайде валідний — див.
  // lib/productImagePipeline.ts)
  limit?: number;
  timeoutMs?: number;
}

// Головна функція: шукає фото за текстовим запитом (зазвичай
// "БРЕНД АРТИКУЛ", напр. "Bosch 0986494316") і повертає список
// кандидатів у порядку релевантності за версією Bing
export async function searchProductImages(
  query: string,
  options: SearchImagesOptions = {}
): Promise<ImageCandidate[]> {
  const { limit = 8, timeoutMs = 10_000 } = options;

  const url = new URL('https://www.bing.com/images/search');
  url.searchParams.set('q', query);
  url.searchParams.set('form', 'HDRSC2');
  // qft=+filterui:imagesize-large — просимо в Bing одразу великі
  // зображення, це не гарантія (все одно перевіряємо реальний розмір
  // після завантаження), але відсіює частину дрібних іконок ще на
  // етапі видачі
  url.searchParams.set('qft', '+filterui:imagesize-large');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': randomUserAgent(),
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Bing повернув статус ${response.status}`);
    }

    const html = await response.text();
    return parseSearchResultsHtml(html).slice(0, limit);
  } finally {
    clearTimeout(timeout);
  }
}
