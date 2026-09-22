// ============================================================
// Присвоение номера печатному документу — "получить-или-создать":
// при первом обращении к документу конкретного заказа выделяется
// новый номер (атомарно, через отдельный счётчик на месяц —
// document_sequences, секция 30.3 schema.sql), при повторном —
// возвращается уже присвоенный ранее (order_documents, секция 30.4),
// а не новый. Это важно для бухгалтерии: номер счёта не должен
// "прыгать" каждый раз, когда менеджер повторно открывает печать.
// ============================================================

import { Pool, PoolClient } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

export type DocumentType = 'invoice' | 'delivery_note' | 'return_act';

// Короткий буквений префікс — той самий, що бачить клієнт у номері
// документа ("РН-2026/09-123")
const PREFIXES: Record<DocumentType, string> = {
  invoice: 'РН',
  delivery_note: 'ВН',
  return_act: 'АП',
};

function currentPeriod(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}/${month}`;
}

// Атомарно виділяє наступний номер лічильника (doc_type, period) —
// SELECT ... FOR UPDATE усередині транзакції блокує рядок лічильника
// до кінця транзакції, тому два одночасних запити на один тип
// документа за один і той самий місяць ніколи не отримають однаковий
// номер
async function nextSequenceNumber(
  client: PoolClient,
  docType: DocumentType,
  period: string
): Promise<number> {
  await client.query(
    `
    INSERT INTO document_sequences (doc_type, period, last_number)
    VALUES ($1, $2, 0)
    ON CONFLICT (doc_type, period) DO NOTHING
    `,
    [docType, period]
  );

  const result = await client.query(
    `
    UPDATE document_sequences
    SET last_number = last_number + 1
    WHERE doc_type = $1 AND period = $2
    RETURNING last_number
    `,
    [docType, period]
  );

  return result.rows[0].last_number;
}

export interface OrderDocumentRecord {
  number: string;
  returnItems: unknown | null;
  returnReason: string | null;
  createdAt: string;
}

// Перевіряє, чи вже існує документ цього типу для заказу — потрібно
// ПЕРЕД викликом getOrCreateDocumentNumber для акта повернення: якщо
// документа ще нема, а менеджер не передав жодної позиції для
// повернення, створювати порожній запис не можна (UNIQUE(order_id,
// doc_type) назавжди "займе" номер порожнім актом, який вже ніяк не
// заповнити через цей самий флоу)
export async function hasExistingDocument(orderId: string, docType: DocumentType): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM order_documents WHERE order_id = $1 AND doc_type = $2`,
    [orderId, docType]
  );
  return result.rows.length > 0;
}

// Повертає вже присвоєний номер документа для цього заказу, або
// виділяє новий, якщо документ ще жодного разу не відкривали.
// returnData — необов'язкові дані акта повернення (що саме й скільки
// повертається, причина); передаються тільки для doc_type = 'return_act'
// і зберігаються РАЗОМ із номером, щоб повторне відкриття того самого
// акта показувало ті самі позиції, а не порожню форму
export async function getOrCreateDocumentNumber(
  orderId: string,
  docType: DocumentType,
  returnData?: { returnItems: unknown; returnReason: string | null }
): Promise<OrderDocumentRecord> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT number, return_items, return_reason, created_at FROM order_documents WHERE order_id = $1 AND doc_type = $2`,
      [orderId, docType]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      await client.query('COMMIT');
      return {
        number: row.number,
        returnItems: row.return_items,
        returnReason: row.return_reason,
        createdAt: row.created_at,
      };
    }

    const period = currentPeriod();
    const seq = await nextSequenceNumber(client, docType, period);
    const number = `${PREFIXES[docType]}-${period}-${seq}`;

    const inserted = await client.query(
      `
      INSERT INTO order_documents (order_id, doc_type, number, return_items, return_reason)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING number, return_items, return_reason, created_at
      `,
      [
        orderId,
        docType,
        number,
        returnData ? JSON.stringify(returnData.returnItems) : null,
        returnData?.returnReason ?? null,
      ]
    );

    await client.query('COMMIT');

    const row = inserted.rows[0];
    return {
      number: row.number,
      returnItems: row.return_items,
      returnReason: row.return_reason,
      createdAt: row.created_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Сохраняет ссылку на PDF, загруженный в Vercel Blob кнопкой
// "Сохранить документ" (см. app/api/orders/[id]/documents/[docType]/save/route.ts)
export async function saveDocumentFileUrl(
  orderId: string,
  docType: DocumentType,
  fileUrl: string
): Promise<void> {
  await pool.query(
    `UPDATE order_documents SET file_url = $3, updated_at = now() WHERE order_id = $1 AND doc_type = $2`,
    [orderId, docType, fileUrl]
  );
}
