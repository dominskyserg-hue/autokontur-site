// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/orders/[id]/ttn-label
//
// Отдаёт готовую маркировку ТТН (PDF-наклейку) для печати — просто
// проксирует запрос к my.novaposhta.ua/orders/printDocument/... с
// нашим API-ключом. Ключ никогда не попадает в браузер: если бы
// ссылка на печать вела прямо на my.novaposhta.ua с apiKey в самом
// URL, ключ был бы виден в адресной строке и истории браузера
// оператора — вместо этого сервер сам скачивает PDF и отдаёт байты
// ============================================================

import { NextResponse } from 'next/server';
import { Pool } from 'pg';

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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Інтеграція з Новою Поштою не налаштована.' }, { status: 500 });
  }

  try {
    const orderResult = await pool.query(`SELECT ttn_ref, order_number FROM orders WHERE id = $1`, [id]);
    const ttnRef = orderResult.rows[0]?.ttn_ref;
    const orderNumber = orderResult.rows[0]?.order_number ?? id.slice(0, 8);
    if (!ttnRef) {
      return NextResponse.json({ error: 'У этого заказа ещё нет ТТН, созданной через Нову Пошту.' }, { status: 404 });
    }

    const printUrl = `https://my.novaposhta.ua/orders/printDocument/orders[]/${encodeURIComponent(ttnRef)}/type/pdf/apiKey/${apiKey}`;
    const response = await fetch(printUrl);
    if (!response.ok) {
      throw new Error(`Нова Пошта повернула статус ${response.status}`);
    }

    const pdf = await response.arrayBuffer();

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="ttn_zamovlennya_${orderNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Ошибка при получении маркировки ТТН:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить маркировку: ' + message }, { status: 502 });
  }
}
