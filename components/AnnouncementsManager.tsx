'use client';

// ============================================================
// Виджет "Объявления на сайте" — короткие сообщения (акции,
// предупреждения о графике работы и т.п.), которые показываются
// баннером на витрине (components/StorefrontHome.tsx). В отличие
// от контактов, объявлений может быть несколько — админ добавляет
// их по одному и включает/выключает каждое отдельно, не удаляя.
//
// Использует эндпоинты:
//   GET    /api/announcements       — список ВСЕХ объявлений
//   POST   /api/announcements       — создать новое
//   PATCH  /api/announcements/[id]  — включить/выключить или изменить текст
//   DELETE /api/announcements/[id]  — удалить насовсем
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface Announcement {
  id: string;
  text: string;
  isActive: boolean;
  createdAt: string;
}

export default function AnnouncementsManager() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма добавления нового объявления ----
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ---- id объявлений, у которых сейчас идёт сохранение/удаление ----
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/announcements');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить объявления');
      }
      setAnnouncements(data.announcements as Announcement[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке объявлений');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const handleAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAddError(null);

    if (!newText.trim()) {
      setAddError('Введите текст объявления');
      return;
    }

    setAdding(true);
    try {
      const response = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newText }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось создать объявление');
      }
      setNewText('');
      await fetchAnnouncements();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Ошибка сети при создании объявления');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (announcement: Announcement) => {
    setPendingIds((prev) => new Set(prev).add(announcement.id));
    try {
      const response = await fetch(`/api/announcements/${announcement.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !announcement.isActive }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось изменить объявление');
      }
      await fetchAnnouncements();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при изменении объявления');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(announcement.id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      const response = await fetch(`/api/announcements/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось удалить объявление');
      }
      await fetchAnnouncements();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при удалении объявления');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <h2 className="text-base font-semibold mb-1">Объявления на сайте</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Показываются баннером наверху витрины. Можно держать несколько заготовок и включать нужную —
        выключенные не удаляются, просто не видны покупателям.
      </p>

      <form onSubmit={handleAdd} className="flex gap-3 mb-5">
        <input
          type="text"
          className="flex-1 px-3 py-2 text-sm rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          placeholder="напр. Знижка 10% на гальмівні колодки до кінця тижня"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button
          type="submit"
          disabled={adding}
          className="px-5 py-2 rounded-md text-sm font-medium disabled:opacity-50 shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {adding ? 'Добавление...' : 'Добавить'}
        </button>
      </form>
      {addError && (
        <p className="text-xs mb-4 -mt-3" style={{ color: 'var(--bad)' }}>
          {addError}
        </p>
      )}

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchAnnouncements} className="underline">
            Повторить
          </button>
        </p>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Загрузка...
        </p>
      ) : announcements.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Объявлений пока нет — добавьте первое выше.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {announcements.map((announcement) => {
            const isPending = pendingIds.has(announcement.id);
            return (
              <div
                key={announcement.id}
                className="flex items-center gap-3 p-3 rounded-md"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
              >
                <p
                  className="flex-1 text-sm"
                  style={{ color: announcement.isActive ? 'var(--ink)' : 'var(--ink-faint)' }}
                >
                  {announcement.text}
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggle(announcement)}
                  className="text-[11px] px-2.5 py-1 rounded-full font-medium shrink-0 disabled:opacity-50"
                  style={{
                    background: announcement.isActive ? 'var(--good-soft)' : 'var(--warn-soft)',
                    color: announcement.isActive ? 'var(--good)' : 'var(--warn)',
                  }}
                >
                  {announcement.isActive ? 'Активно' : 'Выключено'}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(announcement.id)}
                  className="text-[11px] px-2 py-1 rounded shrink-0 disabled:opacity-50"
                  style={{ color: 'var(--bad)' }}
                >
                  Удалить
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
