// ============================================================
// Імпорт OEM-кросів з НОВОГО дампу TecDoc (tecdoc_2018_4_fr) — на
// відміну від scripts/tecdoc/import-dump.ts (старий дамп, схема
// articles/art_lookup/link_art...), цей дамп поширюється у ЗОВСІМ
// іншій, "плоскій" схемі: кожна таблиця — окремий .sql файл, вже
// РОЗПАКОВАНИЙ з .7z у папку .tecdoc-scratch/ (сам .zip лежить поза
// репозиторієм, у завантаженнях користувача).
//
// Реальна структура (перевірено вручну по самому дампу):
//
//   suppliers(id, dataversion, description, ...)         — id -> бренд
//        нашого постачальника (напр. 2 -> "HELLA")
//   manufacturers(id, canbedisplayed, description, ...)  — id -> марка
//        авто-виробника ОЕМ-номера (напр. 2 -> "ALFA ROMEO"); та сама
//        людина повторюється по кілька разів під різні isaxle/
//        iscommercialvehicle/... прапори — беремо перше знайдене
//        значення description для кожного id
//   article_cross(manufacturerId, OENbr, OENbr_CLR, SupplierId,
//                 PartsDataSupplierArticleNumber)
//   article_oe(supplierid, datasupplierarticlenumber, IsAdditive,
//              OENbr, manufacturerId)
//
// article_cross і article_oe СТРУКТУРНО ідентичні за змістом (обидві
// дають "наш артикул постачальника <-> ОЕМ-номер виробника авто") —
// обробляємо обидві, ON CONFLICT DO NOTHING у BatchInserter сам
// прибере дублікати між ними.
//
// Той самий принцип фільтрації, що і в старому імпорті: зберігаємо
// ЛИШЕ рядки, де очищений артикул постачальника (PartsDataSupplierArticleNumber/
// datasupplierarticlenumber) справді є в products.article — інакше
// таблиця роздулась би мільйонами нікому не потрібних зв'язків.
//
// Запуск (після того, як .tecdoc-scratch/*.sql вже розпаковані):
//   npx tsx scripts/tecdoc/import-2018-fr-oe.ts
// ============================================================

import { Pool } from 'pg';
import { loadEnvLocal } from './loadEnv';
import { readDump } from './dumpReader';
import { BatchInserter } from './batchInserter';
import { cleanArticle } from './cleanArticle';
import { loadOurArticles } from './loadOurArticles';

loadEnvLocal();

const SCRATCH = 'C:/autokontur-site2/.tecdoc-scratch';

async function loadSuppliers(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await readDump(`${SCRATCH}/suppliers.sql`, {
    onInsertRows(table, rows) {
      if (table !== 'suppliers') return;
      for (const row of rows) {
        const id = row[0] as number;
        const description = row[2] as string | null;
        if (description) map.set(id, description);
      }
    },
  });
  return map;
}

async function loadManufacturers(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  await readDump(`${SCRATCH}/manufacturers.sql`, {
    onInsertRows(table, rows) {
      if (table !== 'manufacturers') return;
      for (const row of rows) {
        const id = row[0] as number;
        const description = row[2] as string | null;
        if (description && !map.has(id)) map.set(id, description);
      }
    },
  });
  return map;
}

interface ColumnOrder {
  supplierId: number;
  article: number;
  oeNbr: number;
  manufacturerId: number;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });

  console.log('Завантажую довідники (наші артикули, постачальники, виробники)...');
  const ourArticles = await loadOurArticles(pool);
  const suppliers = await loadSuppliers();
  const manufacturers = await loadManufacturers();
  console.log(
    `Наших унікальних артикулів: ${ourArticles.size}, постачальників TecDoc: ${suppliers.size}, виробників: ${manufacturers.size}\n`
  );

  // Источник строк для tecdoc_crosses.source (см. scripts/tecdoc/schema.sql)
  const CROSSES_SOURCE = 'tecdoc_2018';
  const inserter = new BatchInserter<[string, string, string, string, string, string]>(
    pool,
    'tecdoc_crosses',
    ['brand_a', 'article_a', 'brand_b', 'article_b', 'relation_type', 'source'],
    3000
  );

  let seen = 0;
  let matched = 0;

  async function processTable(filePath: string, tableName: string, cols: ColumnOrder) {
    console.log(`Обробляю ${tableName} (${filePath})...`);
    await readDump(filePath, {
      async onInsertRows(table, rows) {
        if (table !== tableName) return;
        for (const row of rows) {
          seen++;

          const article = cleanArticle(row[cols.article]);
          if (!article || !ourArticles.has(article)) continue;

          const oeNbr = cleanArticle(row[cols.oeNbr]);
          if (!oeNbr) continue;

          const supplierId = row[cols.supplierId] as number;
          const manufacturerId = row[cols.manufacturerId] as number;
          const brandA = suppliers.get(supplierId) || 'TECDOC';
          const brandB = manufacturers.get(manufacturerId) || 'OEM';

          matched++;
          await inserter.add([brandA, article, brandB, oeNbr, 'oem', CROSSES_SOURCE]);
        }
      },
      progressEveryLines: 2_000_000,
      onProgress(stats) {
        const mb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
        console.log(
          `  [${tableName}] ${stats.linesRead.toLocaleString('uk-UA')} рядків файлу, ` +
            `оброблено=${seen.toLocaleString('uk-UA')}, збігів=${matched.toLocaleString('uk-UA')}, ` +
            `вставлено=${inserter.getTotalInserted().toLocaleString('uk-UA')}, пам'ять ${mb} МБ`
        );
      },
    });
  }

  // manufacturerId, OENbr, OENbr_CLR, SupplierId, PartsDataSupplierArticleNumber
  await processTable(`${SCRATCH}/article_cross.sql`, 'article_cross', {
    manufacturerId: 0,
    oeNbr: 1,
    supplierId: 3,
    article: 4,
  });

  // supplierid, datasupplierarticlenumber, IsAdditive, OENbr, manufacturerId
  await processTable(`${SCRATCH}/article_oe.sql`, 'article_oe', {
    supplierId: 0,
    article: 1,
    oeNbr: 3,
    manufacturerId: 4,
  });

  await inserter.flush();

  console.log('\n============================================================');
  console.log(
    `Готово. Прочитано рядків: ${seen.toLocaleString('uk-UA')}, ` +
      `збігів з нашим каталогом: ${matched.toLocaleString('uk-UA')}, ` +
      `реально вставлено нових (з урахуванням дублів): ${inserter.getTotalInserted().toLocaleString('uk-UA')}`
  );
  console.log('============================================================');

  await pool.end();
}

main().catch((error) => {
  console.error('Помилка імпорту:', error);
  process.exit(1);
});
