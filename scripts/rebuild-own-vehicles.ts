// ============================================================
// Ручной полный пересчёт product_vehicles_own (lib/ownVehicles.ts) — не
// дожидаясь ночного cron /api/cron/rebuild-own-vehicles. Перед пересчётом
// создаёт таблицу, если её ещё нет (раздел "СВОЯ ПРИМЕНИМОСТЬ" в schema.sql).
//
//   npm run own-vehicles:rebuild
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadEnvLocal } from './crosses/loadEnv';
import { rebuildOwnVehicles } from '../lib/ownVehicles';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const schema = fs.readFileSync(path.resolve(process.cwd(), 'schema.sql'), 'utf8');
    const start = schema.indexOf('-- СВОЯ ПРИМЕНИМОСТЬ: МАРКА И МОДЕЛЬ ИЗ СОБСТВЕННЫХ ДАННЫХ');
    if (start < 0) throw new Error('В schema.sql не найден раздел СВОЯ ПРИМЕНИМОСТЬ');
    const end = schema.indexOf('\n-- ====', schema.indexOf('\n', start + 80) + 1);
    await pool.query(schema.slice(start, end > 0 ? end : undefined));

    const r = await rebuildOwnVehicles(pool);
    console.log(`product_vehicles_own: товаров ${r.products}, строк ${r.rows} (+${r.added} / −${r.removed}), ${r.ms} мс`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
