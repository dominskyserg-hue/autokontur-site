// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/admin/shipping/labels?ids=<id1>,<id2>,...
//
// Маркировки ТТН сразу для нескольких заказов ОДНИМ PDF-файлом —
// чтобы не открывать и не печатать каждую наклейку по отдельности.
// Работает так же, как печать одной маркировки
// (app/api/orders/[id]/ttn-label/route.ts): сервер сам скачивает PDF
// у Новой Почты со своим API-ключом, ключ в браузер не попадает.
// Каждую наклейку скачиваем отдельным запросом (тем же адресом, что и
// для одного заказа — он точно работает), а потом склеиваем все
// страницы в один файл библиотекой pdf-lib.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { PDFDocument } from 'pdf-lib';
import { requireAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });
globalThis.pgPool = pool;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Сколько наклеек максимум в одном файле — длинный адрес печати у
// Новой Почты тоже имеет предел, а больше за раз и не печатают
const MAX_LABELS = 50;

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  const ids = (request.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ error: 'Не выбрано ни одного заказа.' }, { status: 400 });
  }
  if (ids.length > MAX_LABELS) {
    return NextResponse.json({ error: `За один раз можно напечатать не больше ${MAX_LABELS} наклеек.` }, { status: 400 });
  }
  if (!ids.every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'Некорректный id заказа в списке.' }, { status: 400 });
  }

  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Інтеграція з Новою Поштою не налаштована.' }, { status: 500 });
  }

  try {
    const result = await pool.query(
      `SELECT ttn_ref FROM orders WHERE id = ANY($1::uuid[]) AND ttn_ref IS NOT NULL ORDER BY created_at ASC`,
      [ids]
    );
    const refs: string[] = result.rows.map((row) => row.ttn_ref);

    if (refs.length === 0) {
      return NextResponse.json(
        { error: 'У выбранных заказов нет ТТН, созданных через Нову Пошту.' },
        { status: 404 }
      );
    }

    // Скачиваем наклейки по очереди, а не все разом: Новая Почта
    // ограничивает частоту запросов, а 10-20 наклеек по очереди — это
    // всё равно пара секунд
    const merged = await PDFDocument.create();
    for (const ref of refs) {
      const printUrl = `https://my.novaposhta.ua/orders/printDocument/orders[]/${encodeURIComponent(ref)}/type/pdf/apiKey/${apiKey}`;
      const response = await fetch(printUrl);
      if (!response.ok) {
        throw new Error(`Нова Пошта повернула статус ${response.status}`);
      }
      const single = await PDFDocument.load(await response.arrayBuffer());
      const pages = await merged.copyPages(single, single.getPageIndices());
      pages.forEach((page) => merged.addPage(page));
    }

    const pdf = await merged.save();

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ttn_${refs.length}_sht.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Ошибка при получении маркировок ТТН пачкой:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить маркировки: ' + message }, { status: 502 });
  }
}
