// ============================================================
// Оркестрація пошуку фото для ОДНОГО товару: спочатку пробуємо
// швидкий Варіант Б (пряме вгадування посилання, lib/directImageSources.ts),
// і тільки якщо він нічого не дав — Варіант А (пошук у Bing,
// lib/imageSearch.ts). Викликається пачками з черги
// (app/api/cron/fetch-product-images/route.ts), а не по одному товару
// на запит користувача — щоб покупець на сайті ніколи не чекав на
// пошук фото наживо
// ============================================================

import { Pool } from 'pg';
import { searchProductImages, randomDelay } from './imageSearch';
import { downloadAndValidateImage, convertToWebp } from './imageProcessing';
import { findDirectImageUrl } from './directImageSources';
import { saveImage } from './imageStorage';

// Той самий підхід до очищення артикула, що і скрізь у проєкті (див.
// app/api/suppliers/parse-excel/route.ts) — тут не використовується
// напряму (артикул уже очищений у базі), але лишаємо тип для
// наочності
export interface ProductToProcess {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
}

export type PipelineResult = 'found' | 'not_found' | 'error';

// Скільки кандидатів із видачі Bing пробуємо ЗАВАНТАЖИТИ перед тим,
// як здатись — перше фото в результатах не завжди підходить за
// розміром (буває іконка чи скріншот), тому пробуємо кілька наступних
// по черзі
const MAX_SEARCH_CANDIDATES_TO_TRY = 5;

// Скільки "сирих" кандидатів запитувати в Bing ЗА РАЗ — свідомо
// набагато більше за MAX_SEARCH_CANDIDATES_TO_TRY, бо більшість із них
// одразу відсіється фільтром за підписом (isRelevantCandidate нижче) —
// без цього запасу до реального завантаження майже нічого не
// доходило б, і товар помилково позначався б "фото не знайдено"
const RAW_CANDIDATES_TO_FETCH = 25;

// Порівнюємо текст без урахування регістру й розділювачів — той самий
// принцип, що і в очищенні артикула при імпорті прайсів (див.
// cleanArticle() в app/api/suppliers/parse-excel/route.ts): "GDB 1330",
// "gdb-1330" і "GDB1330" повинні вважатись одним і тим самим значенням
function normalizeForMatch(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9А-Я]/g, '');
}

// Головний захист від "фото не того товару": Bing повертає власний
// підпис (title) для кожного результату — це те, що САМ BING вважає
// зображеним на фото. Якщо в підписі немає навіть артикула товару —
// майже напевно це чужа деталь, лого бренду, фото упаковки конкурента
// чи випадкова ілюстративна картинка, а не саме ця запчастина.
// Раніше пайплайн узагалі не дивився на title і брав перший кандидат,
// що пройшов лише перевірку розміру — звідси й були помилкові фото
function isRelevantCandidate(candidate: { title: string }, article: string): boolean {
  const normalizedArticle = normalizeForMatch(article);
  if (!normalizedArticle) return false;
  return normalizeForMatch(candidate.title).includes(normalizedArticle);
}

export async function processProductImage(pool: Pool, product: ProductToProcess): Promise<PipelineResult> {
  const brand = product.brand?.trim() || '';
  // Кожен термін — в лапках: просимо в Bing ТОЧНЕ входження бренду і
  // ТОЧНЕ входження артикула окремо, а не смислово схожий запит —
  // це вже само по собі відсікає частину нерелевантної видачі
  const query = [brand, product.article]
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(' ');

  try {
    // ---- Варіант Б: пряме вгадування (дешево — лише HEAD-запити) ----
    const directUrl = await findDirectImageUrl({
      brand,
      cleanArticle: product.article,
      rawArticle: product.article,
    });

    if (directUrl) {
      const validated = await downloadAndValidateImage(directUrl);
      if (validated) {
        const webp = await convertToWebp(validated.buffer);
        const savedUrl = await saveImage(webp);
        await markProductImage(pool, product.id, savedUrl);
        return 'found';
      }
    }

    // ---- Варіант А: пошук у Bing ----
    // Запитуємо ЗНАЧНО ширший пул кандидатів (RAW_CANDIDATES_TO_FETCH),
    // потім лишаємо лише ті, чий підпис реально згадує артикул товару,
    // і вже з цього відфільтрованого списку пробуємо завантажити перші
    // MAX_SEARCH_CANDIDATES_TO_TRY — навмисно НЕ повертаємось до
    // невідфільтрованих кандидатів, якщо релевантних не знайшлось:
    // краще чесно позначити "фото не знайдено", ніж показати покупцю
    // фото чужої деталі
    const rawCandidates = await searchProductImages(query, { limit: RAW_CANDIDATES_TO_FETCH });
    const relevantCandidates = rawCandidates.filter((candidate) => isRelevantCandidate(candidate, product.article));

    for (const candidate of relevantCandidates.slice(0, MAX_SEARCH_CANDIDATES_TO_TRY)) {
      const validated = await downloadAndValidateImage(candidate.url);
      if (!validated) continue;

      const webp = await convertToWebp(validated.buffer);
      const savedUrl = await saveImage(webp);
      await markProductImage(pool, product.id, savedUrl);
      return 'found';
    }

    // Жоден кандидат не підійшов — позначаємо товар як "спробували",
    // щоб наступний запуск черги не шукав фото для нього знову й
    // знову (див. WHERE-умову вибірки в app/api/cron/fetch-product-images)
    await markAttempted(pool, product.id);
    return 'not_found';
  } catch (error) {
    console.error(`Помилка пошуку фото для товару ${product.id} (${query}):`, error);
    await markAttempted(pool, product.id);
    return 'error';
  }
}

async function markProductImage(pool: Pool, productId: string, imageUrl: string): Promise<void> {
  await pool.query(
    `UPDATE products SET image_url = $2, image_search_attempted_at = now() WHERE id = $1`,
    [productId, imageUrl]
  );
}

async function markAttempted(pool: Pool, productId: string): Promise<void> {
  await pool.query(`UPDATE products SET image_search_attempted_at = now() WHERE id = $1`, [productId]);
}

export interface ProcessBatchSummary {
  processed: number;
  found: number;
  notFound: number;
  errors: number;
}

// Обробляє пачку товарів ПОСЛІДОВНО (не паралельно!) з випадковою
// затримкою між ними — саме це і є "захист від блокування IP" з
// завдання: пачка з 5-10 запитів раз на кілька хвилин виглядає як
// звичайний трафік, а не як атака
export async function processBatch(
  pool: Pool,
  products: ProductToProcess[],
  delayRangeMs: [number, number] = [2000, 5000]
): Promise<ProcessBatchSummary> {
  const summary: ProcessBatchSummary = { processed: 0, found: 0, notFound: 0, errors: 0 };

  for (let i = 0; i < products.length; i++) {
    const result = await processProductImage(pool, products[i]);
    summary.processed++;
    if (result === 'found') summary.found++;
    else if (result === 'not_found') summary.notFound++;
    else summary.errors++;

    // Затримку не ставимо після ОСТАННЬОГО товару в пачці — сенсу
    // чекати вже нема, наступний запит буде тільки на наступному
    // тику cron
    if (i < products.length - 1) {
      await randomDelay(delayRangeMs[0], delayRangeMs[1]);
    }
  }

  return summary;
}
