// ============================================================
// Бейдж "Відновлена": применение схемы и заполнение products.is_refurbished
// для уже загруженных товаров (раздел "ВОССТАНОВЛЕННЫЕ И Б/У ДЕТАЛИ" в
// schema.sql). Новые и изменённые товары дальше размечает триггер
// trg_products_set_refurbished — этот скрипт нужен один раз.
//
// SQL берётся прямо из schema.sql (колонки, обновлённая функция лучшего
// предложения групп и новый раздел), чтобы не держать его в двух местах.
//
// Порядок:
//   1) схема: колонки, product_is_refurbished(), триггер,
//      refresh_product_group_offers() с полем group_best_refurbished;
//   2) is_refurbished — пачками по 5000 товаров (обновляются только
//      строки, где значение меняется; content_changed_at не трогается —
//      его двигают только цена, название, наличие и активность);
//   3) group_best_refurbished — пересчёт полей лучшего предложения для всех
//      главных страниц групп.
//
// Запуск (повторный запуск безопасен):
//   node --env-file=.env.local --import tsx scripts/mark-refurbished.ts
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const BATCH = 5000;

function extractSchemaSql(): string[] {
  const schema = fs.readFileSync(path.resolve(process.cwd(), 'schema.sql'), 'utf8');

  const columns = [
    'ALTER TABLE products ADD COLUMN IF NOT EXISTS is_refurbished BOOLEAN NOT NULL DEFAULT false;',
    'ALTER TABLE products ADD COLUMN IF NOT EXISTS group_best_refurbished BOOLEAN;',
  ];
  for (const statement of columns) {
    if (!schema.includes(statement)) throw new Error(`В schema.sql нет строки: ${statement}`);
  }

  const fnStart = schema.indexOf('CREATE OR REPLACE FUNCTION refresh_product_group_offers(');
  const fnEnd = schema.indexOf('$$ LANGUAGE plpgsql;', fnStart);
  if (fnStart < 0 || fnEnd < 0) throw new Error('В schema.sql не найдена refresh_product_group_offers');
  const refreshFunction = schema.slice(fnStart, fnEnd + '$$ LANGUAGE plpgsql;'.length);

  const sectionStart = schema.indexOf('-- ВОССТАНОВЛЕННЫЕ И Б/У ДЕТАЛИ');
  if (sectionStart < 0) throw new Error('В schema.sql не найден раздел ВОССТАНОВЛЕННЫЕ И Б/У ДЕТАЛИ');
  const section = schema.slice(sectionStart);

  return [...columns, refreshFunction, section];
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  try {
    console.log('1/3 Схема...');
    for (const sql of extractSchemaSql()) await pool.query(sql);

    console.log('2/3 is_refurbished...');
    let lastId = '00000000-0000-0000-0000-000000000000';
    let changed = 0;
    for (;;) {
      const batch = await pool.query(`SELECT id FROM products WHERE id > $1 ORDER BY id LIMIT ${BATCH}`, [lastId]);
      if (batch.rows.length === 0) break;
      const ids = batch.rows.map((row) => row.id as string);
      lastId = ids[ids.length - 1];
      const result = await pool.query(
        `UPDATE products SET is_refurbished = product_is_refurbished(name, brand)
          WHERE id = ANY($1::uuid[]) AND is_refurbished IS DISTINCT FROM product_is_refurbished(name, brand)`,
        [ids]
      );
      changed += result.rowCount ?? 0;
    }
    console.log(`   изменено товаров: ${changed.toLocaleString('ru-RU')}`);

    console.log('3/3 Поля лучшего предложения групп...');
    const primaries = await pool.query(
      `SELECT DISTINCT group_primary_id AS id FROM products WHERE group_primary_id IS NOT NULL`
    );
    const primaryIds = primaries.rows.map((row) => row.id as string);
    for (let i = 0; i < primaryIds.length; i += BATCH) {
      await pool.query('SELECT refresh_product_group_offers($1::uuid[])', [primaryIds.slice(i, i + BATCH)]);
    }

    const summary = await pool.query(`
      SELECT count(*) FILTER (WHERE is_refurbished)::int AS refurbished,
             count(*) FILTER (WHERE is_refurbished AND stock > 0)::int AS refurbished_in_stock,
             count(*) FILTER (WHERE is_group_primary AND group_best_refurbished)::int AS group_cards_refurbished
        FROM products WHERE is_active`);
    console.log('\nИтог (активные товары):', summary.rows[0]);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Ошибка разметки восстановленных деталей:', error);
  process.exit(1);
});
