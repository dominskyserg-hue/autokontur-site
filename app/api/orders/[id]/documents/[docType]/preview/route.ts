// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/documents/[docType]/preview
//
// Возвращает готовый HTML документа (рахунок-фактура / видаткова
// накладна / акт повернення) — админка вставляет его в <iframe>
// модального окна предпросмотра (components/PrintDocumentsPanel.tsx)
// через srcDoc, оттуда же по кнопке "Печать" вызывается
// iframe.contentWindow.print() — обычная печать браузера тем же
// HTML, без обращения к серверу за PDF.
//
// Для акта повернення (docType = 'return_act') тело запроса — JSON
// { items: [{ article, quantity }], reason } — обязательно при
// ПЕРВОМ формировании акта для этого заказа; при повторном открытии
// уже сохранённого акта тело можно не передавать вовсе (см.
// lib/documents/requestValidation.ts)
// ============================================================

import { NextResponse } from 'next/server';
import { resolveDocumentData } from '@/lib/documents/requestValidation';
import { renderDocumentHtml } from '@/lib/documents/renderDocumentHtml';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string; docType: string }> }) {
  const { id, docType } = await params;

  const resolved = await resolveDocumentData(id, docType, request);
  if ('error' in resolved) return resolved.error;

  try {
    const html = await renderDocumentHtml(resolved.data);
    return NextResponse.json({ success: true, html, number: resolved.data.number });
  } catch (error) {
    console.error('Ошибка при рендере предпросмотра документа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось построить предпросмотр документа: ' + message }, { status: 500 });
  }
}
