'use client';

// ============================================================
// Виджет "Глобальные курсы валют".
//
// Раньше курс валюты настраивался у КАЖДОГО поставщика отдельно —
// это было неудобно: если курс доллара менялся, приходилось идти
// по всем поставщикам с долларовым прайсом и поправлять курс у
// каждого вручную. Этот виджет решает задачу иначе: курс валюты —
// общий для ВСЕХ поставщиков сразу. Один раз поменяли курс здесь —
// и он сразу применится ко всем, у кого выбрана эта валюта, при
// следующей загрузке прайс-листа.
//
// Оба курса — USD и EUR — задаются вручную (админ сам вписывает
// нужные значения, например со своей наценкой к официальному курсу).
//
// Использует эндпоинт app/api/rates/route.ts:
//   GET  /api/rates  — получить сохранённые курсы
//   POST /api/rates  — сохранить сразу несколько курсов одним запросом
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

// Валюты, для которых виджет показывает отдельное поле ввода курса.
// Если понадобится ещё одна иностранная валюта (например, RUB) —
// достаточно дописать её код сюда, форма подстроится сама
const WIDGET_CURRENCIES = ['USD', 'EUR'] as const;
type WidgetCurrency = (typeof WIDGET_CURRENCIES)[number];

// Подписи для полей ввода — чтобы не плодить ещё один объект
// сопоставлений и держать всё рядом с самим списком валют
const CURRENCY_LABELS: Record<WidgetCurrency, string> = {
  USD: 'USD — доллар США',
  EUR: 'EUR — евро',
};

// Один курс валюты в том виде, в котором его отдаёт GET /api/rates
interface RateData {
  currency: string;
  rate: number;
  updatedAt: string;
}

export default function GlobalRatesWidget() {
  // ---- уже сохранённые в базе курсы (для подписи "обновлено...") ----
  const [savedRates, setSavedRates] = useState<Record<string, RateData>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- значения полей ввода — строки, пока форма редактируется ----
  const [form, setForm] = useState<Record<WidgetCurrency, string>>({ USD: '', EUR: '' });

  // ---- сохранение формы ----
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ------------------------------------------------------------
  // ЗАГРУЗКА ТЕКУЩИХ КУРСОВ ПРИ ОТКРЫТИИ ЭКРАНА (GET /api/rates)
  // ------------------------------------------------------------
  const fetchRates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/rates');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить курсы валют');
      }

      const rates = data.rates as RateData[];

      const byCurrency: Record<string, RateData> = {};
      const nextForm: Record<WidgetCurrency, string> = { USD: '', EUR: '' };
      for (const rate of rates) {
        byCurrency[rate.currency] = rate;
        if ((WIDGET_CURRENCIES as readonly string[]).includes(rate.currency)) {
          nextForm[rate.currency as WidgetCurrency] = String(rate.rate);
        }
      }

      setSavedRates(byCurrency);
      setForm(nextForm);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке курсов валют');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  // ------------------------------------------------------------
  // СОХРАНЕНИЕ КУРСОВ ОДНОЙ КНОПКОЙ (POST /api/rates)
  // ------------------------------------------------------------
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    // Отправляем только те валюты, для которых поле реально заполнено —
    // так виджетом можно обновить, например, только курс USD, оставив
    // поле EUR пустым, если его курс сейчас менять не нужно
    const payload = WIDGET_CURRENCIES.filter((currency) => form[currency].trim() !== '').map(
      (currency) => ({ currency, rate: parseFloat(form[currency]) })
    );

    if (payload.length === 0) {
      setSaveError('Укажите хотя бы один курс, прежде чем сохранять');
      return;
    }
    if (payload.some((item) => !Number.isFinite(item.rate) || item.rate <= 0)) {
      setSaveError('Курс должен быть положительным числом');
      return;
    }

    setSaving(true);
    try {
      // Один запрос сразу с массивом курсов — бэкенд (app/api/rates/route.ts)
      // обновит их все в одной транзакции: либо оба курса применятся,
      // либо ни один (если что-то пойдёт не так на середине)
      const response = await fetch('/api/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось обновить курсы валют');
      }

      await fetchRates();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении курсов');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="p-5 rounded-lg mb-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <h2 className="text-base font-semibold mb-1">Глобальные курсы валют</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Курс здесь один на всех — меняете его один раз, и он сразу применяется ко всем поставщикам с этой
        валютой при следующей загрузке прайс-листа. Курс конкретного поставщика больше не настраивается
        отдельно — только сама валюта, в которой он присылает прайс.
      </p>

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchRates} className="underline">
            Повторить
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        {WIDGET_CURRENCIES.map((currency) => (
          <div key={currency} className="w-40">
            <label
              htmlFor={`rate-${currency}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              {CURRENCY_LABELS[currency]}
            </label>
            <input
              id={`rate-${currency}`}
              type="number"
              min={0}
              // step="any" — чтобы браузер не отвергал нормальные дробные
              // значения курса из-за погрешностей плавающей запятой
              step="any"
              placeholder="напр. 41.50"
              disabled={loading}
              className="w-full px-3 py-2 text-sm rounded-md font-mono disabled:opacity-50"
              style={{ border: '1px solid var(--line)' }}
              value={form[currency]}
              onChange={(e) => setForm({ ...form, [currency]: e.target.value })}
            />
            {savedRates[currency] && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                Сейчас в базе: {savedRates[currency].rate}
              </p>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={saving || loading}
          className="px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {saving ? 'Сохранение...' : 'Обновить глобальные курсы'}
        </button>
      </form>

      {saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {saveError}
        </p>
      )}
      {saved && !saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
          Курсы обновлены — новые значения уже используются при загрузке прайс-листов
        </p>
      )}
    </section>
  );
}
