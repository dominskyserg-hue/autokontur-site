// ============================================================
// Разовий (ручний) скрипт масового пошуку фото для товарів, які
// підходять під ключове слово в назві — на відміну від щоденного
// cron (app/api/cron/fetch-product-images/route.ts, 8 товарів/добу),
// цей скрипт можна запустити локально й обробити відразу цілу
// категорію за один прохід. Використовує ТОЙ САМИЙ пайплайн
// (lib/productImagePipeline.ts) — жодної окремої логіки пошуку тут
// немає, лише вибірка товарів і послідовний виклик з логуванням
// прогресу.
//
// Запуск:
//   npx tsx scripts/backfill-images.ts "сайлентблок"
//   npx tsx scripts/backfill-images.ts "диск,гальм"   -- через кому =
//     ОБИДВА слова мають зустрічатись у назві (той самий принцип, що
//     й matchGroups у lib/categories.ts — товар має підходити під усі
//     групи одразу, інакше в категорію "Гальмівні диски" потрапив би
//     будь-який диск, включно з дисками зчеплення)
//
// DATABASE_URL і BLOB_READ_WRITE_TOKEN мають бути в оточенні (той
// самий .env.local, що і в решти проєкту).
// ============================================================

import { Pool } from 'pg';
import { processProductImage, type ProductToProcess } from '../lib/productImagePipeline';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function main() {
  const keywordArg = process.argv[2];
  if (!keywordArg) {
    console.error('Використання: npx tsx scripts/backfill-images.ts "ключове слово[,ще одне]"');
    process.exit(1);
  }

  const keywords = keywordArg.split(',').map((k) => k.trim()).filter(Boolean);
  const whereClauses = keywords.map((_, i) => `name ILIKE $${i + 1}`).join(' AND ');
  const values = keywords.map((k) => `%${k}%`);

  const result = await pool.query<ProductToProcess>(
    `
    SELECT id, article, brand, name
    FROM products
    WHERE ${whereClauses}
      AND (image_url IS NULL OR image_url = '')
    ORDER BY id
    `,
    values
  );

  const total = result.rows.length;
  console.log(`Знайдено ${total} товарів без фото за ключовими словами "${keywords.join(' + ')}"\n`);

  let found = 0;
  let notFound = 0;
  let errors = 0;
  const startedAt = Date.now();

  for (let i = 0; i < total; i++) {
    const product = result.rows[i];
    const outcome = await processProductImage(pool, product);

    if (outcome === 'found') found++;
    else if (outcome === 'not_found') notFound++;
    else errors++;

    const progressLine = `[${i + 1}/${total}] ${outcome.padEnd(9)} ${product.brand ?? ''} ${product.article}`;
    console.log(progressLine);

    if ((i + 1) % 25 === 0 || i === total - 1) {
      const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
      const rate = ((i + 1) / ((Date.now() - startedAt) / 60000)).toFixed(1);
      console.log(
        `\n--- Прогрес: ${i + 1}/${total} | знайдено=${found} не_знайдено=${notFound} помилок=${errors} | ${elapsedMin} хв, ${rate} товарів/хв ---\n`
      );
    }

    // Затримка МІЖ товарами — та сама логіка "антибан", що і в
    // щоденному cron (lib/productImagePipeline.ts processBatch)
    if (i < total - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 3000));
    }
  }

  console.log(`\nГотово. Знайдено=${found}, не знайдено=${notFound}, помилок=${errors} з ${total}`);
  await pool.end();
}

main().catch((error) => {
  console.error('Помилка скрипту:', error);
  process.exit(1);
});
