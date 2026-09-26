// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/documents/[docType]/save
//
// Необязательный шаг (кнопка "Сохранить в заказ" в
// components/PrintDocumentsPanel.tsx) — генерирует PDF и загружает
// его в Vercel Blob (то же хранилище, что и для фото товаров, см.
// lib/imageStorage.ts), а ссылку сохраняет в order_documents.file_url
// (секция 30.4 schema.sql). В отличие от /preview и /download, этот
// шаг не обязателен для печати/скачивания — они всегда генерируют
// PDF заново "на лету" и никуда его не кладут
// ============================================================

import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { resolveDocumentData } from '@/lib/documents/requestValidation';
import { renderDocumentHtml } from '@/lib/documents/renderDocumentHtml';
import { renderHtmlToPdf } from '@/lib/documents/renderPdf';
import { saveDocumentFileUrl } from '@/lib/documents/numbering';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; docType: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const { id, docType } = await params;

  const resolved = await resolveDocumentData(id, docType, request);
  if ('error' in resolved) return resolved.error;

  try {
    const html = await renderDocumentHtml(resolved.data);
    const pdf = await renderHtmlToPdf(html);

    const blob = await put(`order-documents/${docType}/${id}.pdf`, pdf, {
      access: 'public',
      contentType: 'application/pdf',
      // allowOverwrite — при повторном сохранении того же документа
      // (например, после изменения состава заказа) файл по тому же
      // пути должен именно перезаписаться, а не упасть с ошибкой
      // "файл уже существует"
      allowOverwrite: true,
    });

    await saveDocumentFileUrl(id, resolved.data.docType, blob.url);

    return NextResponse.json({ success: true, url: blob.url, number: resolved.data.number });
  } catch (error) {
    console.error('Ошибка при сохранении PDF документа:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сохранить документ: ' + message }, { status: 500 });
  }
}
