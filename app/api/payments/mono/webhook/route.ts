// ============================================================
// POST /api/payments/mono/webhook — сюда mono присылает статус счёта
// (оплачен / ошибка / возврат). Адрес передаётся в mono при создании
// счёта (webHookUrl, lib/monoPay.ts).
//
// Подпись обязательна: заголовок X-Sign (ECDSA) проверяем открытым
// ключом mono ПО СЫРОМУ ТЕЛУ запроса. Без верной подписи — 403, и
// никто не сможет "оплатить" заказ поддельным запросом.
//
// Отвечаем 200 на любой корректно подписанный вебхук (mono повторяет
// запрос до 3 раз, пока не получит 200). Оплата записывается ровно
// один раз (applyInvoiceStatus), повторы безвредны. Если внутренняя
// обработка упала — отвечаем 500, чтобы mono повторил попытку.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { applyInvoiceStatus, isMonoPayEnabled, verifyWebhookSignature, type MonoInvoiceData } from '@/lib/monoPay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isMonoPayEnabled()) {
    return NextResponse.json({ error: 'disabled' }, { status: 503 });
  }

  const rawBody = await request.text();
  let signatureOk = false;
  try {
    signatureOk = await verifyWebhookSignature(rawBody, request.headers.get('x-sign'));
  } catch (error) {
    console.error('Ошибка проверки подписи вебхука mono:', error);
    return NextResponse.json({ error: 'verification failed' }, { status: 500 });
  }
  if (!signatureOk) {
    return NextResponse.json({ error: 'bad signature' }, { status: 403 });
  }

  let data: MonoInvoiceData;
  try {
    data = JSON.parse(rawBody) as MonoInvoiceData;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!data.invoiceId || !data.status) {
    return NextResponse.json({ error: 'bad payload' }, { status: 400 });
  }

  try {
    await applyInvoiceStatus(data);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Не удалось обработать вебхук mono:', error);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
}
