// ============================================================
// Пересборка фида страниц для DSA Google Ads (lib/dsaPageFeed.ts):
//   npm run dsa-feed:rebuild
// Обычно фид пересобирается сам раз в сутки (cron /api/cron/rebuild-dsa-feed).
// Печатает сколько строк всего, по каждому label и 5 примеров
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './crosses/loadEnv';
import { rebuildDsaFeed, buildDsaFeedRows, buildDsaFeedCsv } from '../lib/dsaPageFeed';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // --dry — только посчитать, в Blob не записывать
    if (process.argv.includes('--dry')) {
      const rows = await buildDsaFeedRows(pool);
      console.log(buildDsaFeedCsv(rows).split('\r\n').slice(0, 6).join('\n'));
      console.log(`Строк: ${rows.length}`);
      return;
    }
    const result = await rebuildDsaFeed(pool);
    console.log(`Фид DSA: ${result.total} строк за ${Math.round(result.ms / 1000)} с → ${result.url}`);
    for (const [label, count] of Object.entries(result.byLabel).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${label}: ${count}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
