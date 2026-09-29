// ============================================================
// Куди фізично зберігати вже стиснене фото (WebP, ~100 КБ).
//
// "Сервер/папка /uploads/" тут НЕ підійде: проєкт задеплоєний на
// Vercel, а файлова система serverless-функцій там ЕФЕМЕРНА — все,
// що функція запише на диск під час одного виклику, зникає одразу
// після його завершення й ніколи не віддається наступному
// відвідувачу. Тому потрібне СПРАВЖНЄ сховище — окремий сервіс, а
// не локальна папка і не сама база даних.
//
// Раніше фото зберігали прямо в колонці products.image_url як
// base64 data:-URI — це працювало "з коробки" без налаштувань, але
// не масштабується: при 120 000+ товарів навіть по ~100 КБ на фото
// це легко гігабайти прямо в основній таблиці бази — таблиця
// повільнішає ВСЯ, включно з пошуком, який не має жодного стосунку
// до фото. Тому фото зберігаємо у Vercel Blob (окреме файлове
// сховище, безкоштовний ліміт є на будь-якому тарифі Vercel) — а в
// базі лишається тільки коротке посилання на файл.
//
// Потрібен токен сховища: локально — BLOB_READ_WRITE_TOKEN у .env.local,
// на Vercel сховище підключене з префіксом "bazaa_" (змінна
// bazaa_READ_WRITE_TOKEN). Яку саме взяти — вирішує blobToken()
// у lib/blobToken.ts. До 29.09.2026 на проді put() без token входив
// через OIDC у ІНШЕ сховище (BLOB_STORE_ID = store_DQzIbjxtWtDr5TOu) —
// старі фото Bing лежать там, нові — у сховищі bazaa_
// ============================================================

import type { Pool } from 'pg';
import { del, put } from '@vercel/blob';
import { blobToken } from './blobToken';

// ------------------------------------------------------------
// УДАЛЕНИЕ ЗАМЕНЁННЫХ ФОТО ИЗ BLOB
// ------------------------------------------------------------
// Правило владельца (29.09.2026): фото от поставщика или загруженное вручную
// всегда главнее фото из Bing — новое заменяет Bing-фото, а старый файл
// удаляется из Blob. Сами Bing-фото без замены НЕ удаляем.
//
// Фото лежат в двух хранилищах (см. выше). Файл своего хранилища удаляем
// токеном blobToken(); файл другого подключённого хранилища — через OIDC
// с явным storeId (работает только на Vercel; локально — ошибка в лог)

// storeId из хоста "<storeid>.public.blob.vercel-storage.com" — в хосте он в
// нижнем регистре, а API нужен настоящий ("store_DQzIbjxtWtDr5TOu"), поэтому
// сверяем с id подключённых хранилищ из переменных окружения
function blobAuthForUrl(url: string): { token: string } | { storeId: string } | null {
  const match = url.match(/^https:\/\/([a-z0-9]+)\.public\.blob\.vercel-storage\.com\//);
  if (!match) return null;
  const hostId = match[1];
  const token = blobToken();
  if (token && token.split('_')[3]?.toLowerCase() === hostId) return { token };
  const storeIds = [process.env.BLOB_STORE_ID, process.env.bazaa_STORE_ID, process.env.blod2_STORE_ID];
  const storeId = storeIds.find((id) => id && id.replace(/^store_/, '').toLowerCase() === hostId);
  return storeId ? { storeId } : null;
}

// Удалить из Blob файлы заменённых фото — только если на файл больше не
// ссылается ни один товар (главное фото, фото группы, галерея). Ошибки
// только в лог: сбой удаления не должен ломать импорт прайса или сохранение
// товара. Возвращает, сколько файлов удалено
export async function deleteReplacedImages(pool: Pool, urls: string[]): Promise<number> {
  const unique = [...new Set(urls.filter((url) => blobAuthForUrl(url) !== null))];
  if (unique.length === 0) return 0;
  let deleted = 0;
  try {
    const stillUsed = await pool.query<{ url: string }>(
      `SELECT image_url AS url FROM products WHERE image_url = ANY($1::text[])
       UNION SELECT group_image_url FROM products WHERE group_image_url = ANY($1::text[])
       UNION SELECT image_url FROM product_images WHERE image_url = ANY($1::text[])`,
      [unique]
    );
    const used = new Set(stillUsed.rows.map((row) => row.url));
    for (const url of unique) {
      if (used.has(url)) continue;
      const auth = blobAuthForUrl(url);
      try {
        await del(url, auth ?? undefined);
        deleted++;
      } catch (error) {
        console.error(`Не удалось удалить заменённое фото из Blob (${url}):`, error);
      }
    }
  } catch (error) {
    console.error('Ошибка при удалении заменённых фото из Blob:', error);
  }
  if (deleted > 0) console.log(`Удалено заменённых фото Bing из Blob: ${deleted}`);
  return deleted;
}

export async function saveImage(webpBuffer: Buffer): Promise<string> {
  // Ім'я файлу — випадковий UUID, а не артикул товару: той самий
  // артикул різних поставщиків (чи перезбереження фото для одного й
  // того ж товару) не повинні перезаписувати чужий файл. addRandomSuffix
  // не потрібен — crypto.randomUUID() вже унікальний сам по собі
  const fileName = `products/${crypto.randomUUID()}.webp`;

  const blob = await put(fileName, webpBuffer, {
    access: 'public',
    contentType: 'image/webp',
    // Фото іменоване унікальним UUID і ніколи не перезаписується —
    // тому можна кешувати на CDN хоч на рік, зайвих запитів по нього
    // все одно не буде
    cacheControlMaxAge: 31536000,
    token: blobToken(),
  });

  return blob.url;
}

// Той самий підхід, що й saveImage() вище, але для логотипу й
// печатки/підпису компанії (app/api/company-requisites/upload-asset/route.ts) —
// окрема функція лише через інший префікс шляху в Blob-сховищі
// ("company/logo/..." замість "products/..."), щоб файли не змішувались
// в одній "папці" з фото товарів
export async function saveCompanyAsset(webpBuffer: Buffer, kind: 'logo' | 'stamp'): Promise<string> {
  const fileName = `company/${kind}/${crypto.randomUUID()}.webp`;

  const blob = await put(fileName, webpBuffer, {
    access: 'public',
    contentType: 'image/webp',
    cacheControlMaxAge: 31536000,
    token: blobToken(),
  });

  return blob.url;
}
