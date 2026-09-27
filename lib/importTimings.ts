// ============================================================
// Журнал времени импорта прайсов (таблица price_import_timings, schema.sql)
// и уведомление владельцу в Telegram, если вызов длился больше 50 с —
// лимит функции Vercel 60 с, значит запас почти кончился
// ============================================================

import type { Pool } from 'pg';
import { sendTelegramMessage } from '@/lib/telegramNotify';

export type ImportSource = 'upload' | 'email' | 'url';

// Порог уведомления: вызов длиннее этого — почти упёрлись в 60 с Vercel
const SLOW_CALL_MS = 50_000;

type TimingFields = Partial<{
  rows_count: number;
  parse_ms: number;
  save_ms: number;
  groups_ms: number;
  import_total_ms: number;
  categories_ms: number;
  vehicle_makes_ms: number;
  corpus_ms: number;
  followup_total_ms: number;
  followup_error: string;
  followup_finished_at: Date;
}>;

// Новая строка журнала; ошибка записи не должна ронять импорт — тогда null
export async function createImportTiming(pool: Pool, supplierId: string, source: ImportSource, fields: TimingFields): Promise<string | null> {
  try {
    const keys = Object.keys(fields);
    const result = await pool.query(
      `INSERT INTO price_import_timings (supplier_id, source${keys.map((k) => `, ${k}`).join('')})
       VALUES ($1, $2${keys.map((_, i) => `, $${i + 3}`).join('')}) RETURNING id`,
      [supplierId, source, ...Object.values(fields)]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('Журнал времени импорта: не удалось создать запись', error);
    return null;
  }
}

export async function updateImportTiming(pool: Pool, id: string | null, fields: TimingFields): Promise<void> {
  if (!id) return;
  try {
    const keys = Object.keys(fields);
    await pool.query(
      `UPDATE price_import_timings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...Object.values(fields)]
    );
  } catch (error) {
    console.error('Журнал времени импорта: не удалось обновить запись', error);
  }
}

const seconds = (ms: number | undefined) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} с`);

// Уведомление, если вызов длился больше 50 с. parts — из чего сложилось время
export async function alertIfSlowImport(
  pool: Pool,
  call: 'імпорт' | 'хвіст імпорту (категорії, марки, словник)',
  supplierId: string,
  totalMs: number,
  parts: Record<string, number | undefined>
): Promise<void> {
  if (totalMs <= SLOW_CALL_MS) return;
  try {
    const supplier = (await pool.query('SELECT name FROM suppliers WHERE id = $1', [supplierId])).rows[0]?.name ?? supplierId;
    const lines = Object.entries(parts).map(([label, ms]) => `• ${label}: ${seconds(ms)}`);
    await sendTelegramMessage(
      `⚠️ Довгий ${call}: ${seconds(totalMs)} (ліміт функції Vercel — 60 с)\nПостачальник: ${supplier}\n${lines.join('\n')}`
    );
  } catch (error) {
    console.error('Не удалось отправить уведомление о долгом импорте', error);
  }
}
