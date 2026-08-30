'use client';

// ============================================================
// Виджет "Магазин, контакты и часы работы" — название магазина,
// телефон и часы работы, которые показываются на витрине
// (components/StorefrontHome.tsx) и в шапке самой админ-панели
// (components/AdminLayout.tsx). Ровно одна запись в базе (таблица
// site_settings — "синглтон", см. schema.sql), поэтому здесь нет
// списка и выбора записи, только поля формы и кнопка "Сохранить".
//
// Использует эндпоинт app/api/site-settings/route.ts:
//   GET   /api/site-settings — получить текущие значения
//   PATCH /api/site-settings — сохранить новые
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

export default function ContactSettingsForm() {
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [workingHours, setWorkingHours] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/site-settings');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить настройки');
      }
      setShopName(data.settings.shopName || '');
      setPhone(data.settings.phone || '');
      setWorkingHours(data.settings.workingHours || '');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке настроек');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (!shopName.trim()) {
      setSaveError('Название магазина не может быть пустым');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopName, phone, workingHours }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить настройки');
      }
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении настроек');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="p-5 rounded-lg mb-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <h2 className="text-base font-semibold mb-1">Магазин, контакты и часы работы</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Показываются на витрине магазина и в шапке админ-панели — сохранённые значения применяются сразу везде.
      </p>

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchSettings} className="underline">
            Повторить
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div className="w-56">
          <label htmlFor="settings-shop-name" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Название магазина
          </label>
          <input
            id="settings-shop-name"
            type="text"
            disabled={loading}
            className="w-full px-3 py-2 text-sm rounded-md disabled:opacity-50"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            placeholder="AUTOKONTUR"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
          />
        </div>

        <div className="w-56">
          <label htmlFor="settings-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Телефон
          </label>
          <input
            id="settings-phone"
            type="text"
            disabled={loading}
            className="w-full px-3 py-2 text-sm rounded-md font-mono disabled:opacity-50"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            placeholder="+38 (050) 123-45-67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>

        <div className="w-56">
          <label htmlFor="settings-hours" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Часы работы
          </label>
          <input
            id="settings-hours"
            type="text"
            disabled={loading}
            className="w-full px-3 py-2 text-sm rounded-md disabled:opacity-50"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            placeholder="Щодня 9:00–19:00"
            value={workingHours}
            onChange={(e) => setWorkingHours(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </form>

      {saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {saveError}
        </p>
      )}
      {saved && !saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
          Сохранено — новые значения уже видны на витрине
        </p>
      )}
    </section>
  );
}
