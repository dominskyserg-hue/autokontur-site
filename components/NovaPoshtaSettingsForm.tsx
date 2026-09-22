'use client';

// ============================================================
// Виджет "Нова Пошта — відправник для ТТН" — один раз выбираем,
// с какого адреса забирают посылки и чья контактная особа указана
// отправителем, когда оператор создаёт ТТН прямо из карточки заказа
// (components/OrdersScreen.tsx, кнопка "Створити ТТН").
//
// Использует эндпоинты:
//   GET /api/admin/nova-poshta/sender-options — живой список контактов
//       и адресов из самой Новой Пошти (что реально там зарегистровано)
//   GET/PATCH /api/nova-poshta-settings — уже сохранённый выбор
// ============================================================

import { useCallback, useEffect, useState } from 'react';

interface ContactOption {
  ref: string;
  label: string;
  phone: string;
}

interface AddressOption {
  ref: string;
  label: string;
  cityRef: string;
  cityLabel: string;
}

export default function NovaPoshtaSettingsForm() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<{ contact: string | null; address: string | null }>({
    contact: null,
    address: null,
  });

  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [senderLabel, setSenderLabel] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [addresses, setAddresses] = useState<AddressOption[]>([]);
  const [selectedContactRef, setSelectedContactRef] = useState('');
  const [selectedAddressRef, setSelectedAddressRef] = useState('');
  const [senderRef, setSenderRef] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/nova-poshta-settings');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить настройки');
      setSavedLabel({ contact: data.settings.contactSenderLabel, address: data.settings.senderAddressLabel });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке настроек');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleLoadOptions = async () => {
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const response = await fetch('/api/admin/nova-poshta/sender-options');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось получить данные из Новой Почты');
      setSenderRef(data.senderRef);
      setSenderLabel(data.senderLabel);
      setContacts(data.contacts);
      setAddresses(data.addresses);
      setSelectedContactRef(data.contacts[0]?.ref || '');
      setSelectedAddressRef(data.addresses[0]?.ref || '');
    } catch (error) {
      setOptionsError(error instanceof Error ? error.message : 'Ошибка сети при обращении к Новой Почте');
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleSave = async () => {
    const contact = contacts.find((c) => c.ref === selectedContactRef);
    const address = addresses.find((a) => a.ref === selectedAddressRef);
    if (!contact || !address) {
      setSaveError('Оберіть контактну особу та адресу забору посилки.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const response = await fetch('/api/nova-poshta-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderRef,
          contactSenderRef: contact.ref,
          contactSenderLabel: contact.label,
          sendersPhone: contact.phone,
          senderAddressRef: address.ref,
          citySenderRef: address.cityRef,
          senderAddressLabel: address.label,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки');
      setSavedLabel({ contact: data.settings.contactSenderLabel, address: data.settings.senderAddressLabel });
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении настроек');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="p-5 rounded-lg mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <h2 className="text-base font-semibold mb-1">Нова Пошта — відправник для ТТН</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Звідки забирають посилку і чия контактна особа вказується відправником, коли менеджер створює ТТН прямо з
        картки заказа кнопкою «Створити ТТН».
      </p>

      {loading && (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Загрузка...
        </p>
      )}
      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      {!loading && (savedLabel.contact || savedLabel.address) && (
        <div
          className="text-xs p-3 rounded-md mb-4"
          style={{ background: 'var(--surface-2)', color: 'var(--ink-muted)' }}
        >
          <div>
            <span style={{ color: 'var(--ink-faint)' }}>Контактна особа: </span>
            {savedLabel.contact || '—'}
          </div>
          <div>
            <span style={{ color: 'var(--ink-faint)' }}>Адреса забору: </span>
            {savedLabel.address || '—'}
          </div>
        </div>
      )}

      {contacts.length === 0 && addresses.length === 0 ? (
        <button
          type="button"
          disabled={loadingOptions}
          onClick={handleLoadOptions}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
        >
          {loadingOptions ? 'Завантаження...' : 'Завантажити варіанти з Нової Пошти'}
        </button>
      ) : (
        <div className="flex flex-col gap-3.5">
          {senderLabel && (
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Відправник: {senderLabel}
            </p>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Контактна особа
            </label>
            <select
              className="w-full max-w-md px-3 py-2 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              value={selectedContactRef}
              onChange={(e) => setSelectedContactRef(e.target.value)}
            >
              {contacts.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.label} ({c.phone})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Адреса забору посилки
            </label>
            <select
              className="w-full max-w-md px-3 py-2 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              value={selectedAddressRef}
              onChange={(e) => setSelectedAddressRef(e.target.value)}
            >
              {addresses.map((a) => (
                <option key={a.ref} value={a.ref}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="self-start px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      )}

      {optionsError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {optionsError}
        </p>
      )}
      {saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {saveError}
        </p>
      )}
      {saved && !saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
          Сохранено
        </p>
      )}
    </section>
  );
}
