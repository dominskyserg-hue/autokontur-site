// ============================================================
// Шаблон "Акт звірки взаєморозрахунків" — выписка по клиенту за
// период: с каким долгом (или предоплатой) клиент начал период, все
// операции за период (отгрузки, оплаты, возвраты, корректировки) и
// с каким балансом закончил. Отдаётся клиенту, если он сомневается в
// сумме долга, — каждая строка видна с датой и номером заказа.
//
// Язык документа — украинский, как и у остальных печатных форм
// (счёт, накладная, акт возврата). Данные собирает
// app/api/admin/customers/[id]/reconciliation/route.ts.
//
// Знак суммы — как в customer_transactions.amount (schema.sql):
//   + увеличивает долг клиента (отгрузка) — колонка "Дебет";
//   − уменьшает долг клиента (оплата, возврат) — колонка "Кредит".
// ============================================================

import { renderDocumentShell, formatDateUa, formatMoneyUah, escapeHtml } from './layout';
import { renderSignaturesBlock } from './partials';
import type { CompanyRequisites } from './companySettings';

export interface ReconciliationRow {
  createdAt: string;
  type: string;
  amount: number;
  orderNumber: number | null;
  comment: string | null;
}

export interface ReconciliationActData {
  company: CompanyRequisites;
  customer: { name: string; surname: string | null; phone: string };
  dateFrom: string; // ГГГГ-ММ-ДД
  dateTo: string; // ГГГГ-ММ-ДД
  openingBalance: number; // баланс на начало периода (+ клиент должен)
  rows: ReconciliationRow[];
}

// Как называется каждый тип операции в документе
const TYPE_LABELS: Record<string, string> = {
  shipment: 'Відвантаження',
  prepayment: 'Оплата',
  return_refund: 'Повернення товару',
  adjustment: 'Коригування',
  cash_payment: 'Оплата готівкою',
};

// Как понятно написать баланс словами: кто кому должен
function describeBalance(balance: number): string {
  if (balance > 0) return `заборгованість покупця ${formatMoneyUah(balance)} грн`;
  if (balance < 0) return `передоплата покупця ${formatMoneyUah(-balance)} грн`;
  return 'заборгованість відсутня (0,00 грн)';
}

export function renderReconciliationActHtml(data: ReconciliationActData): string {
  const { company, customer, dateFrom, dateTo, openingBalance, rows } = data;

  const totalDebit = rows.filter((r) => r.amount > 0).reduce((sum, r) => sum + r.amount, 0);
  const totalCredit = rows.filter((r) => r.amount < 0).reduce((sum, r) => sum - r.amount, 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;

  const sellerName = company.legalName || company.shopName;
  const customerName = `${customer.name} ${customer.surname || ''}`.trim();
  const period = `${formatDateUa(dateFrom)} — ${formatDateUa(dateTo)}`;

  const rowsHtml = rows
    .map((row) => {
      const title = [
        TYPE_LABELS[row.type] || row.type,
        row.orderNumber ? `за замовленням №${row.orderNumber}` : null,
      ]
        .filter(Boolean)
        .join(' ');
      return `
      <tr>
        <td>${escapeHtml(formatDateUa(row.createdAt))}</td>
        <td>${escapeHtml(title)}${row.comment ? `<br><span style="color:#5C6472">${escapeHtml(row.comment)}</span>` : ''}</td>
        <td class="num">${row.amount > 0 ? formatMoneyUah(row.amount) : ''}</td>
        <td class="num">${row.amount < 0 ? formatMoneyUah(-row.amount) : ''}</td>
      </tr>`;
    })
    .join('');

  const bodyHtml = `
  <div class="doc-header">
    <div class="doc-header__seller">
      ${company.logoUrl ? `<img class="doc-header__logo" src="${escapeHtml(company.logoUrl)}" alt="">` : ''}
      <div>
        <p class="doc-header__seller-name">${escapeHtml(sellerName)}</p>
        <div class="doc-header__seller-details">${company.phone ? `Тел.: ${escapeHtml(company.phone)}` : ''}</div>
      </div>
    </div>
    <div class="doc-header__title-block">
      <p class="doc-header__title">Акт звірки взаєморозрахунків</p>
      <p class="doc-header__date">за період ${escapeHtml(period)}</p>
    </div>
  </div>

  <div class="info-grid" style="grid-template-columns: 1fr;">
    <div class="info-grid__row">
      <span class="info-grid__label">Продавець:</span>
      <span class="info-grid__value">${escapeHtml(sellerName)}</span>
    </div>
    <div class="info-grid__row">
      <span class="info-grid__label">Покупець:</span>
      <span class="info-grid__value">${escapeHtml(customerName)}, тел. ${escapeHtml(customer.phone)}</span>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Дата</th>
        <th>Операція</th>
        <th class="num">Дебет, грн<br><span style="font-weight:400">(відвантажено)</span></th>
        <th class="num">Кредит, грн<br><span style="font-weight:400">(оплачено / повернено)</span></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="2"><b>Сальдо на ${escapeHtml(formatDateUa(dateFrom))}</b></td>
        <td class="num"><b>${openingBalance > 0 ? formatMoneyUah(openingBalance) : ''}</b></td>
        <td class="num"><b>${openingBalance < 0 ? formatMoneyUah(-openingBalance) : ''}</b></td>
      </tr>
      ${rowsHtml || '<tr><td colspan="4" style="color:#5C6472">За цей період операцій не було</td></tr>'}
      <tr>
        <td colspan="2"><b>Обороти за період</b></td>
        <td class="num"><b>${formatMoneyUah(totalDebit)}</b></td>
        <td class="num"><b>${formatMoneyUah(totalCredit)}</b></td>
      </tr>
      <tr>
        <td colspan="2"><b>Сальдо на ${escapeHtml(formatDateUa(dateTo))}</b></td>
        <td class="num"><b>${closingBalance > 0 ? formatMoneyUah(closingBalance) : ''}</b></td>
        <td class="num"><b>${closingBalance < 0 ? formatMoneyUah(-closingBalance) : ''}</b></td>
      </tr>
    </tbody>
  </table>

  <p class="totals__words">
    Станом на ${escapeHtml(formatDateUa(dateTo))}: ${escapeHtml(describeBalance(closingBalance))}.
  </p>

  ${renderSignaturesBlock({
    company,
    leftCaption: 'Від продавця',
    rightCaption: 'Від покупця (ПІБ, підпис)',
  })}
  <p class="doc-footer-note">
    Акт складено у двох примірниках — по одному для кожної зі сторін. Якщо у покупця є зауваження до суми,
    просимо повідомити протягом 5 робочих днів.
  </p>
  `;

  return renderDocumentShell({ title: `Акт звірки — ${customerName}`, bodyHtml });
}
