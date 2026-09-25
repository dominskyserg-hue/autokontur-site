// ============================================================
// Таблиця product_vehicle_makes — "марка авто -> товари" для пошуку
// (lib/productSearch.ts, гілка "сумісність з авто" з TecDoc).
//
// Навіщо: раніше пошук типу "фільтр toyota" для КОЖНОГО запиту з'єднував
// tecdoc_compatibility (~1 млн рядків) з products за brand+article — для
// великих марок (Toyota: ~37 тис. збігів) це 200-600 мс. Тепер цей збіг
// заздалегідь обчислений: один рядок на (товар, марка, роки), ~320 тис.
// рядків, пошук по марці — за індексом.
//
// Семантика ТА САМА, що й у старому запиті: товар підходить, якщо
// tecdoc_compatibility має рядок з ТИМ САМИМ brand і article (точний
// збіг тексту), марка = UPPER(make), а рік (якщо заданий) — у межах
// year_from..year_to (NULL = без обмеження).
//
// Оновлення:
//   - після імпорту прайсу постачальника — лише його товари
//     (refreshVehicleMakesForSupplier, у фоні через after())
//   - раз на тиждень повністю — cron /api/cron/rebuild-vehicle-makes
//   - вручну (напр. після імпорту TecDoc): npm run vehicle-makes:rebuild
// ============================================================

import type { Pool } from 'pg';

const SELECT_ROWS = `
  SELECT DISTINCT p.id, UPPER(tc.make), tc.year_from, tc.year_to
  FROM tecdoc_compatibility tc
  JOIN products p ON p.brand = tc.brand AND p.article = tc.article
`;

// Повна перебудова в одній транзакції — читачі не бачать порожню таблицю
export async function rebuildAllVehicleMakes(pool: Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM product_vehicle_makes');
    const result = await client.query(
      `INSERT INTO product_vehicle_makes (product_id, make, year_from, year_to) ${SELECT_ROWS}`
    );
    await client.query('COMMIT');
    return result.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Лише товари одного постачальника — після завантаження його прайсу
// (нові товари з'явились, у старих міг змінитись бренд/артикул)
export async function refreshVehicleMakesForSupplier(pool: Pool, supplierId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM product_vehicle_makes WHERE product_id IN (SELECT id FROM products WHERE supplier_id = $1)`,
      [supplierId]
    );
    await client.query(
      `INSERT INTO product_vehicle_makes (product_id, make, year_from, year_to) ${SELECT_ROWS} WHERE p.supplier_id = $1`,
      [supplierId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    // Імпорт уже пройшов; щотижнева повна перебудова підстрахує
    console.error('Не вдалося оновити product_vehicle_makes для постачальника:', error);
  } finally {
    client.release();
  }
}
