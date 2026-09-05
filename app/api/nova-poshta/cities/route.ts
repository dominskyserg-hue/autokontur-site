// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/nova-poshta/cities?q=Київ
//
// Проксі до офіційного API Нової Пошти (api.novaposhta.ua) — шукає
// населені пункти за введеним текстом, для автопідказки поля "Місто"
// в кошику (components/StorefrontHome.tsx, компонент
// components/NovaPoshtaAddressFields.tsx).
//
// ВАЖЛИВО: сам запит до Нової Пошти йде ЛИШЕ звідси, з сервера, а не
// напряму з браузера покупця — так ключ API (NOVA_POSHTA_API_KEY,
// .env.local) ніколи не потрапляє в код, що виконується в браузері.
// Саме тому змінна БЕЗ префікса NEXT_PUBLIC_ (на відміну від
// NEXT_PUBLIC_GA_MEASUREMENT_ID тощо в app/layout.tsx, які навпаки
// повинні бути видні браузеру).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const NOVA_POSHTA_API_URL = 'https://api.novaposhta.ua/v2.0/json/';

// Формат однієї адреси у відповіді Address.getCities від Нової Пошти —
// перелічені лише поля, які реально використовуються нижче
interface NovaPoshtaCityRaw {
  Ref: string;
  Description: string;
  AreaDescription?: string;
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
      { error: 'Пошук міст Нової Пошти тимчасово недоступний (не налаштовано NOVA_POSHTA_API_KEY).' },
      { status: 500 }
    );
  }

  const query = (request.nextUrl.searchParams.get('q') || '').trim();
  // Менше 2 символів — запит до Нової Пошти майже завжди повертає або
  // помилку, або занадто широкий список; простіше не питати зайвий раз
  if (query.length < 2) {
    return NextResponse.json({ success: true, cities: [] });
  }

  try {
    const response = await fetch(NOVA_POSHTA_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName: 'Address',
        calledMethod: 'getCities',
        methodProperties: {
          FindByString: query,
          Limit: '15',
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Нова Пошта повернула статус ${response.status}`);
    }

    const data = (await response.json()) as NovaPoshtaApiResponse<NovaPoshtaCityRaw>;

    if (!data.success) {
      throw new Error(data.errors?.[0] || 'Нова Пошта повернула помилку');
    }

    const cities = data.data.map((city) => ({
      ref: city.Ref,
      name: city.AreaDescription ? `${city.Description}, ${city.AreaDescription} обл.` : city.Description,
    }));

    return NextResponse.json({ success: true, cities });
  } catch (error) {
    console.error('Ошибка при поиске городов Новой Почты:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json({ error: 'Не вдалося знайти міста: ' + message }, { status: 502 });
  }
}
