// ============================================================
// Пересчёт групп "бренд + артикул" (lib/productGroups.ts):
//   npm run groups:rebuild
// Запускать после включения групп и если что-то пошло не так с автоматикой
// (обычно группы пересчитываются сами после импорта прайса и в cron)
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './tecdoc/loadEnv';
import { recomputeProductGroups } from '../lib/productGroups';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await recomputeProductGroups(pool);
    console.log(`Группы: ${r.groups}, товаров в группах ${r.members}, изменено строк ${r.changed}, за ${Math.round(r.ms / 1000)} с`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
