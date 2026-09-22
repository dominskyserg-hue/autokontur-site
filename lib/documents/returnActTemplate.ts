// ============================================================
// Шаблон "Акт повернення товару" — оформляется при возврате
// запчасти от клиента. В отличие от счёта и накладной, состав
// этого документа (что именно и сколько возвращается, причина)
// не выводится автоматически из заказа — его вручную указывает
// менеджер в форме перед печатью (см. data.returnItems/returnReason,
// собранные в app/api/orders/[id]/documents/[docType]/*/route.ts).
// ============================================================

import { renderDocumentShell, formatDateUa, formatMoneyUah, escapeHtml } from './layout';
import { renderSellerHeader, renderClientInfoGrid, renderItemsTable, renderSignaturesBlock } from './partials';
import { amountToWordsUah } from './numberToWordsUah';
import type { OrderDocumentData } from './types';

export async function renderReturnActHtml(data: OrderDocumentData): Promise<string> {
  const { order, company, number, createdAt, returnItems = [], returnReason } = data;

  const returnTotal = returnItems.reduce((sum, item) => sum + item.price * item.returnQuantity, 0);

  const itemsTableHtml = renderItemsTable({
    items: returnItems,
    getQuantity: (item) => (item as (typeof returnItems)[number]).returnQuantity,
    ...data.displayOptions,
  });

  const bodyHtml = `
    ${renderSellerHeader({
      docTitle: 'Акт повернення товару',
      number,
      dateLabel: formatDateUa(createdAt),
      company,
    })}
    ${renderClientInfoGrid(order)}
    ${itemsTableHtml}
    <div class="totals">
      <div class="totals__box">
        <div class="totals__row grand">
          <span>Сума до повернення</span>
          <span>${formatMoneyUah(returnTotal)} грн</span>
        </div>
      </div>
    </div>
    <p class="totals__words">Сума прописом: ${escapeHtml(amountToWordsUah(returnTotal))}</p>
    <div class="info-grid" style="grid-template-columns: 1fr;">
      <div class="info-grid__row">
        <span class="info-grid__label">Причина повернення:</span>
        <span class="info-grid__value">${escapeHtml(returnReason || 'не вказана')}</span>
      </div>
    </div>
    ${renderSignaturesBlock({
      company,
      leftCaption: 'Прийняв (продавець)',
      rightCaption: 'Здав (покупець, ПІБ, підпис)',
    })}
    <p class="doc-footer-note">
      Акт складено у двох примірниках — по одному для кожної зі сторін. Повернені кошти виплачуються
      способом, узгодженим із покупцем, після перевірки товару.
    </p>
  `;

  return renderDocumentShell({ title: `Акт повернення ${number}`, bodyHtml });
}
