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
import { createInternetDocument, type SenderInfo } from '@/lib/novaPoshta/createDocument';
import { loadSenderOptions } from '@/lib/novaPoshta/sender';
import { NovaPoshtaApiError } from '@/lib/novaPoshta/api';
import { notifyCustomerTtnAssigned } from '@/lib/orderNotifications';
import { requireAdmin } from '@/lib/adminAuth';
import { logOrderEvent } from '@/lib/orderHistory';

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
  // Післяплата, грн (необов'язково; 0 — без післяплати)
  codAmount?: number;
  // «Контроль оплати», грн (необов'язково). Не поєднується з післяплатою
  paymentControlAmount?: number;
  // Інший відправник для цієї ТТН (необов'язково): контактна особа та
  // адреса забору з списку, який віддає API Нової Пошти. Якщо не
  // передано — беруться дані з Налаштувань
  senderContactRef?: string;
  senderAddressRef?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

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

  const codAmount = body.codAmount === undefined || body.codAmount === null ? 0 : Number(body.codAmount);
  if (!Number.isFinite(codAmount) || codAmount < 0) {
    return NextResponse.json({ error: 'Сума післяплати має бути числом не менше нуля.' }, { status: 400 });
  }
  const paymentControlAmount =
    body.paymentControlAmount === undefined || body.paymentControlAmount === null ? 0 : Number(body.paymentControlAmount);
  if (!Number.isFinite(paymentControlAmount) || paymentControlAmount < 0) {
    return NextResponse.json({ error: 'Сума контролю оплати має бути числом не менше нуля.' }, { status: 400 });
  }
  if (codAmount > 0 && paymentControlAmount > 0) {
    return NextResponse.json(
      { error: 'Післяплата й контроль оплати не поєднуються — оберіть щось одне.' },
      { status: 400 }
    );
  }
  // Нова Пошта не приймає післяплату (або контроль оплати), більшу за
  // оголошену вартість посилки, — тому оголошену вартість піднімаємо
  // до цієї суми
  const declaredCost = Math.max(cost, Math.ceil(Math.max(codAmount, paymentControlAmount)));

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

    // Відправник за замовчуванням — з Налаштувань
    let sender: SenderInfo = {
      senderRef: s.np_sender_ref,
      contactSenderRef: s.np_contact_sender_ref,
      sendersPhone: s.np_senders_phone || '',
      senderAddressRef: s.np_sender_address_ref,
      citySenderRef: s.np_city_sender_ref,
    };

    // Якщо оператор обрав іншого відправника прямо в формі ТТН — беремо
    // його з API Нової Пошти (а не довіряємо Ref'ам з браузера наосліп):
    // так у ТТН не потрапить контакт чи адреса, яких немає в нашому акаунті
    const wantContact = body.senderContactRef || s.np_contact_sender_ref;
    const wantAddress = body.senderAddressRef || s.np_sender_address_ref;
    if (wantContact !== s.np_contact_sender_ref || wantAddress !== s.np_sender_address_ref) {
      const options = await loadSenderOptions();
      const contact = options.contacts.find((c) => c.ref === wantContact);
      const address = options.addresses.find((a) => a.ref === wantAddress);
      if (!contact || !address) {
        return NextResponse.json(
          { error: 'Обраного відправника або адреси забору немає в акаунті Нової Пошти. Оновіть список і виберіть знову.' },
          { status: 400 }
        );
      }
      sender = {
        senderRef: options.senderRef,
        contactSenderRef: contact.ref,
        sendersPhone: contact.phone || s.np_senders_phone || '',
        senderAddressRef: address.ref,
        citySenderRef: address.cityRef,
      };
    }

    const { ttnNumber, ttnRef } = await createInternetDocument({
      sender,
      recipient: {
        firstName: order.customer_name,
        lastName: order.customer_surname,
        phone: order.customer_phone,
        cityRef: body.recipientCityRef,
        warehouseRef: body.recipientWarehouseRef,
      },
      weight,
      seatsAmount,
      cost: declaredCost,
      payerType,
      description: body.description?.trim() || 'Запчастини',
      codAmount,
      paymentControlAmount,
    });

    await pool.query(`UPDATE orders SET ttn_number = $2, ttn_ref = $3, updated_at = now() WHERE id = $1`, [
      id,
      ttnNumber,
      ttnRef,
    ]);

    after(() => notifyCustomerTtnAssigned(order.id, order.customer_phone, ttnNumber));
    await logOrderEvent(
      order.id,
      `Створено ТТН через Нову Пошту: ${ttnNumber}` +
        (codAmount > 0
          ? ` (післяплата ${Math.round(codAmount)} грн)`
          : paymentControlAmount > 0
            ? ` (контроль оплати ${Math.round(paymentControlAmount)} грн)`
            : ' (без післяплати)')
    );

    return NextResponse.json({ success: true, ttnNumber, ttnRef });
  } catch (error) {
    console.error('Ошибка при создании ТТН Новой Почты:', error);
    const message = error instanceof NovaPoshtaApiError || error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось создать ТТН: ' + message }, { status: 502 });
  }
}
