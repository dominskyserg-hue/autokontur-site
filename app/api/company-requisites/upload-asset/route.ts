// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/company-requisites/upload-asset
//
// Загрузка логотипа (в шапку документа) или печати/подписи (файл
// с прозрачным фоном, накладывается поверх линии подписи — см.
// .signature-line__stamp в lib/documents/layout.ts) — тот же подход,
// что и для фото товара: файл приходит data:-URI, перекодируется в
// WebP и заливается в Vercel Blob (lib/imageStorage.ts).
//
// Тело запроса: { kind: 'logo' | 'stamp', imageDataUrl: 'data:image/...' }
// Ответ: { success: true, url } — фронтенд сам сохраняет этот url
// полем logoUrl/stampUrl через PATCH /api/company-requisites
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { convertToWebp } from '@/lib/imageProcessing';
import { saveCompanyAsset } from '@/lib/imageStorage';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

interface UploadAssetBody {
  kind: 'logo' | 'stamp';
  imageDataUrl: string;
}

export async function POST(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  let body: UploadAssetBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (body.kind !== 'logo' && body.kind !== 'stamp') {
    return NextResponse.json({ error: 'Поле kind должно быть "logo" или "stamp".' }, { status: 400 });
  }

  const match = (body.imageDataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) {
    return NextResponse.json({ error: 'Не удалось распознать загруженное изображение.' }, { status: 400 });
  }

  try {
    const webp = await convertToWebp(Buffer.from(match[1], 'base64'));
    const url = await saveCompanyAsset(webp, body.kind);
    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error('Ошибка при загрузке логотипа/печати:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сохранить изображение: ' + message }, { status: 500 });
  }
}
