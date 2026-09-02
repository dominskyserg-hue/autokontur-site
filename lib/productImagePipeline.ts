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

// Скільки кандидатів із видачі Bing пробуємо перед тим, як здатись —
// перше фото в результатах не завжди підходить за розміром (буває
// іконка чи скріншот), тому пробуємо кілька наступних по черзі
const MAX_SEARCH_CANDIDATES_TO_TRY = 5;

export async function processProductImage(pool: Pool, product: ProductToProcess): Promise<PipelineResult> {
  const brand = product.brand?.trim() || '';
  const query = [brand, product.article].filter(Boolean).join(' ');

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
    const candidates = await searchProductImages(query, { limit: MAX_SEARCH_CANDIDATES_TO_TRY });

    for (const candidate of candidates) {
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
