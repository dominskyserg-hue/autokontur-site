'use client';

// ============================================================
// Экран "Словник пошуку" — управление многоязычным словарём
// синонимов для поиска по ключевым словам (см. lib/searchSynonyms.ts
// и app/api/products/route.ts, где словарь реально используется).
//
// Одна ГРУППА = одно понятие ("Гальмівні колодки") со списком ВСЕХ
// вариантов написания на укр/рос/англ вперемешку — порядок и язык
// не важны, важно, что все они означают одно и то же для покупателя.
//
// Использует:
//   GET/POST   /api/search-synonyms         — список / создать группу
//   PATCH/DELETE /api/search-synonyms/[id]  — изменить / удалить группу
//   POST       /api/search-synonyms/import  — массовая загрузка из
//                                              Excel (.xlsx/.xls) или
//                                              текстового файла (.txt/.csv)
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

interface SynonymGroup {
  id: string;
  label: string;
  terms: string[];
  updatedAt: string;
}

// Терміни редагуються як текст, розділений комами — простіше для
// адміна, ніж окремі "чіпси" з кнопками видалення на кожен термін
function termsToText(terms: string[]): string {
  return terms.join(', ');
}
function textToTerms(text: string): string[] {
  return text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export default function SearchSynonymsManager() {
  const [groups, setGroups] = useState<SynonymGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Чернетки редагування — окремо від groups, щоб можна було
  // редагувати текстове поле, не чіпаючи ще не збережені дані
  const [editLabel, setEditLabel] = useState<Record<string, string>>({});
  const [editTerms, setEditTerms] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Форма додавання нової групи
  const [newLabel, setNewLabel] = useState('');
  const [newTerms, setNewTerms] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Масова загрузка з файлу
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/search-synonyms');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося завантажити словник');
      }
      const list = data.groups as SynonymGroup[];
      setGroups(list);
      const labels: Record<string, string> = {};
      const terms: Record<string, string> = {};
      for (const g of list) {
        labels[g.id] = g.label;
        terms[g.id] = termsToText(g.terms);
      }
      setEditLabel(labels);
      setEditTerms(terms);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Помилка мережі при завантаженні словника');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleSaveGroup = async (id: string) => {
    setRowError((prev) => ({ ...prev, [id]: '' }));

    const label = (editLabel[id] || '').trim();
    const terms = textToTerms(editTerms[id] || '');

    if (!label) {
      setRowError((prev) => ({ ...prev, [id]: 'Вкажіть назву групи' }));
      return;
    }
    if (terms.length === 0) {
      setRowError((prev) => ({ ...prev, [id]: 'Додайте хоча б один варіант написання' }));
      return;
    }

    setSavingId(id);
    try {
      const response = await fetch(`/api/search-synonyms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, terms }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося зберегти групу');
      }
      await fetchGroups();
    } catch (error) {
      setRowError((prev) => ({
        ...prev,
        [id]: error instanceof Error ? error.message : 'Помилка мережі при збереженні',
      }));
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    setSavingId(id);
    try {
      const response = await fetch(`/api/search-synonyms/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося видалити групу');
      }
      await fetchGroups();
    } catch (error) {
      setRowError((prev) => ({
        ...prev,
        [id]: error instanceof Error ? error.message : 'Помилка мережі при видаленні',
      }));
    } finally {
      setSavingId(null);
    }
  };

  const handleCreateGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);

    const label = newLabel.trim();
    const terms = textToTerms(newTerms);

    if (!label) {
      setCreateError('Вкажіть назву групи');
      return;
    }
    if (terms.length === 0) {
      setCreateError('Додайте хоча б один варіант написання');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/search-synonyms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, terms }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося створити групу');
      }
      setNewLabel('');
      setNewTerms('');
      await fetchGroups();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Помилка мережі при створенні групи');
    } finally {
      setCreating(false);
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/search-synonyms/import', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося обробити файл');
      }
      setImportResult(
        `Оброблено рядків: ${data.totalRows}. Нових груп: ${data.created}, доповнено: ${data.updated}.`
      );
      await fetchGroups();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Помилка мережі при завантаженні файлу');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <section
      className="p-5 rounded-lg mb-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <h2 className="text-base font-semibold mb-1">Словник пошуку (укр/рос/англ)</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Кожна група — одне поняття з усіма варіантами написання будь-якою мовою. Запит покупця "гальмівні
        колодки rav 4" знайде товар з назвою "brake pads RAV4", якщо в групі нижче є і "гальмівні колодки",
        і "brake pads".
      </p>

      {/* ==================== МАСОВА ЗАГРУЗКА ==================== */}
      <div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: '1px solid var(--line)' }}>
        <label
          className="text-sm px-3.5 py-2 rounded-md cursor-pointer"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
        >
          {importing ? 'Завантаження...' : 'Завантажити з Excel/TXT'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.txt,.csv"
            className="hidden"
            disabled={importing}
            onChange={handleImportFile}
          />
        </label>
        <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
          Один рядок = одна група: назва, потім через ";" — усі варіанти написання
        </span>
      </div>
      {importError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {importError}
        </p>
      )}
      {importResult && !importError && (
        <p className="text-xs mb-3" style={{ color: 'var(--good)' }}>
          {importResult}
        </p>
      )}

      {/* ==================== ДОДАТИ ГРУПУ ВРУЧНУ ==================== */}
      <form onSubmit={handleCreateGroup} className="flex flex-col sm:flex-row gap-2 mb-5 items-start">
        <input
          type="text"
          placeholder="Назва групи, напр. Гальмівні колодки"
          className="px-3 py-2 text-sm rounded-md w-full sm:w-56"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <input
          type="text"
          placeholder="Варіанти через кому: гальмівні колодки, тормозные колодки, brake pads"
          className="px-3 py-2 text-sm rounded-md flex-1 w-full"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
          value={newTerms}
          onChange={(e) => setNewTerms(e.target.value)}
        />
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 shrink-0"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {creating ? 'Додаємо...' : 'Додати групу'}
        </button>
      </form>
      {createError && (
        <p className="text-xs mb-4" style={{ color: 'var(--bad)' }}>
          {createError}
        </p>
      )}

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchGroups} className="underline">
            Повторити
          </button>
        </p>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Завантаження...
        </p>
      ) : groups.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Словник поки порожній — додайте першу групу вище.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.id} className="p-3.5 rounded-md" style={{ background: 'var(--surface-2)' }}>
              <div className="flex flex-col sm:flex-row gap-2 items-start">
                <input
                  type="text"
                  className="px-3 py-2 text-sm rounded-md w-full sm:w-56"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                  value={editLabel[group.id] ?? ''}
                  onChange={(e) => setEditLabel((prev) => ({ ...prev, [group.id]: e.target.value }))}
                />
                <input
                  type="text"
                  className="px-3 py-2 text-sm rounded-md flex-1 w-full font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                  value={editTerms[group.id] ?? ''}
                  onChange={(e) => setEditTerms((prev) => ({ ...prev, [group.id]: e.target.value }))}
                />
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSaveGroup(group.id)}
                    disabled={savingId === group.id}
                    className="px-3.5 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                  >
                    Зберегти
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteGroup(group.id)}
                    disabled={savingId === group.id}
                    className="px-3.5 py-2 rounded-md text-sm disabled:opacity-50"
                    style={{ border: '1px solid var(--bad)', color: 'var(--bad)' }}
                  >
                    Видалити
                  </button>
                </div>
              </div>
              {rowError[group.id] && (
                <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                  {rowError[group.id]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
