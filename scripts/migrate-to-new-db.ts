// ============================================================
// Перенесення схеми й даних з поточної бази (Supabase) на нову базу
// (напр. Vercel Postgres / Neon) — ПІДГОТОВКА до майбутнього переїзду,
// сам сайт (DATABASE_URL у .env.local / Vercel Production) при цьому
// НЕ перемикається, лишається на Supabase.
//
// Порядок таблиць нижче — той самий, що і в schema.sql (він уже
// написаний з урахуванням зовнішніх ключів: спершу таблиці, на які
// посилаються, потім ті, що посилаються на них).
//
// Запуск:
//   SOURCE_DATABASE_URL=<supabase-url> TARGET_DATABASE_URL=<нова-база-url> \
//     npx tsx scripts/migrate-to-new-db.ts
//
// Що робить:
//   1. Виконує schema.sql цілком на TARGET (створює всі таблиці,
//      індекси, розширення) — той самий файл, яким створювалась і
//      поточна база, тому результат гарантовано ідентичний.
//   2. Копіює дані з КОЖНОЇ таблиці SOURCE -> TARGET пачками по 500
//      рядків (COPY тут не використовується — pg-copy-streams не є
//      залежністю проєкту, а пачкові INSERT достатньо швидкі навіть
//      для мільйонів рядків tecdoc_crosses/tecdoc_compatibility).
//   3. Звіряє кількість рядків у SOURCE і TARGET по кожній таблиці й
//      виводить підсумок — якщо десь розбіжність, це видно одразу.
//
// Таблицю exchange_rates (стара, порожня, замінена на
// global_exchange_rates — див. схему) свідомо НЕ переносимо, бо вона
// відсутня і в самому schema.sql.
// ============================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const SOURCE_URL = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const TARGET_URL = process.env.TARGET_DATABASE_URL;

if (!SOURCE_URL) {
  console.error('Не задано SOURCE_DATABASE_URL (або DATABASE_URL).');
  process.exit(1);
}
if (!TARGET_URL) {
  console.error('Не задано TARGET_DATABASE_URL — посилання на нову базу (Vercel Postgres/Neon).');
  process.exit(1);
}

// Порядок ВАЖЛИВИЙ — той самий, що і в schema.sql (від таблиць без
// залежностей до тих, що посилаються на попередні)
const TABLES_IN_ORDER = [
  'global_exchange_rates',
  'suppliers',
  'supplier_excel_mappings',
  'products',
  'orders',
  'order_items',
  'site_settings',
  'announcements',
  'cross_reference_groups',
  'cross_reference_members',
  'cross_reference_conflicts',
  'vin_requests',
  'site_pages',
  'search_synonym_groups',
  'tecdoc_crosses',
  'tecdoc_compatibility',
  'tecdoc_related_categories',
];

const BATCH_SIZE = 500;

async function applySchema(target: Pool) {
  console.log('Створюю схему на новій базі (schema.sql)...');
  const sql = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf-8');
  await target.query(sql);
  console.log('Схему створено.\n');
}

async function copyTable(source: Pool, target: Pool, table: string): Promise<{ table: string; sourceCount: number; targetCount: number }> {
  const columnsResult = await source.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  const columns = columnsResult.rows.map((r) => r.column_name as string);
  if (columns.length === 0) {
    console.log(`[${table}] таблиці немає в SOURCE — пропускаю`);
    return { table, sourceCount: 0, targetCount: 0 };
  }
  const columnList = columns.map((c) => `"${c}"`).join(', ');

  const countBefore = await source.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  const total = countBefore.rows[0].c as number;

  if (total === 0) {
    console.log(`[${table}] 0 рядків — пропускаю`);
    return { table, sourceCount: 0, targetCount: 0 };
  }

  console.log(`[${table}] копіюю ${total} рядків...`);

  let copied = 0;
  let offset = 0;
  while (offset < total) {
    const batch = await source.query(`SELECT ${columnList} FROM "${table}" ORDER BY 1 LIMIT ${BATCH_SIZE} OFFSET ${offset}`);
    if (batch.rows.length === 0) break;

    const values: unknown[] = [];
    const rowsSql: string[] = [];
    for (const row of batch.rows) {
      const placeholders = columns.map((c) => {
        values.push(row[c]);
        return `$${values.length}`;
      });
      rowsSql.push(`(${placeholders.join(', ')})`);
    }

    await target.query(
      `INSERT INTO "${table}" (${columnList}) VALUES ${rowsSql.join(', ')} ON CONFLICT DO NOTHING`,
      values
    );

    copied += batch.rows.length;
    offset += BATCH_SIZE;
    if (copied % 5000 === 0 || copied === total) {
      console.log(`  [${table}] ${copied}/${total}`);
    }
  }

  const countAfter = await target.query(`SELECT COUNT(*)::int AS c FROM "${table}"`);
  return { table, sourceCount: total, targetCount: countAfter.rows[0].c as number };
}

async function main() {
  const source = new Pool({ connectionString: SOURCE_URL, max: 2 });
  const target = new Pool({ connectionString: TARGET_URL, max: 2 });

  try {
    await applySchema(target);

    const results = [];
    for (const table of TABLES_IN_ORDER) {
      const result = await copyTable(source, target, table);
      results.push(result);
    }

    console.log('\n=== ПІДСУМОК ===');
    let allMatch = true;
    for (const r of results) {
      const match = r.sourceCount === r.targetCount;
      if (!match) allMatch = false;
      console.log(`${match ? '✓' : '✗ НЕЗБІГ'} ${r.table}: source=${r.sourceCount} target=${r.targetCount}`);
    }
    console.log(allMatch ? '\nВсі таблиці збігаються.' : '\nЄ РОЗБІЖНОСТІ — перевірте таблиці, позначені ✗ вище.');
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error('Помилка міграції:', error);
  process.exit(1);
});
