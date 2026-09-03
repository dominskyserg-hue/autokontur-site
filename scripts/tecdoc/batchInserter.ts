// ============================================================
// Пакетна (batch) вставка рядків у Postgres/Supabase — той самий
// підхід, що вже використовується в app/api/suppliers/parse-excel/
// route.ts (upsertBatch): один багаторядковий
// INSERT ... VALUES ($1,$2,...),($3,$4,...) ... замість запиту на
// кожен рядок окремо. Свідомо БЕЗ бібліотеки pg-format — параметризовані
// плейсхолдери ($1, $2...) і так безпечні від SQL-ін'єкцій і не
// додають нової залежності в проєкт.
//
// Кожен виклик flush() — ОКРЕМА транзакція (BEGIN/COMMIT на один
// батч, а не одна величезна транзакція на весь 11-гігабайтний дамп):
// при збої на середині імпорту вже вставлені батчі залишаються в базі,
// і повторний запуск скрипта просто продовжить (ON CONFLICT DO NOTHING
// на рівні таблиць робить це безпечним — див. schema.sql). Одна
// довга транзакція на години роботи, навпаки, ризикує впертися в
// ліміти Supabase (idle-in-transaction timeout, роздуття WAL) і
// втратити взагалі весь прогрес одразу при будь-якому збої
// ============================================================

import type { Pool } from 'pg';

export class BatchInserter<Row extends unknown[]> {
  private buffer: Row[] = [];
  private totalInserted = 0;

  constructor(
    private readonly pool: Pool,
    private readonly tableName: string,
    private readonly columns: string[],
    private readonly batchSize: number = 3000
  ) {}

  async add(row: Row): Promise<void> {
    this.buffer.push(row);
    if (this.buffer.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const rows = this.buffer;
    this.buffer = [];

    const columnsCount = this.columns.length;
    const valuesSql: string[] = [];
    const params: unknown[] = [];

    rows.forEach((row, rowIndex) => {
      const placeholders = row.map((_, colIndex) => `$${rowIndex * columnsCount + colIndex + 1}`);
      valuesSql.push(`(${placeholders.join(', ')})`);
      params.push(...row);
    });

    const sql = `
      INSERT INTO ${this.tableName} (${this.columns.join(', ')})
      VALUES ${valuesSql.join(', ')}
      ON CONFLICT DO NOTHING
    `;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql, params);
      await client.query('COMMIT');
      this.totalInserted += rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getTotalInserted(): number {
    return this.totalInserted;
  }
}
