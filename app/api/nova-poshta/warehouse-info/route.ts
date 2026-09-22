// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/nova-poshta/warehouse-info?city=<текст>&address=<текст>
//
// Отдаёт контактный телефон конкретного відділення Нової Пошти — для
// карточки заказа (components/OrderDetailsModal.tsx), чтобы оператор
// мог сразу позвонить в отделение, куда едет посылка.
//
// В заказе (таблица orders) хранится ТОЛЬКО текст города и відділення
// (nova_poshta_address) — без Ref, поэтому телефон приходится искать
// заново, тем же способом, каким Нова Пошта ищется в самой корзине
// (components/NovaPoshtaAddressFields.tsx):
//   1. Address.getCities  — находим Ref города по названию
//   2. Address.getWarehouses — находим само відділення по тексту
//      адреси внутри этого города и берём его поле Phone
//
// Если что-то не нашлось (Нова Пошта недоступна, текст неточный,
// відділення закрылось) — отдаём phone: null, а не ошибку: это
// дополнительная, не критичная для просмотра заказа информация
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const NOVA_POSHTA_API_URL = 'https://api.novaposhta.ua/v2.0/json/';

interface NovaPoshtaApiResponse<T> {
  success: boolean;
  data: T[];
  errors: string[];
  warnings: string[];
}

interface NovaPoshtaCityRaw {
  Ref: string;
}

interface NovaPoshtaWarehouseRaw {
  Ref: string;
  Description: string;
  Phone: string;
}

async function callNovaPoshta<T>(
  apiKey: string,
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, unknown>
): Promise<T[]> {
  const response = await fetch(NOVA_POSHTA_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
  });

  if (!response.ok) {
    throw new Error(`Нова Пошта повернула статус ${response.status}`);
  }

  const data = (await response.json()) as NovaPoshtaApiResponse<T>;
  if (!data.success) {
    throw new Error(data.errors?.[0] || 'Нова Пошта повернула помилку');
  }

  return data.data;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: true, phone: null });
  }

  const cityRaw = (request.nextUrl.searchParams.get('city') || '').trim();
  const address = (request.nextUrl.searchParams.get('address') || '').trim();

  if (!cityRaw || !address) {
    return NextResponse.json({ success: true, phone: null });
  }

  // Заказ хранит город ровно в том виде, в каком его формирует
  // GET /api/nova-poshta/cities ("Вінниця, Вінницька обл.") — область
  // дописана для наглядности в списке подсказок, но сама Нова Пошта
  // по такой составной строке уже ничего не находит. Для пошуку
  // потрібна лише назва міста до першої коми
  const city = cityRaw.split(',')[0].trim();

  try {
    const cities = await callNovaPoshta<NovaPoshtaCityRaw>(apiKey, 'Address', 'getCities', {
      FindByString: city,
      Limit: '1',
    });

    const cityRef = cities[0]?.Ref;
    if (!cityRef) {
      return NextResponse.json({ success: true, phone: null });
    }

    const warehouses = await callNovaPoshta<NovaPoshtaWarehouseRaw>(apiKey, 'Address', 'getWarehouses', {
      CityRef: cityRef,
      FindByString: address,
      Limit: '5',
    });

    // Серед знайдених варіантів беремо найточніший збіг за текстом
    // адреси (замовлення зберігає рівно той Description, який покупець
    // обрав у списку при оформленні) — а якщо точного збігу немає,
    // перший результат пошуку все одно найближчий до потрібного
    const exactMatch = warehouses.find(
      (w) => w.Description.trim().toLowerCase() === address.toLowerCase()
    );
    const warehouse = exactMatch || warehouses[0];

    return NextResponse.json({ success: true, phone: warehouse?.Phone || null });
  } catch (error) {
    console.error('Ошибка при поиске телефона отделения Новой Почты:', error);
    // Не критично для просмотра заказа — отдаём пустой результат,
    // а не 5xx, чтобы карточка заказа не показывала лишнюю ошибку
    return NextResponse.json({ success: true, phone: null });
  }
}
