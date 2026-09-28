// ============================================================
// Этап B перехода с TecDoc: исключить кроссы TecDoc (tecdoc_2016,
// tecdoc_2018) и сторонних файлов неизвестного происхождения
// (price_cardon, price_va). Строки НЕ удаляются — помечаются
// is_valid = false, invalid_reason = 'source_excluded'; сайт читает только
// is_valid (блок "Аналоги", поиск по номеру, своя применимость).
//
// 1) применяет из scripts/tecdoc/schema.sql колонку invalid_reason и
//    триггер trg_tecdoc_crosses_exclude_sources (новые строки этих
//    источников сразу пишутся помеченными);
// 2) помечает уже загруженные строки — пачками по id.
// Повторный запуск безопасен.
//
//   node --env-file=.env.local --import tsx scripts/tecdoc/exclude-cross-sources.ts
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const EXCLUDED = ['tecdoc_2016', 'tecdoc_2018', 'price_cardon', 'price_va'];
const ID_STEP = 200_000;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'scripts/tecdoc/schema.sql'), 'utf8');
    const start = schema.indexOf('ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS invalid_reason TEXT;');
    const endMarker = 'FOR EACH ROW EXECUTE FUNCTION tecdoc_crosses_exclude_sources();';
    const end = schema.indexOf(endMarker, start);
    if (start < 0 || end < 0) throw new Error('В scripts/tecdoc/schema.sql не найден блок invalid_reason / триггер');
    await pool.query(schema.slice(start, end + endMarker.length));

    const { rows } = await pool.query(`SELECT min(id) AS min_id, max(id) AS max_id FROM tecdoc_crosses`);
    const minId = Number(rows[0].min_id ?? 0);
    const maxId = Number(rows[0].max_id ?? -1);
    let marked = 0;
    for (let start = minId; start <= maxId; start += ID_STEP) {
      const result = await pool.query(
        `UPDATE tecdoc_crosses SET is_valid = false, invalid_reason = 'source_excluded'
          WHERE id >= $1 AND id < $2 AND source = ANY($3::text[])
            AND (is_valid OR invalid_reason IS DISTINCT FROM 'source_excluded')`,
        [start, start + ID_STEP, EXCLUDED]
      );
      marked += result.rowCount ?? 0;
    }
    console.log(`Помечено строк: ${marked.toLocaleString('ru-RU')}`);

    const summary = await pool.query(
      `SELECT source, count(*) FILTER (WHERE is_valid)::int AS used, count(*) FILTER (WHERE NOT is_valid)::int AS excluded,
              string_agg(DISTINCT invalid_reason, ', ') AS reasons
         FROM tecdoc_crosses GROUP BY source ORDER BY source`
    );
    for (const r of summary.rows) console.log(`  ${r.source}: используется ${r.used}, исключено ${r.excluded} (${r.reasons ?? '—'})`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка исключения источников кроссов:', error);
  process.exit(1);
});
