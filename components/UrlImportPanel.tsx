'use client';

// ============================================================
// Панель "Автозагрузка прайсов по ссылке".
//
// Поставщик держит актуальный Excel-прайс по одному и тому же адресу
// (например, http://postavshik.com/price.xls) и сам перезаписывает
// файл по этому адресу, когда меняются цены — магазину не нужно
// каждый раз просить прислать файл заново. Вся логика скачивания и
// разбора — в lib/urlPriceImport.ts, эта панель только показывает
// результат и даёт кнопку "Проверить сейчас", не дожидаясь планового
// запуска (см. vercel.json).
//
// Использует эндпоинты app/api/admin/url-import/route.ts:
//   GET  /api/admin/url-import  — последние записи журнала
//   POST /api/admin/url-import  — проверить ссылки прямо сейчас
//
// Чтобы ссылка вообще подхватилась, у поставщика в карточке (экран
// "Поставщики") должно быть заполнено поле "Ссылка на прайс" И
// настроен маппинг колонок Excel
// ============================================================

import { useCallback, useEffect, useState } from 'react';

type ImportStatus = 'imported' | 'error';

interface LogEntry {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  priceUrl: string;
  status: ImportStatus;
  addedCount: number;
  updatedCount: number;
  errorMessage: string | null;
  processedAt: string;
}

interface CheckSummary {
  error?: string;
  checked: number;
  imported: number;
  failed: number;
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  imported: 'Прайс загружен',
  error: 'Ошибка загрузки',
};

const STATUS_COLORS: Record<ImportStatus, { bg: string; fg: string }> = {
  imported: { bg: 'var(--good-soft)', fg: 'var(--good)' },
  error: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
};

// "сегодня, 14:05" / "вчера, 14:05" / "03.02.2026" — тот же формат,
// что и в components/EmailImportPanel.tsx
function formatDateTimeLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return `сегодня, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `вчера, ${time}`;

  return date.toLocaleDateString('ru-RU');
}

export default function UrlImportPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [logError, setLogError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [lastSummary, setLastSummary] = useState<CheckSummary | null>(null);

  const fetchLog = useCallback(async () => {
    setLoadingLog(true);
    setLogError(null);
    try {
      const response = await fetch('/api/admin/url-import');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить журнал автозагрузки');
      }
      setEntries(data.entries as LogEntry[]);
    } catch (error) {
      setLogError(error instanceof Error ? error.message : 'Ошибка сети при загрузке журнала');
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const handleCheckNow = async () => {
    setChecking(true);
    setLastSummary(null);
    try {
      const response = await fetch('/api/admin/url-import', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось проверить ссылки');
      }
      setLastSummary(data as CheckSummary);
      await fetchLog();
    } catch (error) {
      setLastSummary({
        error: error instanceof Error ? error.message : 'Ошибка сети при проверке ссылок',
        checked: 0,
        imported: 0,
        failed: 0,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="p-5 rounded-lg mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold">Автозагрузка прайсов по ссылке</h2>
        <button
          type="button"
          disabled={checking}
          onClick={handleCheckNow}
          className="text-xs font-medium px-3 py-1.5 rounded-md shrink-0 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {checking ? 'Проверка...' : 'Проверить ссылки сейчас'}
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Ссылки проверяются автоматически несколько раз в день (см. vercel.json). Чтобы прайс поставщика
        подхватывался отсюда, укажите в его карточке на экране «Поставщики» поле «Ссылка на прайс» и
        настройте маппинг колонок Excel.
      </p>

      {lastSummary && (
        <div
          className="text-xs p-3 rounded-md mb-4"
          style={{
            background: lastSummary.error ? 'var(--bad-soft)' : 'var(--good-soft)',
            color: lastSummary.error ? 'var(--bad)' : 'var(--good)',
          }}
        >
          {lastSummary.error ? (
            lastSummary.error
          ) : (
            <>
              Проверено ссылок: {lastSummary.checked}. Загружено прайсов: {lastSummary.imported}
              {lastSummary.failed > 0 ? `, с ошибками: ${lastSummary.failed}` : ''}.
            </>
          )}
        </div>
      )}

      {logError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {logError}{' '}
          <button type="button" onClick={fetchLog} className="underline">
            Повторить
          </button>
        </p>
      )}

      {loadingLog ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Загрузка журнала...
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Журнал пуст — ни у одного поставщика ещё не заполнена ссылка на прайс, либо проверок ещё не было.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto pr-1" style={{ maxHeight: 260 }}>
          {entries.map((entry) => {
            const colors = STATUS_COLORS[entry.status];
            return (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 p-2.5 rounded-md text-xs"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {entry.supplierName || 'Удалённый поставщик'}
                    {entry.status === 'imported' && (
                      <span style={{ color: 'var(--ink-faint)' }}>
                        {' '}
                        — добавлено {entry.addedCount}, обновлено {entry.updatedCount}
                      </span>
                    )}
                  </p>
                  <p className="truncate" style={{ color: 'var(--ink-faint)' }}>
                    {entry.priceUrl}
                  </p>
                  {entry.status === 'error' && entry.errorMessage && (
                    <p className="mt-0.5" style={{ color: 'var(--bad)' }}>
                      {entry.errorMessage}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                    style={{ background: colors.bg, color: colors.fg }}
                  >
                    {STATUS_LABELS[entry.status]}
                  </span>
                  <span className="text-[11px] whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                    {formatDateTimeLabel(entry.processedAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
