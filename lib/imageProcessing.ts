// ============================================================
// Завантаження, перевірка й стиснення фото товару.
//
// Кандидатів на фото беремо з lib/imageSearch.ts (Bing) або
// lib/directImageSources.ts (пряме вгадування посилань) — а тут вони
// проходять ОДНАКОВУ перевірку й обробку, незалежно від джерела:
//   1. Завантажити файл (з таймаутом і обмеженням розміру)
//   2. Переконатись, що це справді зображення і воно не менше
//      500×500px (мінімальна вимога із завдання)
//   3. Стиснути у WebP, якість 80%, до ~100 КБ
// ============================================================

import sharp from 'sharp';
import { randomUserAgent } from './imageSearch';

// Захист від "зображення" на 200 мегапікселів, яке покладе процес —
// такий файл просто ніхто не буде довантажувати
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024; // 15 МБ
const MIN_DIMENSION_PX = 500;
const TARGET_MAX_BYTES = 100 * 1024; // 100 КБ, як у завданні
const DOWNLOAD_TIMEOUT_MS = 12_000;

export interface ValidatedImage {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: string;
}

// Завантажує файл за посиланням і перевіряє, що це реальне зображення
// потрібного розміру. Повертає null (а не кидає виняток), якщо
// кандидат не підійшов — виняток тут означав би зупинку всієї черги
// через один поганий кандидат, а такого бути не повинно (простих
// "не підійшло, пробуємо наступного кандидата" достатньо)
export async function downloadAndValidateImage(url: string): Promise<ValidatedImage | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        // Деякі каталоги (як у прикладі з tayna.com) віддають фото,
        // тільки якщо Referer виглядає як перехід зі сторінки товару,
        // а не з "голого" запиту — тому додаємо загальний Referer
        Referer: 'https://www.bing.com/',
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) return null;

    const buffer = Buffer.from(arrayBuffer);

    // Перевіряємо РЕАЛЬНІ розміри файлу через sharp, а не довіряємо
    // тому, що написано в HTML видачі пошуковика (там це лише
    // орієнтир, а не гарантія)
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return null;
    if (metadata.width < MIN_DIMENSION_PX || metadata.height < MIN_DIMENSION_PX) return null;

    return { buffer, width: metadata.width, height: metadata.height, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Стискає зображення у WebP до приблизно TARGET_MAX_BYTES.
// Спочатку зменшуємо найбільшу сторону до 1200px (для картки товару
// більше й не потрібно), потім пробуємо якість 80% — якщо файл усе
// ще завеликий, поступово знижуємо якість, поки не впишемось у ліміт
// або не впремось у мінімально прийнятну якість (40%, нижче вже
// помітно "мутне" фото)
export async function convertToWebp(buffer: Buffer): Promise<Buffer> {
  const resized = sharp(buffer).resize({
    width: 1200,
    height: 1200,
    fit: 'inside',
    withoutEnlargement: true,
  });

  for (let quality = 80; quality >= 40; quality -= 10) {
    const output = await resized.clone().webp({ quality }).toBuffer();
    if (output.byteLength <= TARGET_MAX_BYTES || quality === 40) {
      return output;
    }
  }

  // Сюди код не повинен доходити (цикл вище завжди повертає значення
  // на quality === 40), але TypeScript цього не знає без явного return
  return resized.webp({ quality: 40 }).toBuffer();
}
