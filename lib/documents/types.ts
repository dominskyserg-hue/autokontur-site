// ============================================================
// Общие типы для сборки печатных документов заказа — используются
// и сервисом сборки данных (orderDocumentData.ts), и всеми тремя
// шаблонами (invoiceTemplate.ts, deliveryNoteTemplate.ts,
// returnActTemplate.ts)
// ============================================================

import type { CompanyRequisites } from './companySettings';
import type { DocumentType } from './numbering';

export interface DocumentOrderItem {
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
}

export interface DocumentOrderInfo {
  id: string;
  shortId: string;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  vin: string | null;
  carInfo: string | null;
  createdAt: string;
  items: DocumentOrderItem[];
  totalAmount: number;
}

export interface ReturnActItem extends DocumentOrderItem {
  returnQuantity: number;
}

export interface OrderDocumentData {
  docType: DocumentType;
  number: string;
  createdAt: string;
  order: DocumentOrderInfo;
  company: CompanyRequisites;
  // Заповнюється лише для doc_type = 'return_act'
  returnItems?: ReturnActItem[];
  returnReason?: string | null;
}
