// ============================================================
// GET /api/payments/mono/config — включена ли оплата картой (mono) на
// сайте. Корзина (components/StorefrontHome.tsx) по этому ответу решает,
// показывать ли выбор "Оплата карткою онлайн". Включается переменной
// окружения MONO_ACQUIRING_TOKEN (lib/monoPay.ts). Токен наружу не
// отдаётся — только да/нет.
// ============================================================

import { NextResponse } from 'next/server';
import { isMonoPayEnabled } from '@/lib/monoPay';

export const runtime = 'nodejs';
// Читается на каждый запрос: включение/выключение не требует пересборки
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ success: true, enabled: isMonoPayEnabled() });
}
