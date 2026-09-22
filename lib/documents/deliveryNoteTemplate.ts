// ============================================================
// Шаблон "Видаткова накладна" (товарна накладна / товарний чек) —
// выдаётся клиенту при отгрузке/выдаче товара: полный список
// артикулов, брендов, количества и цен, подписи "Відпустив/Отримав".
// ============================================================

import { generateQrCodeDataUrl } from './qrCode';
import { renderDocumentShell, formatDateUa } from './layout';
import { renderSellerHeader, renderClientInfoGrid, renderItemsTable, renderTotalsBlock, renderSignaturesBlock } from './partials';
import { amountToWordsUah } from './numberToWordsUah';
import { SITE_URL } from '@/lib/siteConfig';
import type { OrderDocumentData } from './types';

export async function renderDeliveryNoteHtml(data: OrderDocumentData): Promise<string> {
  const { order, company, number, createdAt } = data;

  // QR веде в особистий кабінет покупця — там видно статус
  // замовлення й номер ТТН, якщо товар відправлений Новою Поштою
  const qrDataUrl = await generateQrCodeDataUrl(`${SITE_URL}/account`);

  const bodyHtml = `
    ${renderSellerHeader({
      docTitle: 'Видаткова накладна',
      number,
      dateLabel: formatDateUa(createdAt),
      company,
    })}
    ${renderClientInfoGrid(order)}
    ${renderItemsTable({ items: order.items, ...data.displayOptions })}
    ${renderTotalsBlock({ totalAmount: order.totalAmount, wordsLine: amountToWordsUah(order.totalAmount) })}
    ${renderSignaturesBlock({
      company,
      leftCaption: 'Відпустив',
      rightCaption: 'Отримав (ПІБ, підпис)',
      qrDataUrl,
      qrCaption: 'Статус замовлення',
    })}
    <p class="doc-footer-note">
      Отримуючи товар, покупець підтверджує відповідність кількості та комплектності зазначеному переліку.
    </p>
  `;

  return renderDocumentShell({ title: `Накладна ${number}`, bodyHtml });
}
