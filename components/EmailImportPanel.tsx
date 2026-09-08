'use client';

// ============================================================
// Панель "Автозагрузка прайсов по email".
//
// Поставщик присылает Excel-прайс обычным письмом на почту магазина —
// без того, чтобы кто-то заходил в админку и грузил файл руками. Вся
// логика проверки почты и разбора вложений — в
// lib/emailPriceImport.ts, эта панель только показывает результат и
// даёт кнопку "Проверить сейчас" для проверки прямо здесь и сейчас, не
// дожидаясь планового запуска (см. vercel.json).
//
// Использует эндпоинты app/api/admin/email-import/route.ts:
//   GET  /api/admin/email-import  — последние записи журнала
//   POST /api/admin/email-import  — проверить почту прямо сейчас
//
// Чтобы письмо от поставщика вообще подхватилось, у него в карточке
// (экран "Поставщики") должен быть заполнен Email И настроен маппинг
// колонок Excel — иначе сопоставлять письмо не с чем (см. подсказку
// "Кому это письмо" в самом низу панели)
// ============================================================

import { useCallback, useEffect, useState } from 'react';

type ImportStatus = 'imported' | 'error' | 'unmatched' | 'skipped';

interface LogEntry {
  messageId: string;
  supplierId: string | null;
  supplierName: string | null;
  fromAddress: string;
  subject: string | null;
  status: ImportStatus;
  addedCount: number;
  updatedCount: number;
  errorMessage: string | null;
  receivedAt: string | null;
  processedAt: string;
}

interface CheckSummary {
  configured: boolean;
  error?: string;
  checked: number;
  imported: number;
  skipped: number;
  unmatched: number;
  failed: number;
}

const STATUS_LABELS: Record<ImportStatus, string> = {
  imported: 'Прайс загружен',
  error: 'Ошибка разбора',
  unmatched: 'Отправитель не найден',
  skipped: 'Нет Excel-вложения',
};

const STATUS_COLORS: Record<ImportStatus, { bg: string; fg: string }> = {
  imported: { bg: 'var(--good-soft)', fg: 'var(--good)' },
  error: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  unmatched: { bg: 'var(--surface-2)', fg: 'var(--ink-faint)' },
  skipped: { bg: 'var(--surface-2)', fg: 'var(--ink-faint)' },
};

// "сегодня, 14:05" / "вчера, 14:05" / "03.02.2026" — тот же формат,
// что и в components/SupplierMappingScreen.tsx (formatDateTimeLabel)
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

export default function EmailImportPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [logError, setLogError] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [lastSummary, setLastSummary] = useState<CheckSummary | null>(null);

  const fetchLog = useCallback(async () => {
    setLoadingLog(true);
    setLogError(null);
    try {
      const response = await fetch('/api/admin/email-import');
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
      const response = await fetch('/api/admin/email-import', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось проверить почту');
      }
      setLastSummary(data as CheckSummary);
      await fetchLog();
    } catch (error) {
      setLastSummary({
        configured: true,
        error: error instanceof Error ? error.message : 'Ошибка сети при проверке почты',
        checked: 0,
        imported: 0,
        skipped: 0,
        unmatched: 0,
        failed: 0,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="p-5 rounded-lg mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-base font-semibold">Автозагрузка прайсов по email</h2>
        <button
          type="button"
          disabled={checking}
          onClick={handleCheckNow}
          className="text-xs font-medium px-3 py-1.5 rounded-md shrink-0 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {checking ? 'Проверка...' : 'Проверить почту сейчас'}
        </button>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Почта проверяется автоматически несколько раз в день (см. vercel.json). Письмо от поставщика
        сопоставляется с ним по адресу отправителя — совпадает с полем «Email» в карточке поставщика на
        экране «Поставщики». Чтобы прайс подхватился, у поставщика также должен быть настроен маппинг
        колонок Excel и включена автозагрузка (переключатель в его карточке).
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
              Проверено писем: {lastSummary.checked}. Загружено прайсов: {lastSummary.imported}
              {lastSummary.unmatched > 0 ? `, не сопоставлено: ${lastSummary.unmatched}` : ''}
              {lastSummary.skipped > 0 ? `, без вложения: ${lastSummary.skipped}` : ''}
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
          Журнал пуст — проверок ещё не было, либо ни одно письмо ещё не попало в окно проверки.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => {
            const colors = STATUS_COLORS[entry.status];
            return (
              <li
                key={entry.messageId}
                className="flex items-start justify-between gap-3 p-2.5 rounded-md text-xs"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {entry.supplierName || entry.fromAddress}
                    {entry.status === 'imported' && (
                      <span style={{ color: 'var(--ink-faint)' }}>
                        {' '}
                        — добавлено {entry.addedCount}, обновлено {entry.updatedCount}
                      </span>
                    )}
                  </p>
                  <p className="truncate" style={{ color: 'var(--ink-faint)' }}>
                    {entry.fromAddress}
                    {entry.subject ? ` · ${entry.subject}` : ''}
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
