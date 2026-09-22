// ============================================================
// Данные ОТПРАВИТЕЛЯ (нашего магазина) в Новой Почте — используются
// в двух местах:
//   1. app/api/admin/nova-poshta/sender-options/route.ts — читает
//      список контактных лиц и адресов отправителя, чтобы админ
//      выбрал один из них в Настройках (components/NovaPoshtaSettingsForm.tsx)
//   2. app/api/orders/[id]/create-ttn/route.ts — при создании ТТН
//      берёт уже СОХРАНЁННЫЙ выбор из site_settings (не спрашивает
//      каждый раз заново)
//
// Ref самого отправителя (юрлица/ФОП) искать не нужно каждый раз —
// один ключ API Новой Почты всегда привязан ровно к одному
// зарегистрированному отправителю, поэтому getCounterparties(Sender)
// всегда возвращает один и тот же результат
// ============================================================

import { callNovaPoshtaApi } from './api';

interface CounterpartyRaw {
  Ref: string;
  Description: string;
  CounterpartyFullName: string;
}

interface ContactPersonRaw {
  Ref: string;
  Description: string;
  Phones: string;
}

interface AddressRaw {
  Ref: string;
  Description: string;
  CityRef: string;
  CityDescription: string;
}

export interface SenderContactOption {
  ref: string;
  label: string;
  phone: string;
}

export interface SenderAddressOption {
  ref: string;
  label: string;
  cityRef: string;
  cityLabel: string;
}

export interface SenderOptions {
  senderRef: string;
  senderLabel: string;
  contacts: SenderContactOption[];
  addresses: SenderAddressOption[];
}

// Резолвит Ref нашего единственного зарегистрированного отправителя
export async function resolveSenderRef(): Promise<{ ref: string; label: string }> {
  const [counterparty] = await callNovaPoshtaApi<CounterpartyRaw>('Counterparty', 'getCounterparties', {
    CounterpartyProperty: 'Sender',
    Page: '1',
  });

  if (!counterparty) {
    throw new Error('Не вдалося визначити відправника — перевірте NOVA_POSHTA_API_KEY.');
  }

  return { ref: counterparty.Ref, label: counterparty.CounterpartyFullName || counterparty.Description };
}

// Все доступные контактные лица и адреса забора посылки — для
// выпадающих списков в Настройках (админ выбирает один раз)
export async function loadSenderOptions(): Promise<SenderOptions> {
  const { ref: senderRef, label: senderLabel } = await resolveSenderRef();

  const [contactsRaw, addressesRaw] = await Promise.all([
    callNovaPoshtaApi<ContactPersonRaw>('Counterparty', 'getCounterpartyContactPersons', {
      Ref: senderRef,
      Page: '1',
    }),
    callNovaPoshtaApi<AddressRaw>('Counterparty', 'getCounterpartyAddresses', {
      Ref: senderRef,
      CounterpartyProperty: 'Sender',
    }),
  ]);

  return {
    senderRef,
    senderLabel,
    contacts: contactsRaw.map((c) => ({ ref: c.Ref, label: c.Description, phone: c.Phones })),
    addresses: addressesRaw.map((a) => ({
      ref: a.Ref,
      label: `${a.CityDescription} — ${a.Description}`,
      cityRef: a.CityRef,
      cityLabel: a.CityDescription,
    })),
  };
}
