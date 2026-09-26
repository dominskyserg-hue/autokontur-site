// ============================================================
// Полный пересчёт категорий всех товаров → таблица product_categories
// (lib/categoryAssignment.ts). Запускать после изменения правил
// категорий (lib/categories.ts, lib/categoryRulesExtra.ts):
//
//   npm run categories:rebuild
//
// В cron полный пересчёт не делаем — не укладывается в 60 секунд
// функции Vercel; там пересчитываются только изменённые товары
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './tecdoc/loadEnv';
import { recomputeProductCategories } from '../lib/categoryAssignment';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await recomputeProductCategories(pool, { kind: 'all' });
    console.log(`product_categories: товаров ${r.products}, назначений ${r.assignments}, за ${Math.round(r.ms / 1000)} с`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
