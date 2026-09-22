// ============================================================
// Создание ТТН (экспресс-накладной) в Новой Почте по заказу —
// используется app/api/orders/[id]/create-ttn/route.ts.
//
// Шаги (все — реальные запросы к API Новой Пошти):
//   1. Найти/создать получателя как Counterparty (PrivatePerson)
//   2. Получить его ContactPerson (Нова Пошта создаёт его сама при
//      сохранении получателя, но Ref нужно запросить отдельным вызовом)
//   3. Создать сам документ (InternetDocument.save) — данные
//      отправителя берутся уже готовыми из site_settings (настроены
//      один раз в Налаштуваннях, см. lib/novaPoshta/sender.ts)
// ============================================================

import { callNovaPoshtaApi, toNovaPoshtaPhone } from './api';

interface CounterpartySaveResult {
  Ref: string;
}

interface ContactPersonRaw {
  Ref: string;
}

interface InternetDocumentSaveResult {
  Ref: string;
  IntDocNumber: string;
  CostOnSite: number;
  EstimatedDeliveryDate: string;
}

export interface SenderInfo {
  senderRef: string;
  contactSenderRef: string;
  sendersPhone: string;
  senderAddressRef: string;
  citySenderRef: string;
}

export interface RecipientInfo {
  firstName: string;
  lastName: string;
  phone: string;
  cityRef: string;
  warehouseRef: string;
}

export interface CreateTtnParams {
  sender: SenderInfo;
  recipient: RecipientInfo;
  weight: number;
  seatsAmount: number;
  cost: number;
  payerType: 'Sender' | 'Recipient';
  description: string;
}

async function findOrCreateRecipientContact(recipient: RecipientInfo): Promise<{ recipientRef: string; contactRecipientRef: string }> {
  const phone = toNovaPoshtaPhone(recipient.phone);

  const [savedCounterparty] = await callNovaPoshtaApi<CounterpartySaveResult>('Counterparty', 'save', {
    CounterpartyType: 'PrivatePerson',
    CounterpartyProperty: 'Recipient',
    FirstName: recipient.firstName || 'Клієнт',
    LastName: recipient.lastName || '—',
    Phone: phone,
  });

  if (!savedCounterparty) {
    throw new Error('Нова Пошта не повернула отримувача після збереження.');
  }

  const contactPersons = await callNovaPoshtaApi<ContactPersonRaw>('Counterparty', 'getCounterpartyContactPersons', {
    Ref: savedCounterparty.Ref,
    Page: '1',
  });

  const contactRecipient = contactPersons[0];
  if (!contactRecipient) {
    throw new Error('Не вдалося отримати контактну особу отримувача.');
  }

  return { recipientRef: savedCounterparty.Ref, contactRecipientRef: contactRecipient.Ref };
}

export async function createInternetDocument(
  params: CreateTtnParams
): Promise<{ ttnNumber: string; ttnRef: string }> {
  const { recipientRef, contactRecipientRef } = await findOrCreateRecipientContact(params.recipient);

  const [document] = await callNovaPoshtaApi<InternetDocumentSaveResult>('InternetDocument', 'save', {
    // ---- відправник — фіксовані дані з Налаштувань ----
    Sender: params.sender.senderRef,
    CitySender: params.sender.citySenderRef,
    SenderAddress: params.sender.senderAddressRef,
    ContactSender: params.sender.contactSenderRef,
    SendersPhone: params.sender.sendersPhone,

    // ---- отримувач — щойно знайдений/створений ----
    Recipient: recipientRef,
    CityRecipient: params.recipient.cityRef,
    RecipientAddress: params.recipient.warehouseRef,
    ContactRecipient: contactRecipientRef,
    RecipientsPhone: toNovaPoshtaPhone(params.recipient.phone),

    // ---- сама відправка ----
    // DoorsWarehouse — кур'єр забирає від відправника (адреса забору
    // з Налаштувань), отримувач забирає сам з відділення/поштомату
    ServiceType: 'DoorsWarehouse',
    CargoType: 'Cargo',
    PaymentMethod: 'Cash',
    PayerType: params.payerType,
    Weight: String(params.weight),
    SeatsAmount: String(params.seatsAmount),
    Cost: String(params.cost),
    Description: params.description,
    // Нова Пошта хоче дату у форматі dd.MM.yyyy
    DateTime: new Date().toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  });

  if (!document) {
    throw new Error('Нова Пошта не повернула створений документ.');
  }

  return { ttnNumber: document.IntDocNumber, ttnRef: document.Ref };
}
