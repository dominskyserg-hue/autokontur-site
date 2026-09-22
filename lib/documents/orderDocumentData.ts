// ============================================================
// Собирает всё, что нужно шаблону документа, в один объект
// OrderDocumentData: данные заказа из базы + реквизиты компании +
// присвоенный (или уже существующий) номер документа. Используется
// всеми тремя роутами app/api/orders/[id]/documents/[docType]/*.
// ============================================================

import { Pool } from 'pg';
import { getCompanyRequisites } from './companySettings';
import { getOrCreateDocumentNumber, type DocumentType } from './numbering';
import type { DocumentOrderInfo, OrderDocumentData, ReturnActItem } from './types';

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

export class OrderNotFoundError extends Error {}

async function loadOrder(orderId: string): Promise<DocumentOrderInfo> {
  const orderResult = await pool.query(
    `SELECT id, customer_name, customer_surname, customer_phone, vin, car_info, created_at
     FROM orders WHERE id = $1`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    throw new OrderNotFoundError(`Заказ ${orderId} не найден`);
  }

  const row = orderResult.rows[0];

  const itemsResult = await pool.query(
    `SELECT article, brand, name, price, quantity FROM order_items
     WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned')
     ORDER BY created_at ASC`,
    [orderId]
  );

  const items = itemsResult.rows.map((item) => ({
    article: item.article,
    brand: item.brand,
    name: item.name,
    price: parseFloat(item.price),
    quantity: item.quantity,
  }));

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    id: row.id,
    shortId: (row.id as string).slice(0, 8),
    customerName: row.customer_name,
    customerSurname: row.customer_surname,
    customerPhone: row.customer_phone,
    vin: row.vin,
    carInfo: row.car_info,
    createdAt: row.created_at,
    items,
    totalAmount,
  };
}

export interface ReturnActInput {
  // Позиции, которые менеджер выбрал к возврату (только для
  // doc_type = 'return_act') — article используется как ключ, чтобы
  // сопоставить с фактическими позициями заказа (id order_items
  // фронтенду знать не обязательно)
  items: Array<{ article: string; quantity: number }>;
  reason: string;
}

// orderId и docType — обязательные, returnInput передаётся только
// при создании НОВОГО акта повернення (doc_type = 'return_act'); при
// повторном открытии уже существующего документа он не нужен —
// сохранённые ранее позиции и причина читаются из order_documents
export async function buildOrderDocumentData(
  orderId: string,
  docType: DocumentType,
  returnInput?: ReturnActInput
): Promise<OrderDocumentData> {
  const [order, company] = await Promise.all([loadOrder(orderId), getCompanyRequisites()]);

  const record = await getOrCreateDocumentNumber(
    orderId,
    docType,
    docType === 'return_act' && returnInput
      ? { returnItems: returnInput.items, returnReason: returnInput.reason }
      : undefined
  );

  const data: OrderDocumentData = {
    docType,
    number: record.number,
    createdAt: record.createdAt,
    order,
    company,
  };

  if (docType === 'return_act') {
    const rawItems = (record.returnItems as Array<{ article: string; quantity: number }> | null) || returnInput?.items || [];
    const reason = record.returnReason ?? returnInput?.reason ?? null;

    const returnItems: ReturnActItem[] = rawItems
      .map((entry) => {
        const source = order.items.find((item) => item.article === entry.article);
        if (!source) return null;
        return { ...source, returnQuantity: Math.min(entry.quantity, source.quantity) };
      })
      .filter((item): item is ReturnActItem => item !== null);

    data.returnItems = returnItems;
    data.returnReason = reason;
  }

  return data;
}
