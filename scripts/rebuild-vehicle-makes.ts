// ============================================================
// Ручна повна перебудова product_vehicle_makes (lib/vehicleMakeIndex.ts) —
// напр. одразу після імпорту TecDoc (scripts/tecdoc/*), не чекаючи
// щотижневого cron /api/cron/rebuild-vehicle-makes.
//
//   npm run vehicle-makes:rebuild
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './tecdoc/loadEnv';
import { rebuildAllVehicleMakes } from '../lib/vehicleMakeIndex';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const startedAt = Date.now();
    const rows = await rebuildAllVehicleMakes(pool);
    console.log(`product_vehicle_makes: ${rows} рядків за ${Date.now() - startedAt} мс`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
