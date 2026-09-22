// ============================================================
// Общая "рамка" для всех трёх печатных документов — один HTML/CSS
// каркас (шрифты, цвета, сетка A4, стили таблицы и итогов), который
// каждый шаблон (invoiceTemplate.ts, deliveryNoteTemplate.ts,
// returnActTemplate.ts) наполняет своим содержимым.
//
// Один и тот же HTML используется ДВАЖДЫ: как обычная веб-страница
// в модальном окне предпросмотра (там же работает window.print()) и
// как вход для Puppeteer при генерации PDF (renderPdf.ts) — поэтому
// весь вид "как на бумаге" держится строго в CSS через @page и
// @media print, а не подгоняется отдельно под каждый способ показа.
// ============================================================

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatMoneyUah(value: number): string {
  return value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDateUa(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface DocumentShellOptions {
  title: string;
  accentColor?: string;
  bodyHtml: string;
}

export function renderDocumentShell({ title, accentColor = '#5B6EF5', bodyHtml }: DocumentShellOptions): string {
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: A4;
    margin: 15mm;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #FFFFFF;
    color: #161A21;
    font-family: 'Helvetica Neue', Arial, 'Segoe UI', sans-serif;
    font-size: 12px;
    line-height: 1.45;
  }

  .sheet {
    max-width: 190mm;
    margin: 0 auto;
    padding: 8mm 0;
  }

  .muted {
    color: #5C6472;
  }

  .faint {
    color: #8A93A2;
  }

  /* ---- шапка: логотип + реквізити зліва, назва/номер документа справа ---- */
  .doc-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 2px solid ${accentColor};
    margin-bottom: 14px;
  }

  .doc-header__seller {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }

  .doc-header__logo {
    width: 52px;
    height: 52px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .doc-header__seller-name {
    font-size: 14px;
    font-weight: 700;
    margin: 0 0 3px;
  }

  .doc-header__seller-details {
    font-size: 10.5px;
    color: #5C6472;
    max-width: 100mm;
  }

  .doc-header__title-block {
    text-align: right;
  }

  .doc-header__title {
    font-size: 18px;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: ${accentColor};
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  .doc-header__number {
    font-size: 12px;
    font-weight: 600;
  }

  .doc-header__date {
    font-size: 11px;
    color: #5C6472;
  }

  /* ---- блок клієнта ---- */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 24px;
    padding: 10px 12px;
    background: #F5F6F8;
    border-radius: 6px;
    margin-bottom: 14px;
    font-size: 11.5px;
  }

  .info-grid__row {
    display: flex;
    gap: 6px;
  }

  .info-grid__label {
    color: #5C6472;
    white-space: nowrap;
  }

  .info-grid__value {
    font-weight: 600;
  }

  /* ---- табличний блок позицій ---- */
  table.items {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
  }

  table.items thead th {
    background: ${accentColor};
    color: #FFFFFF;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    text-align: left;
    padding: 7px 8px;
  }

  table.items thead th.num,
  table.items tbody td.num {
    text-align: right;
  }

  table.items tbody td {
    padding: 6px 8px;
    border-bottom: 1px solid #E4E7EC;
    font-size: 11px;
    page-break-inside: avoid;
  }

  table.items tbody tr:nth-child(even) {
    background: #FAFBFC;
  }

  /* ---- підсумковий блок ---- */
  .totals {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
  }

  .totals__box {
    min-width: 70mm;
  }

  .totals__row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 11.5px;
  }

  .totals__row.grand {
    border-top: 2px solid ${accentColor};
    margin-top: 4px;
    padding-top: 7px;
    font-size: 15px;
    font-weight: 800;
  }

  .totals__words {
    font-size: 11px;
    font-style: italic;
    color: #5C6472;
    margin: 8px 0 16px;
    page-break-inside: avoid;
  }

  /* ---- підписи, печатка, QR ---- */
  .signatures {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: 26px;
    page-break-inside: avoid;
  }

  .signature-block {
    width: 44%;
    font-size: 11px;
  }

  .signature-line {
    position: relative;
    border-bottom: 1px solid #161A21;
    height: 34px;
  }

  .signature-line__stamp {
    position: absolute;
    bottom: -6px;
    left: 30%;
    width: 46mm;
    opacity: 0.92;
    pointer-events: none;
  }

  .signature-caption {
    margin-top: 4px;
    color: #5C6472;
    font-size: 10px;
  }

  .qr-block {
    text-align: center;
    font-size: 9.5px;
    color: #5C6472;
    width: 26mm;
  }

  .qr-block img {
    width: 26mm;
    height: 26mm;
    display: block;
    margin-bottom: 4px;
  }

  .doc-footer-note {
    margin-top: 18px;
    font-size: 9.5px;
    color: #8A93A2;
  }

  @media print {
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
  <div class="sheet">
    ${bodyHtml}
  </div>
</body>
</html>`;
}
