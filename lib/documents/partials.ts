// ============================================================
// Переиспользуемые куски разметки документа — шапка с реквизитами
// продавца, блок клиента, таблица позиций, блок итогов и блок
// подписей/печати/QR. Каждый из трёх шаблонов
// (invoiceTemplate.ts, deliveryNoteTemplate.ts, returnActTemplate.ts)
// собирает свой bodyHtml из этих кусков — так шапка и таблица
// выглядят одинаково во всех документах, а различается только то,
// что реально отличается по сути (заголовок, состав итогов, текст
// в подписях)
// ============================================================

import type { CompanyRequisites } from './companySettings';
import type { DocumentOrderInfo, DocumentOrderItem } from './types';
import { escapeHtml, formatDateUa, formatMoneyUah } from './layout';

export function renderSellerHeader(options: {
  docTitle: string;
  number: string;
  dateLabel: string;
  company: CompanyRequisites;
}): string {
  const { docTitle, number, dateLabel, company } = options;

  const sellerName = company.legalName || company.shopName;
  const detailLines = [
    company.taxId ? `ІПН/ЄДРПОУ: ${escapeHtml(company.taxId)}` : null,
    company.legalAddress ? `Адреса: ${escapeHtml(company.legalAddress)}` : null,
    company.phone ? `Тел.: ${escapeHtml(company.phone)}` : null,
    company.iban ? `IBAN: ${escapeHtml(company.iban)}${company.bankName ? ` (${escapeHtml(company.bankName)})` : ''}` : null,
  ].filter(Boolean) as string[];

  return `
  <div class="doc-header">
    <div class="doc-header__seller">
      ${company.logoUrl ? `<img class="doc-header__logo" src="${escapeHtml(company.logoUrl)}" alt="">` : ''}
      <div>
        <p class="doc-header__seller-name">${escapeHtml(sellerName)}</p>
        <div class="doc-header__seller-details">${detailLines.join('<br>')}</div>
      </div>
    </div>
    <div class="doc-header__title-block">
      <p class="doc-header__title">${escapeHtml(docTitle)}</p>
      <p class="doc-header__number">№ ${escapeHtml(number)}</p>
      <p class="doc-header__date">від ${escapeHtml(dateLabel)}</p>
    </div>
  </div>`;
}

export function renderClientInfoGrid(order: DocumentOrderInfo, extraRows: Array<[string, string]> = []): string {
  const rows: Array<[string, string]> = [
    ['Замовлення', `№${order.shortId} від ${formatDateUa(order.createdAt)}`],
    ['Клієнт', `${order.customerName} ${order.customerSurname}`.trim()],
    ['Телефон', order.customerPhone],
    ...extraRows,
  ];

  if (order.carInfo) rows.push(['Автомобіль', order.carInfo]);
  if (order.vin) rows.push(['VIN', order.vin]);

  return `
  <div class="info-grid">
    ${rows
      .map(
        ([label, value]) => `
    <div class="info-grid__row">
      <span class="info-grid__label">${escapeHtml(label)}:</span>
      <span class="info-grid__value">${escapeHtml(value)}</span>
    </div>`
      )
      .join('')}
  </div>`;
}

export function renderItemsTable(options: {
  items: DocumentOrderItem[];
  quantityLabel?: string;
  getQuantity?: (item: DocumentOrderItem) => number;
  // Колонки "Артикул" и "Бренд" можно скрыть целиком (кнопка
  // "Редактировать" в components/PrintDocumentsPanel.tsx) — например,
  // чтобы не показывать клиенту внутренние артикулы поставщика или
  // не палить, у какого бренда куплена деталь. По умолчанию обе
  // показаны — это прежнее поведение
  showArticle?: boolean;
  showBrand?: boolean;
}): string {
  const {
    items,
    quantityLabel = 'К-сть',
    getQuantity = (item) => item.quantity,
    showArticle = true,
    showBrand = true,
  } = options;

  const rows = items
    .map((item, index) => {
      const qty = getQuantity(item);
      const sum = item.price * qty;
      return `
    <tr>
      <td class="num">${index + 1}</td>
      ${showArticle ? `<td>${escapeHtml(item.article)}</td>` : ''}
      ${showBrand ? `<td>${escapeHtml(item.brand || '—')}</td>` : ''}
      <td>${escapeHtml(item.name || '—')}</td>
      <td class="num">${qty}</td>
      <td>шт.</td>
      <td class="num">${formatMoneyUah(item.price)}</td>
      <td class="num">${formatMoneyUah(sum)}</td>
    </tr>`;
    })
    .join('');

  return `
  <table class="items">
    <thead>
      <tr>
        <th class="num">№</th>
        ${showArticle ? '<th>Артикул</th>' : ''}
        ${showBrand ? '<th>Бренд</th>' : ''}
        <th>Найменування</th>
        <th class="num">${escapeHtml(quantityLabel)}</th>
        <th>Од.</th>
        <th class="num">Ціна, грн</th>
        <th class="num">Сума, грн</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

export function renderTotalsBlock(options: { totalAmount: number; wordsLine: string; grandLabel?: string }): string {
  const { totalAmount, wordsLine, grandLabel = 'Всього до сплати' } = options;

  return `
  <div class="totals">
    <div class="totals__box">
      <div class="totals__row grand">
        <span>${escapeHtml(grandLabel)}</span>
        <span>${formatMoneyUah(totalAmount)} грн</span>
      </div>
    </div>
  </div>
  <p class="totals__words">Сума прописом: ${escapeHtml(wordsLine)}</p>`;
}

export function renderSignaturesBlock(options: {
  company: CompanyRequisites;
  leftCaption: string;
  // Права підписна лінія потрібна не всім документам (наприклад,
  // рахунок-фактура підписується лише продавцем) — якщо не передано,
  // блок справа не малюється зовсім
  rightCaption?: string;
  qrDataUrl?: string;
  qrCaption?: string;
}): string {
  const { company, leftCaption, rightCaption, qrDataUrl, qrCaption } = options;

  return `
  <div class="signatures">
    <div class="signature-block">
      <div class="signature-line">
        ${company.stampUrl ? `<img class="signature-line__stamp" src="${escapeHtml(company.stampUrl)}" alt="">` : ''}
      </div>
      <p class="signature-caption">${escapeHtml(leftCaption)}${company.directorName ? ` — ${escapeHtml(company.directorName)}` : ''}</p>
    </div>
    ${
      qrDataUrl
        ? `<div class="qr-block"><img src="${qrDataUrl}" alt="QR"><span>${escapeHtml(qrCaption || '')}</span></div>`
        : ''
    }
    ${
      rightCaption
        ? `
    <div class="signature-block">
      <div class="signature-line"></div>
      <p class="signature-caption">${escapeHtml(rightCaption)}</p>
    </div>`
        : ''
    }
  </div>`;
}
