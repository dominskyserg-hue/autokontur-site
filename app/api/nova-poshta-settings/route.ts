// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/nova-poshta-settings
//
// Сохранённый ОДИН РАЗ выбор отправителя для создания ТТН — тот же
// синглтон site_settings (id = 1), что и реквизиты компании
// (app/api/company-requisites/route.ts) и контакты магазина
// (app/api/site-settings/route.ts). Заполняется через
// components/NovaPoshtaSettingsForm.tsx на экране "Настройки".
//
//   GET   — текущий выбор (или null-поля, если ещё не настроено)
//   PATCH — сохранить выбранные Ref'ы (senderRef резолвится сам,
//           см. lib/novaPoshta/sender.ts — руками его не передают)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
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

interface PatchBody {
  senderRef: string;
  contactSenderRef: string;
  contactSenderLabel: string;
  sendersPhone: string;
  senderAddressRef: string;
  citySenderRef: string;
  senderAddressLabel: string;
}

function rowToSettings(row: Record<string, unknown> | undefined) {
  return {
    senderRef: row?.np_sender_ref ?? null,
    contactSenderRef: row?.np_contact_sender_ref ?? null,
    contactSenderLabel: row?.np_contact_sender_label ?? null,
    sendersPhone: row?.np_senders_phone ?? null,
    senderAddressRef: row?.np_sender_address_ref ?? null,
    citySenderRef: row?.np_city_sender_ref ?? null,
    senderAddressLabel: row?.np_sender_address_label ?? null,
  };
}

export async function GET() {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  try {
    const result = await pool.query(
      `SELECT np_sender_ref, np_contact_sender_ref, np_contact_sender_label, np_senders_phone,
              np_sender_address_ref, np_city_sender_ref, np_sender_address_label
       FROM site_settings WHERE id = 1`
    );
    return NextResponse.json({ success: true, settings: rowToSettings(result.rows[0]) });
  } catch (error) {
    console.error('Ошибка при получении настроек Новой Почты:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось получить настройки: ' + message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const adminDenied = await requireAdmin();
  if (adminDenied) return adminDenied;

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  if (!body.senderRef || !body.contactSenderRef || !body.senderAddressRef || !body.citySenderRef) {
    return NextResponse.json(
      { error: 'Передайте отправителя, контактное лицо и адрес забора посылки.' },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO site_settings (id, np_sender_ref, np_contact_sender_ref, np_contact_sender_label, np_senders_phone,
                                  np_sender_address_ref, np_city_sender_ref, np_sender_address_label)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        np_sender_ref = $1,
        np_contact_sender_ref = $2,
        np_contact_sender_label = $3,
        np_senders_phone = $4,
        np_sender_address_ref = $5,
        np_city_sender_ref = $6,
        np_sender_address_label = $7,
        updated_at = now()
      RETURNING np_sender_ref, np_contact_sender_ref, np_contact_sender_label, np_senders_phone,
                np_sender_address_ref, np_city_sender_ref, np_sender_address_label
      `,
      [
        body.senderRef,
        body.contactSenderRef,
        body.contactSenderLabel || null,
        body.sendersPhone || null,
        body.senderAddressRef,
        body.citySenderRef,
        body.senderAddressLabel || null,
      ]
    );

    return NextResponse.json({ success: true, settings: rowToSettings(result.rows[0]) });
  } catch (error) {
    console.error('Ошибка при сохранении настроек Новой Почты:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json({ error: 'Не удалось сохранить настройки: ' + message }, { status: 500 });
  }
}
