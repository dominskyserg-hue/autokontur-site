import { renderInvoiceHtml } from './invoiceTemplate';
import { renderDeliveryNoteHtml } from './deliveryNoteTemplate';
import { renderReturnActHtml } from './returnActTemplate';
import type { OrderDocumentData } from './types';

// Единая точка входа для трёх шаблонов — роуты
// app/api/orders/[id]/documents/[docType]/*/route.ts вызывают только
// эту функцию, не заботясь о том, какой конкретно шаблон подставить
export function renderDocumentHtml(data: OrderDocumentData): Promise<string> {
  switch (data.docType) {
    case 'invoice':
      return renderInvoiceHtml(data);
    case 'delivery_note':
      return renderDeliveryNoteHtml(data);
    case 'return_act':
      return renderReturnActHtml(data);
  }
}
