// ============================================================
// Время импорта самого большого прайса: "до групп" и "сейчас" — ТОЛЬКО
// ЧТЕНИЕ по итогу: всё в транзакции + ROLLBACK. Прайс собирается из текущих
// данных поставщика; у ~20% строк цена +3%, у ~5% меняется наличие.
// Импорт — тем же кодом (saveProductsToDatabase), шаги после импорта — те
// же, что в lib/priceListImport.ts (afterImport): группы и категории.
//   до групп — триггер полей группы выключен (app.skip_group_refresh), без
//              пересчёта групп;
//   сейчас   — как на проде: поля групп — один раз в конце записи прайса,
//              пересчёт групп — только с артикулами этого поставщика.
//
//   node --env-file=.env.local --import tsx scripts/category-review/import-timing.mts
// ============================================================

import pg from 'pg';

const { saveProductsToDatabase } = await import('../../lib/priceListImport.ts');
const { recomputeInTransaction } = await import('../../lib/categoryAssignment.ts');
const { recomputeProductGroups } = await import('../../lib/productGroups.ts');
const { refreshVehicleMakesForSupplier } = await import('../../lib/vehicleMakeIndex.ts');
const { rebuildUkrainianCorpusSafely } = await import('../../lib/corpusBuilder.ts');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const supplier = (await pool.query(`SELECT supplier_id, count(*)::int n FROM products GROUP BY 1 ORDER BY 2 DESC LIMIT 1`)).rows[0];
const rows = (await pool.query(
  `SELECT article, brand, name, car_make, car_model, car_year, engine_volume, slug, meta_title, meta_description,
          cost_price, retail_price, discount_percent, stock
   FROM products WHERE supplier_id = $1`, [supplier.supplier_id])).rows;

// Детерминированно "псевдослучайно" по номеру строки — одинаковый прайс для обоих прогонов
const products = rows.map((r, i) => {
  const priceChange = i % 5 === 0 ? 1.03 : 1;
  const stock = i % 20 === 0 ? (r.stock > 0 ? 0 : 3) : r.stock;
  return {
    article: r.article, brand: r.brand ?? '', name: r.name ?? '', carMake: r.car_make ?? '', carModel: r.car_model ?? '',
    carYear: r.car_year ?? '', engineVolume: r.engine_volume ?? '', imageUrl: '', slug: r.slug ?? '', metaTitle: r.meta_title ?? '',
    metaDescription: r.meta_description ?? '',
    supplierPrice: Math.round(parseFloat(r.cost_price) * priceChange * 100) / 100,
    retailPrice: Math.round(parseFloat(r.retail_price) * priceChange * 100) / 100,
    discountPercent: parseFloat(r.discount_percent), stock,
  };
});
console.log(`Поставщик: ${supplier.n} товаров, в прайсе ${products.length} строк\n`);

// Одно соединение на весь прогон: BEGIN снаружи, ROLLBACK в конце; BEGIN/COMMIT/release
// внутри кода импорта и пересчёта групп пропускаем, чтобы всё осталось в одной транзакции
async function run(label: string, withGroups: boolean) {
  const client = await pool.connect();
  const fake = {
    connect: async () => ({
      query: (sql: any, params?: any) =>
        typeof sql === 'string' && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) ? Promise.resolve({ rows: [], rowCount: 0 }) : client.query(sql, params),
      release: () => {},
    }),
    query: (sql: any, params?: any) => client.query(sql, params),
  } as any;
  try {
    await client.query('BEGIN');
    if (!withGroups) await client.query(`SET LOCAL app.skip_group_refresh = 'on'`);
    const t0 = Date.now();
    await saveProductsToDatabase(fake, supplier.supplier_id, products as any);
    const tImport = Date.now() - t0;
    const t1 = Date.now();
    if (withGroups) await recomputeProductGroups(fake, { supplierId: supplier.supplier_id });
    const tGroups = Date.now() - t1;
    const t2 = Date.now();
    await recomputeInTransaction(client, { kind: 'supplier', supplierId: supplier.supplier_id });
    const tCats = Date.now() - t2;
    console.log(`${label.padEnd(10)} запись прайса ${(tImport / 1000).toFixed(1)} с | группы ${(tGroups / 1000).toFixed(1)} с | категории ${(tCats / 1000).toFixed(1)} с | всего ${((tImport + tGroups + tCats) / 1000).toFixed(1)} с`);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// После выноса "хвоста" (lib/importFollowup.ts): вызов импорта = запись + группы;
// отдельный вызов = категории + индекс марок + словарь. Категории — в той же
// транзакции с откатом; индекс марок и словарь пересчитываются по ТЕКУЩИМ
// данным (результат тот же, что сейчас в базе), поэтому их можно запускать как есть
async function runSplit() {
  const client = await pool.connect();
  const fake = {
    connect: async () => ({
      query: (sql: any, params?: any) =>
        typeof sql === 'string' && /^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql) ? Promise.resolve({ rows: [], rowCount: 0 }) : client.query(sql, params),
      release: () => {},
    }),
    query: (sql: any, params?: any) => client.query(sql, params),
  } as any;
  let tImport = 0, tGroups = 0, tCats = 0;
  try {
    await client.query('BEGIN');
    let t = Date.now();
    await saveProductsToDatabase(fake, supplier.supplier_id, products as any);
    tImport = Date.now() - t;
    t = Date.now();
    await recomputeProductGroups(fake, { supplierId: supplier.supplier_id });
    tGroups = Date.now() - t;
    t = Date.now();
    await recomputeInTransaction(client, { kind: 'supplier', supplierId: supplier.supplier_id });
    tCats = Date.now() - t;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  let t = Date.now();
  await refreshVehicleMakesForSupplier(pool, supplier.supplier_id);
  const tMakes = Date.now() - t;
  t = Date.now();
  await rebuildUkrainianCorpusSafely(pool);
  const tCorpus = Date.now() - t;
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} с`;
  console.log(`вызов импорта: запись ${s(tImport)} + группы ${s(tGroups)} = ${s(tImport + tGroups)}`);
  console.log(`отдельный вызов: категории ${s(tCats)} + марки ${s(tMakes)} + словарь ${s(tCorpus)} = ${s(tCats + tMakes + tCorpus)}\n`);
}

if (process.argv.includes('--split')) {
  await runSplit();
  await runSplit();
} else {
  await run('до групп', false);
  await run('сейчас', true);
  await run('до групп', false);
  await run('сейчас', true);
}
await pool.end();
