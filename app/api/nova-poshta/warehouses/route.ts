// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/nova-poshta/warehouses?cityRef=<Ref>&q=<пошук>
//
// Проксі до офіційного API Нової Пошти — список відділень/поштоматів
// обраного міста, для поля "Відділення / поштомат" у кошику
// (components/NovaPoshtaAddressFields.tsx). cityRef — це Ref міста,
// який повертає GET /api/nova-poshta/cities (сусідній роут); q —
// необов'язковий текст для звуження списку (номер відділення, вулиця).
//
// Той самий принцип, що і в сусідньому cities/route.ts: ключ API
// (NOVA_POSHTA_API_KEY) лишається тільки на сервері
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const NOVA_POSHTA_API_URL = 'https://api.novaposhta.ua/v2.0/json/';

// Формат одного відділення у відповіді Address.getWarehouses —
// перелічені лише поля, які реально використовуються нижче
interface NovaPoshtaWarehouseRaw {
  Ref: string;
  Description: string;
  Number: string;
  CategoryOfWarehouse: string;
}

interface NovaPoshtaApiResponse<T> {
  success: boolean;
  data: T[];
  errors: string[];
  warnings: string[];
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.NOVA_POSHTA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Пошук відділень Нової Пошти тимчасово недоступний (не налаштовано NOVA_POSHTA_API_KEY).' },
      { status: 500 }
    );
  }

  const cityRef = (request.nextUrl.searchParams.get('cityRef') || '').trim();
  if (!cityRef) {
    return NextResponse.json({ error: 'Спочатку оберіть місто.' }, { status: 400 });
  }

  const query = (request.nextUrl.searchParams.get('q') || '').trim();

  try {
    const response = await fetch(NOVA_POSHTA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName: 'Address',
        calledMethod: 'getWarehouses',
        methodProperties: {
          CityRef: cityRef,
          // FindByString порожнім рядком Нова Пошта теж приймає — це
          // означає "без фільтра", тобто просто весь список відділень
          FindByString: query,
          Limit: '50',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Нова Пошта повернула статус ${response.status}`);
    }

    const data = (await response.json()) as NovaPoshtaApiResponse<NovaPoshtaWarehouseRaw>;

    if (!data.success) {
      throw new Error(data.errors?.[0] || 'Нова Пошта повернула помилку');
    }

    // Поштомати Нова Пошта віддає в тому самому списку, під іншою
    // категорією (CategoryOfWarehouse === 'Postomat') — розрізняти їх
    // тут не треба, покупцю все одно бачити один загальний список
    const warehouses = data.data.map((w) => ({
      ref: w.Ref,
      description: w.Description,
      isPostomat: w.CategoryOfWarehouse === 'Postomat',
    }));

    return NextResponse.json({ success: true, warehouses });
  } catch (error) {
    console.error('Ошибка при поиске отделений Новой Почты:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося знайти відділення: ' + message }, { status: 502 });
  }
}
