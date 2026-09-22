// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/documents/[docType]/download
//
// Генерирует PDF того же документа, что и /preview (тот же HTML,
// см. комментарий там), и отдаёт его файлом на скачивание —
// Content-Type: application/pdf, Content-Disposition: attachment.
//
// maxDuration увеличен — запуск headless-браузера (Puppeteer) и
// рендер PDF на serverless-функции занимает заметно больше времени,
// чем обычный ответ API (по умолчанию Vercel даёт всего 10 секунд)
// ============================================================

import { NextResponse } from 'next/server';
import { resolveDocumentData } from '@/lib/documents/requestValidation';
import { renderDocumentHtml } from '@/lib/documents/renderDocumentHtml';
import { renderHtmlToPdf } from '@/lib/documents/renderPdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

const FILENAME_PREFIX: Record<string, string> = {
  invoice: 'raxunok',
  delivery_note: 'nakladna',
  return_act: 'akt_povernennya',
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string; docType: string }> }) {
  const { id, docType } = await params;

  const resolved = await resolveDocumentData(id, docType, request);
  if ('error' in resolved) return resolved.error;

  try {
    const html = await renderDocumentHtml(resolved.data);
    const pdf = await renderHtmlToPdf(html);

    const filename = `${FILENAME_PREFIX[docType] || 'document'}_${resolved.data.order.shortId}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Ошибка при генерации PDF документа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сформировать PDF: ' + message }, { status: 500 });
  }
}
