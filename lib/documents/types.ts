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
  // Человекочитаемый номер заказа (1, 2, 3...) — см. lib/orderUi.ts
  orderNumber: number;
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

// Что показывать в таблице позиций — переключается кнопкой
// "Редактировать" в components/PrintDocumentsPanel.tsx перед печатью.
// Это НЕ хранится в базе (в отличие от номера документа) — просто
// параметр конкретного рендера, у одного и того же заказа рахунок
// можно один раз распечатать с артикулами, другой раз — без них
export interface DocumentDisplayOptions {
  showArticle: boolean;
  showBrand: boolean;
}

export const DEFAULT_DISPLAY_OPTIONS: DocumentDisplayOptions = {
  showArticle: true,
  showBrand: true,
};

export interface OrderDocumentData {
  docType: DocumentType;
  number: string;
  createdAt: string;
  order: DocumentOrderInfo;
  company: CompanyRequisites;
  displayOptions: DocumentDisplayOptions;
  // Заповнюється лише для doc_type = 'return_act'
  returnItems?: ReturnActItem[];
  returnReason?: string | null;
}
