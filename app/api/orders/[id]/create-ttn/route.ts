// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: POST /api/orders/[id]/create-ttn
//
// Создаёт настоящую ТТН (экспресс-накладную) в Новой Почте через её
// официальное API — оператор больше не должен создавать её вручную
// на сайті Нової Пошти и переписывать номер. Данные отправителя
// (наш магазин) берутся уже готовыми из site_settings — их выбирают
// один раз в Настройках (components/NovaPoshtaSettingsForm.tsx,
// app/api/nova-poshta-settings/route.ts). Данные получателя —
// частично из заказа (имя, телефон), частично из тела запроса
// (город/отделение выбирает оператор в момент создания — при
// оформлении заказа сохраняется только текст адреса, а не Ref
// Новой Пошти, см. секцию 31 schema.sql).
//
// Тело запроса:
//   {
//     recipientCityRef, recipientWarehouseRef: string  — из пикера в форме
//     weight: number                                    — кг
//     seatsAmount: number                                — кол-во мест
//     cost: number                                        — оголошена вартість, грн
//     payerType: 'Sender' | 'Recipient'
//     description?: string
//   }
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { createInternetDocument } from '@/lib/novaPoshta/createDocument';
import { NovaPoshtaApiError } from '@/lib/novaPoshta/api';
import { notifyCustomerTtnAssigned } from '@/lib/orderNotifications';

export const runtime = 'nodejs';
export const maxDuration = 30;

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

interface CreateTtnBody {
  recipientCityRef?: string;
  recipientWarehouseRef?: string;
  weight?: number;
  seatsAmount?: number;
  cost?: number;
  payerType?: 'Sender' | 'Recipient';
  description?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 });
  }

  let body: CreateTtnBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.recipientCityRef || !body.recipientWarehouseRef) {
    return NextResponse.json({ error: 'Оберіть місто та відділення отримувача.' }, { status: 400 });
  }
  const weight = Number(body.weight);
  const seatsAmount = Number(body.seatsAmount);
  const cost = Number(body.cost);
  if (!Number.isFinite(weight) || weight <= 0) {
    return NextResponse.json({ error: 'Вага має бути додатним числом.' }, { status: 400 });
  }
  if (!Number.isInteger(seatsAmount) || seatsAmount <= 0) {
    return NextResponse.json({ error: 'Кількість місць має бути цілим числом більше нуля.' }, { status: 400 });
  }
  if (!Number.isFinite(cost) || cost <= 0) {
    return NextResponse.json({ error: 'Оголошена вартість має бути додатним числом.' }, { status: 400 });
  }
  const payerType = body.payerType === 'Sender' ? 'Sender' : 'Recipient';

  try {
    const orderResult = await pool.query(
      `SELECT id, customer_name, customer_surname, customer_phone, ttn_number
       FROM orders WHERE id = $1`,
      [id]
    );
    if (orderResult.rows.length === 0) {
      return NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 });
    }
    const order = orderResult.rows[0];

    if (order.ttn_number) {
      return NextResponse.json(
        {
          error:
            'У заказа уже есть ТТН. Если нужно создать новую, сначала аннулируйте старую в Новой Почте и очистите поле ТТН.',
        },
        { status: 400 }
      );
    }

    const settingsResult = await pool.query(
      `SELECT np_sender_ref, np_contact_sender_ref, np_senders_phone, np_sender_address_ref, np_city_sender_ref
       FROM site_settings WHERE id = 1`
    );
    const s = settingsResult.rows[0];
    if (!s?.np_sender_ref || !s.np_contact_sender_ref || !s.np_sender_address_ref || !s.np_city_sender_ref) {
      return NextResponse.json(
        { error: 'Спочатку налаштуйте відправника Нової Пошти в Настройках (розділ «Нова Пошта»).' },
        { status: 400 }
      );
    }

    const { ttnNumber, ttnRef } = await createInternetDocument({
      sender: {
        senderRef: s.np_sender_ref,
        contactSenderRef: s.np_contact_sender_ref,
        sendersPhone: s.np_senders_phone || '',
        senderAddressRef: s.np_sender_address_ref,
        citySenderRef: s.np_city_sender_ref,
      },
      recipient: {
        firstName: order.customer_name,
        lastName: order.customer_surname,
        phone: order.customer_phone,
        cityRef: body.recipientCityRef,
        warehouseRef: body.recipientWarehouseRef,
      },
      weight,
      seatsAmount,
      cost,
      payerType,
      description: body.description?.trim() || 'Запчастини',
    });

    await pool.query(`UPDATE orders SET ttn_number = $2, ttn_ref = $3, updated_at = now() WHERE id = $1`, [
      id,
      ttnNumber,
      ttnRef,
    ]);

    after(() => notifyCustomerTtnAssigned(order.id, order.customer_phone, ttnNumber));

    return NextResponse.json({ success: true, ttnNumber, ttnRef });
  } catch (error) {
    console.error('Ошибка при создании ТТН Новой Почты:', error);
    const message = error instanceof NovaPoshtaApiError || error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось создать ТТН: ' + message }, { status: 502 });
  }
}
