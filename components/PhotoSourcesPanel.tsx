'use client';

// ============================================================
// Блок "Фото товаров" на странице "Отчёты": сколько активных товаров с фото
// и откуда эти фото (прайс поставщика / Bing / вручную). Данные —
// GET /api/admin/reports/photo-sources, моментальный срез без периода.
// Фото из Bing больше не ищутся и заменяются фото поставщиков и ручными —
// по этому блоку видно, как их становится меньше
// ============================================================

import { useCallback, useEffect, useState } from 'react';

interface PhotoSourcesData {
  total: number;
  withPhoto: number;
  bySource: { supplierPrice: number; bing: number; manualUpload: number; manualUrl: number; unknown: number };
}

function formatCount(value: number): string {
  return value.toLocaleString('ru-RU');
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%';
  return `${((part / whole) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

export default function PhotoSourcesPanel() {
  const [data, setData] = useState<PhotoSourcesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/reports/photo-sources');
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Не удалось посчитать фото');
      }
      setData(result as PhotoSourcesData);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при подсчёте фото');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const cards: Array<{ label: string; value: number; color: string; hint?: string }> = data
    ? [
        { label: 'Из прайса поставщика', value: data.bySource.supplierPrice, color: 'var(--good)' },
        { label: 'Из Bing (заменяются)', value: data.bySource.bing, color: 'var(--bad)' },
        {
          label: 'Вручную в админке',
          value: data.bySource.manualUpload + data.bySource.manualUrl,
          color: 'var(--ink)',
          hint: `файлом ${formatCount(data.bySource.manualUpload)}, ссылкой ${formatCount(data.bySource.manualUrl)}`,
        },
        { label: 'Источник неизвестен', value: data.bySource.unknown, color: 'var(--ink-muted)' },
      ]
    : [];

  return (
    <section className="mt-10 pt-6" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold">Фото товаров</h2>
        <button
          type="button"
          onClick={fetchData}
          className="text-xs px-3 py-1.5 rounded-md"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
        >
          Обновить
        </button>
      </div>
      <p className="text-sm mb-4" style={{ color: 'var(--ink-muted)' }}>
        Откуда фото у активных товаров — на сейчас, без периода. Фото из Bing больше не ищутся: когда у товара
        появляется фото из прайса или загруженное вручную, оно заменяет фото из Bing.
      </p>

      {loading && (
        <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>
          Загрузка...
        </p>
      )}
      {loadError && (
        <p className="text-sm p-3 rounded-lg" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      {!loading && data && (
        <>
          <p className="text-sm mb-3">
            С фото: <span className="font-semibold font-mono">{formatCount(data.withPhoto)}</span> из{' '}
            <span className="font-mono">{formatCount(data.total)}</span> активных товаров (
            {percent(data.withPhoto, data.total)})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cards.map((card) => (
              <div
                key={card.label}
                className="p-4 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <p className="text-xs mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                  {card.label}
                </p>
                <p className="text-xl font-semibold font-mono" style={{ color: card.color }}>
                  {formatCount(card.value)}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                  {percent(card.value, data.withPhoto)} фото{card.hint ? ` · ${card.hint}` : ''}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
