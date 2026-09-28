// ============================================================
// Разметка tecdoc_crosses.is_valid для строк старого дампа TecDoc
// (source = 'tecdoc_2016').
//
// Старый импорт (scripts/tecdoc/import-dump.ts) сопоставлял дамп с нашим
// каталогом только по очищенному артикулу, без бренда, поэтому в таблицу
// попали кроссы чужих деталей с тем же номером. Строка считается верной,
// если ХОТЯ БЫ ОДНА её сторона (brand_a + article_a или brand_b +
// article_b) — товар нашего каталога по правилу бренда из
// lib/crossBrandMatch.ts (то же правило, что на сайте). Иначе
// is_valid = false: строка остаётся в базе, но сайт её не использует.
//
// Смотрятся ВСЕ товары, включая неактивные: товар, временно пропавший из
// прайса, не должен терять свои кроссы. Скрипт пересчитывает флаг
// целиком (и true, и false), поэтому его можно запускать повторно —
// например, после загрузки прайса с новыми брендами.
//
// Запуск:
//   node --env-file=.env.local --import tsx scripts/tecdoc/mark-invalid-crosses.ts
// ============================================================

import { Pool } from 'pg';
import { crossSideMatchesSql } from '../../lib/crossBrandMatch';

const SOURCE = 'tecdoc_2016';
const ID_STEP = 100_000;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  // Проверка идёт прямо по products (индекс idx_products_article). Временная
  // таблица не подходит: пулер соединений может сменить сессию между запросами
  const client = await pool.connect();

  try {
    await client.query(`SET statement_timeout = '900s'`);
    // Тот же ALTER, что в schema.sql — на случай, если его ещё не применяли
    await client.query(`ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT true`);

    const { rows } = await client.query(
      `SELECT min(id) AS min_id, max(id) AS max_id FROM tecdoc_crosses WHERE source = $1`,
      [SOURCE]
    );
    const minId = Number(rows[0].min_id ?? 0);
    const maxId = Number(rows[0].max_id ?? -1);

    let invalid = 0;
    let total = 0;
    for (let start = minId; start <= maxId; start += ID_STEP) {
      const result = await client.query(
        `WITH verdict AS (
           SELECT tc.id,
                  EXISTS (SELECT 1 FROM products c WHERE c.article = tc.article_a
                            AND ${crossSideMatchesSql('tc.brand_a', 'tc.article_a', 'c.brand')})
               OR EXISTS (SELECT 1 FROM products c WHERE c.article = tc.article_b
                            AND ${crossSideMatchesSql('tc.brand_b', 'tc.article_b', 'c.brand')}) AS ok
             FROM tecdoc_crosses tc
            WHERE tc.source = $1 AND tc.id >= $2 AND tc.id < $3
         )
         UPDATE tecdoc_crosses t SET is_valid = v.ok
           FROM verdict v
          WHERE t.id = v.id AND t.is_valid IS DISTINCT FROM v.ok`,
        [SOURCE, start, start + ID_STEP]
      );
      const counts = await client.query(
        `SELECT count(*) FILTER (WHERE NOT is_valid)::int AS bad, count(*)::int AS n
           FROM tecdoc_crosses WHERE source = $1 AND id >= $2 AND id < $3`,
        [SOURCE, start, start + ID_STEP]
      );
      invalid += counts.rows[0].bad;
      total += counts.rows[0].n;
      console.log(
        `  id ${start.toLocaleString('ru-RU')}+: изменено ${result.rowCount}, ` +
          `ложных всего ${invalid.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`
      );
    }

    console.log(`\nГотово: ${SOURCE} — ложных (is_valid = false) ${invalid.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка разметки is_valid:', error);
  process.exit(1);
});
