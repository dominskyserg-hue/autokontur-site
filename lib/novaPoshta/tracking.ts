// ============================================================
// Где сейчас посылка — статус ТТН от Новой Почты
// (TrackingDocument.getStatusDocuments). Используется окном заказа
// через app/api/orders/[id]/ttn-status/route.ts.
//
// Номер телефона получателя передаём вместе с номером ТТН: без него
// Нова Пошта отдаёт только урезанный статус (без дат и отделения).
//
// Разные поля ответа Нова Пошта заполняет не всегда — поэтому все
// даты здесь необязательные, а экран показывает только то, что есть.
// ============================================================

import { callNovaPoshtaApi, toNovaPoshtaPhone } from './api';

interface StatusDocumentRaw {
  Number?: string;
  Status?: string;
  StatusCode?: string | number;
  WarehouseRecipient?: string;
  CityRecipient?: string;
  ScheduledDeliveryDate?: string;
  ActualDeliveryDate?: string;
  RecipientDateTime?: string;
  DateFirstDayStorage?: string;
  DatePayedKeeping?: string;
  RedeliverySum?: string | number;
  AfterpaymentOnGoodsCost?: string | number;
}

// Коды статусов Новой Почты, которые нужны экрану
// (полный список — в документации TrackingDocument)
const ARRIVED_CODES = [7, 8]; // прибула у відділення / поштомат
const RECEIVED_CODES = [9, 10, 11]; // отримано (з грошовим переказом теж)
const RETURN_CODES = [102, 103, 105, 108, 111]; // відмова, повернення, зберігання припинено, невдала спроба

export type TtnStatusKind = 'created' | 'in_transit' | 'arrived' | 'received' | 'problem' | 'unknown';

export interface TtnStatus {
  statusText: string;
  statusCode: number | null;
  kind: TtnStatusKind;
  warehouse: string | null;
  // Когда посылка прибыла в отделение (для расчёта "лежит N дней")
  arrivedAt: string | null;
  // С какой даты начинается платное хранение
  paidStorageFrom: string | null;
  receivedAt: string | null;
  scheduledDelivery: string | null;
  // Сколько дней посылка уже лежит в отделении (если прибыла и не забрана)
  daysAtWarehouse: number | null;
}

// Нова Пошта отдаёт даты в разных видах: "2026-09-30 14:05:00" или
// "30.09.2026 14:05:00". Приводим к ISO, чтобы фронтенд форматировал сам
function parseNpDate(value: string | undefined): string | null {
  if (!value || !value.trim() || value.startsWith('0001')) return null;
  const v = value.trim();
  const dotted = v.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const iso = dotted
    ? `${dotted[3]}-${dotted[2]}-${dotted[1]}T${dotted[4] || '00'}:${dotted[5] || '00'}:${dotted[6] || '00'}`
    : v.replace(' ', 'T');
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getTtnStatus(ttnNumber: string, recipientPhone: string): Promise<TtnStatus> {
  const [doc] = await callNovaPoshtaApi<StatusDocumentRaw>('TrackingDocument', 'getStatusDocuments', {
    Documents: [{ DocumentNumber: ttnNumber.replace(/\s+/g, ''), Phone: toNovaPoshtaPhone(recipientPhone) }],
  });
  if (!doc) {
    throw new Error('Нова Пошта не повернула статус посилки.');
  }

  const code = doc.StatusCode !== undefined && doc.StatusCode !== '' ? Number(doc.StatusCode) : null;
  let kind: TtnStatusKind = 'unknown';
  if (code === 1) kind = 'created';
  else if (code !== null && ARRIVED_CODES.includes(code)) kind = 'arrived';
  else if (code !== null && RECEIVED_CODES.includes(code)) kind = 'received';
  else if (code !== null && RETURN_CODES.includes(code)) kind = 'problem';
  else if (code !== null && code >= 4 && code <= 6) kind = 'in_transit';
  else if (code === 41 || code === 101 || code === 104 || code === 112) kind = 'in_transit';

  // Дата прибытия: сначала "первый день хранения", потом фактическая
  // дата доставки в отделение — что из них Нова Пошта заполнила
  const arrivedAt = parseNpDate(doc.DateFirstDayStorage) || parseNpDate(doc.ActualDeliveryDate);
  const daysAtWarehouse =
    kind === 'arrived' && arrivedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(arrivedAt).getTime()) / (24 * 60 * 60 * 1000)))
      : null;

  return {
    statusText: doc.Status || 'Статус невідомий',
    statusCode: code,
    kind,
    warehouse: doc.WarehouseRecipient || null,
    arrivedAt,
    paidStorageFrom: parseNpDate(doc.DatePayedKeeping),
    receivedAt: parseNpDate(doc.RecipientDateTime),
    scheduledDelivery: parseNpDate(doc.ScheduledDeliveryDate),
    daysAtWarehouse,
  };
}
