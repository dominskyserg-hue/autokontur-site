// ============================================================
// Разметка tecdoc_crosses.source для строк, загруженных ДО появления
// колонки source (см. scripts/tecdoc/schema.sql). Новые импорты пишут
// source сами, этот скрипт нужен один раз.
//
// Как определяется источник: каждый импорт шёл отдельным запуском
// скрипта, поэтому строки одного источника лежат в своём окне
// created_at (UTC). Окна сверены с датами коммитов скриптов импорта и
// проверены по данным: например, оба окна Nippon — это товары поставщика
// NMCO, а строки прайсов с неизвестным брендом помечены 'OEM/аналог'.
// Для надёжности к окну добавлены признаки самой строки (relation_type,
// метка 'OEM/аналог', бренд TRW) — строка, не подходящая под них, так и
// остаётся 'unknown'.
//
// Идемпотентно: меняются ТОЛЬКО строки с source = 'unknown', повторный
// запуск ничего не портит. Обновление — пачками по id, чтобы не держать
// одну огромную транзакцию на миллионы строк.
//
// Запуск:
//   node --env-file=.env.local --import tsx scripts/tecdoc/backfill-crosses-source.ts
// ============================================================

import { Pool } from 'pg';

const PRICE_LABEL = 'OEM/аналог';
const ID_STEP = 200_000;

interface SourceRule {
  source: string;
  from: string; // created_at >= from (UTC)
  to: string; // created_at < to (UTC)
  condition: string; // дополнительные признаки строки
}

const RULES: SourceRule[] = [
  {
    source: 'tecdoc_2016',
    from: '2026-09-01 00:00',
    to: '2026-09-05 00:00',
    condition: `relation_type = 'cross' AND brand_a <> '${PRICE_LABEL}' AND brand_b <> '${PRICE_LABEL}'`,
  },
  {
    source: 'trw_2025',
    from: '2026-09-06 00:00',
    to: '2026-09-07 00:00',
    condition: `relation_type = 'oem' AND (brand_a = 'TRW' OR brand_b = 'TRW')`,
  },
  {
    source: 'tecdoc_2018',
    from: '2026-09-07 21:00',
    to: '2026-09-07 22:00',
    condition: `relation_type = 'oem'`,
  },
  {
    source: 'price_nippon',
    from: '2026-09-10 09:50',
    to: '2026-09-10 11:00',
    condition: `relation_type = 'cross' AND (brand_a = '${PRICE_LABEL}' OR brand_b = '${PRICE_LABEL}')`,
  },
  {
    source: 'autohelp',
    from: '2026-09-10 11:25',
    to: '2026-09-10 11:55',
    condition: `relation_type = 'cross'`,
  },
  {
    source: 'price_cardon',
    from: '2026-09-11 11:00',
    to: '2026-09-11 11:10',
    condition: `relation_type = 'cross' AND (brand_a = '${PRICE_LABEL}' OR brand_b = '${PRICE_LABEL}')`,
  },
  {
    source: 'price_va',
    from: '2026-09-11 11:30',
    to: '2026-09-11 11:40',
    condition: `relation_type = 'cross' AND (brand_a = '${PRICE_LABEL}' OR brand_b = '${PRICE_LABEL}')`,
  },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  // Колонка могла ещё не существовать — тот же ALTER, что в schema.sql
  await pool.query(`ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown'`);

  const { rows } = await pool.query(`SELECT min(id) AS min_id, max(id) AS max_id FROM tecdoc_crosses`);
  const minId = Number(rows[0].min_id ?? 0);
  const maxId = Number(rows[0].max_id ?? 0);

  for (const rule of RULES) {
    let updated = 0;
    for (let start = minId; start <= maxId; start += ID_STEP) {
      const result = await pool.query(
        `UPDATE tecdoc_crosses SET source = $1
          WHERE id >= $2 AND id < $3
            AND source = 'unknown'
            AND created_at >= $4::timestamptz AND created_at < $5::timestamptz
            AND ${rule.condition}`,
        [rule.source, start, start + ID_STEP, `${rule.from}+00`, `${rule.to}+00`]
      );
      updated += result.rowCount ?? 0;
    }
    console.log(`${rule.source}: размечено ${updated.toLocaleString('ru-RU')}`);
  }

  const summary = await pool.query(`SELECT source, count(*)::int AS n FROM tecdoc_crosses GROUP BY source ORDER BY n DESC`);
  console.log('\nИтог по источникам:');
  for (const row of summary.rows) console.log(`  ${row.source}: ${row.n.toLocaleString('ru-RU')}`);

  await pool.end();
}

main().catch((error) => {
  console.error('Ошибка разметки источников:', error);
  process.exit(1);
});
