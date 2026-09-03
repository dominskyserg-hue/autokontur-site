'use client';

// ============================================================
// Виджет "Информационные страницы" — редактирование контента трёх
// статичных страниц витрины: Про нас, Доставка, Контакти. Каждая
// хранится отдельной строкой в таблице site_pages (см. schema.sql),
// поэтому здесь есть переключатель, какую из трёх сейчас редактируем,
// а не одна общая форма, как в ContactSettingsForm.tsx.
//
// Использует эндпоинт app/api/site-pages/route.ts:
//   GET   /api/site-pages — получить все три страницы разом
//   PATCH /api/site-pages — сохранить одну (по slug)
//
// Публичные страницы (app/about, app/delivery, app/contacts) читают
// ту же таблицу напрямую на сервере — сохранённое здесь появится там
// сразу после сохранения, без отдельной публикации
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

interface SitePage {
  slug: string;
  title: string;
  content: string;
  updatedAt: string;
}

const TABS: { slug: string; label: string }[] = [
  { slug: 'about', label: 'Про нас' },
  { slug: 'delivery', label: 'Доставка' },
  { slug: 'contacts', label: 'Контакти' },
  { slug: 'privacy', label: 'Конфіденційність' },
  { slug: 'terms', label: 'Оферта' },
  { slug: 'returns', label: 'Повернення' },
];

export default function SitePagesManager() {
  const [pages, setPages] = useState<Record<string, SitePage>>({});
  const [activeSlug, setActiveSlug] = useState<string>('about');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fetchPages = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/site-pages');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить страницы');
      }
      const bySlug: Record<string, SitePage> = {};
      for (const page of data.pages as SitePage[]) {
        bySlug[page.slug] = page;
      }
      setPages(bySlug);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке страниц');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  // Переключение вкладки — подставляем в форму значения уже
  // загруженной страницы (или пустые поля, пока загрузка не завершилась)
  useEffect(() => {
    const page = pages[activeSlug];
    setTitle(page?.title || '');
    setContent(page?.content || '');
    setSaveError(null);
    setSaved(false);
  }, [activeSlug, pages]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    if (!title.trim()) {
      setSaveError('Заголовок страницы не может быть пустым');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/site-pages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: activeSlug, title, content }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить страницу');
      }
      setPages((prev) => ({ ...prev, [activeSlug]: data.page }));
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении страницы');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="p-5 rounded-lg mb-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <h2 className="text-base font-semibold mb-1">Информационные страницы</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Текст статичных страниц сайта, включая юридические (Конфіденційність, Оферта, Повернення) — пока
        страница пустая, на витрине вместо неё показывается заглушка "Сторінка ще наповнюється".
      </p>

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchPages} className="underline">
            Повторить
          </button>
        </p>
      )}

      <div className="flex gap-2 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.slug}
            type="button"
            onClick={() => setActiveSlug(tab.slug)}
            className="px-3.5 py-1.5 text-sm rounded-md"
            style={
              activeSlug === tab.slug
                ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                : { background: 'var(--surface-2)', color: 'var(--ink-muted)', border: '1px solid var(--line)' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label htmlFor="page-title" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Заголовок сторінки
          </label>
          <input
            id="page-title"
            type="text"
            disabled={loading}
            className="w-full max-w-md px-3 py-2 text-sm rounded-md disabled:opacity-50"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="page-content" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Текст сторінки
          </label>
          <textarea
            id="page-content"
            rows={12}
            disabled={loading}
            placeholder="Кожен абзац — з нового рядка через порожній рядок"
            className="w-full px-3 py-2 text-sm rounded-md disabled:opacity-50 resize-y"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="self-start px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
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
          Сохранено — страница на витрине уже обновлена
        </p>
      )}
    </section>
  );
}
