// ============================================================
// Шаблон "Рахунок-фактура" (счёт на оплату) — для безналичной
// оплаты клиентами. Реквизиты продавца, IBAN, QR-код для быстрой
// оплаты и место под печать/подпись — как требует ТЗ.
// ============================================================

import { generateQrCodeDataUrl } from './qrCode';
import { renderDocumentShell, formatDateUa } from './layout';
import { renderSellerHeader, renderClientInfoGrid, renderItemsTable, renderTotalsBlock, renderSignaturesBlock } from './partials';
import { amountToWordsUah } from './numberToWordsUah';
import type { OrderDocumentData } from './types';

export async function renderInvoiceHtml(data: OrderDocumentData): Promise<string> {
  const { order, company, number, createdAt } = data;

  // QR-код кодує текстові реквізити для оплати — сканер більшості
  // банківських застосунків (Приват24, Monobank) розпізнає такий
  // текст і дозволяє скопіювати IBAN одним дотиком. Єдиного
  // державного стандарту "платіжного QR" в Україні немає (на відміну
  // від, наприклад, SEPA-QR у Європі), тому це саме текстова
  // підказка, а не гарантовано "автозаповнюваний" переказ
  const qrLines = [
    `Отримувач: ${company.legalName || company.shopName}`,
    company.iban ? `IBAN: ${company.iban}` : null,
    company.taxId ? `ІПН/ЄДРПОУ: ${company.taxId}` : null,
    `Призначення: Оплата за замовленням №${order.shortId}`,
    `Сума: ${order.totalAmount.toFixed(2)} грн`,
  ]
    .filter(Boolean)
    .join('\n');

  const qrDataUrl = company.iban ? await generateQrCodeDataUrl(qrLines) : undefined;

  const bodyHtml = `
    ${renderSellerHeader({
      docTitle: 'Рахунок-фактура',
      number,
      dateLabel: formatDateUa(createdAt),
      company,
    })}
    ${renderClientInfoGrid(order)}
    ${renderItemsTable({ items: order.items })}
    ${renderTotalsBlock({ totalAmount: order.totalAmount, wordsLine: amountToWordsUah(order.totalAmount) })}
    <p class="muted" style="font-size: 10.5px; margin: 0 0 4px;">
      Без ПДВ (не є платником податку на додану вартість).
    </p>
    ${renderSignaturesBlock({
      company,
      leftCaption: 'Керівник',
      qrDataUrl,
      qrCaption: company.iban ? 'Скануйте для оплати' : undefined,
    })}
    <p class="doc-footer-note">
      Рахунок дійсний для оплати протягом 3 банківських днів з дати виписки. Оплата рахунку означає згоду
      з умовами постачання товару.
    </p>
  `;

  return renderDocumentShell({ title: `Рахунок ${number}`, bodyHtml });
}
