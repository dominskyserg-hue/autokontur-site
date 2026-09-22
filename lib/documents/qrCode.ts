// ============================================================
// Генерация QR-кода прямо в data:-URI (PNG в base64) — так его можно
// вставить в HTML-шаблон документа обычным <img src="...">, без
// отдельного файла и загрузки в хранилище: QR нужен только внутри
// одного PDF и нигде больше не переиспользуется.
// ============================================================

import QRCode from 'qrcode';

export async function generateQrCodeDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 240,
    color: {
      dark: '#161A21',
      light: '#FFFFFF',
    },
  });
}
