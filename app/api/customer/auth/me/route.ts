// ============================================================
// GET /api/customer/auth/me — вошёл ли покупатель (для страницы
// кабинета и кнопки "в обране"). 200 { phone: "+380XXXXXXXXX" } —
// телефон из СЕССИИ; 401 — не вошёл; 403 — кабинет выключен
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getCustomerSessionPhoneFromRequest } from '@/lib/customerAuth';
import { CUSTOMER_CABINET_DISABLED_MESSAGE, isCustomerCabinetEnabled } from '@/lib/customerCabinet';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (!isCustomerCabinetEnabled()) {
    return NextResponse.json({ error: CUSTOMER_CABINET_DISABLED_MESSAGE }, { status: 403 });
  }
  const phone = await getCustomerSessionPhoneFromRequest(request);
  if (!phone) return NextResponse.json({ error: 'Увійдіть в особистий кабінет.' }, { status: 401 });
  return NextResponse.json({ success: true, phone: `+380${phone}` });
}
