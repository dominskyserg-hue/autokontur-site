'use client';

// ============================================================
// Подсказки при вводе в поиске: пока покупатель печатает артикул или
// название, под строкой поиска появляются до 5 товаров с фото, ценой и
// наличием — по нажатию сразу открывается товар. Внизу — "Показати всі
// результати" (обычный поиск).
//
// Если по набранному ничего нет, пробуем ещё раз с исправленной
// раскладкой клавиатуры ("щс90" -> "oc90", lib/keyboardLayout.ts) и
// пишем, по какому запросу показаны подсказки.
//
// Используется в шапке (components/SiteHeaderFull.tsx) и в поиске на
// главной (components/StorefrontHome.tsx). Родитель должен иметь
// position: relative — список рисуется под ним.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { buildProductPath } from '@/lib/slug';
import { switchKeyboardLayout } from '@/lib/keyboardLayout';

interface SuggestionProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  retailPrice: number;
  stock: number;
  ownStock?: boolean;
}

interface SearchSuggestionsProps {
  query: string;
  // Поле поиска в фокусе — только тогда показываем подсказки
  active: boolean;
  // "Показати всі результати" — обычный поиск по введённому тексту
  onShowAll: (query: string) => void;
  // Покупатель выбрал товар — родитель закрывает подсказки
  onPick: () => void;
}

// Подсказки — начиная с 3 символов и через паузу в наборе, чтобы не
// слать запрос на каждую нажатую клавишу
const MIN_LENGTH = 3;
const DEBOUNCE_MS = 300;
const LIMIT = 5;

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

async function fetchSuggestions(query: string): Promise<SuggestionProduct[]> {
  const params = new URLSearchParams({ search: query, pageSize: String(LIMIT) });
  const response = await fetch(`/api/products?${params.toString()}`);
  if (!response.ok) return [];
  const data = await response.json();
  return (data.products as SuggestionProduct[]) ?? [];
}

export default function SearchSuggestions({ query, active, onShowAll, onPick }: SearchSuggestionsProps) {
  const [items, setItems] = useState<SuggestionProduct[]>([]);
  // Если подсказки найдены по исправленной раскладке — этот текст
  const [correctedQuery, setCorrectedQuery] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Кэш ответов: при стирании и повторном наборе не ходим в API заново
  const cacheRef = useRef(new Map<string, { items: SuggestionProduct[]; corrected: string | null }>());

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_LENGTH) {
      setItems([]);
      setCorrectedQuery(null);
      return;
    }
    const cached = cacheRef.current.get(trimmed);
    if (cached) {
      setItems(cached.items);
      setCorrectedQuery(cached.corrected);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        let found = await fetchSuggestions(trimmed);
        let corrected: string | null = null;
        // Ничего не нашли — может, забыли переключить раскладку
        if (found.length === 0) {
          const switched = switchKeyboardLayout(trimmed);
          if (switched) {
            const retry = await fetchSuggestions(switched);
            if (retry.length > 0) {
              found = retry;
              corrected = switched;
            }
          }
        }
        cacheRef.current.set(trimmed, { items: found, corrected });
        if (!cancelled) {
          setItems(found);
          setCorrectedQuery(corrected);
        }
      } catch {
        // Подсказки необязательны — при ошибке просто ничего не показываем
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  if (!active || trimmed.length < MIN_LENGTH || (items.length === 0 && !loading)) return null;

  return (
    <div
      className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl text-left"
      style={{ background: '#141B29', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 18px 40px rgba(0,0,0,0.45)' }}
      // mousedown, а не click: иначе поле теряет фокус раньше, чем сработает переход
      onMouseDown={(event) => event.preventDefault()}
    >
      {correctedQuery && (
        <p className="px-3.5 pt-2.5 text-xs" style={{ color: '#94A3B8' }}>
          Показано для «<span style={{ color: '#60A5FA' }}>{correctedQuery}</span>»
        </p>
      )}
      {loading && items.length === 0 && (
        <p className="px-3.5 py-3 text-xs" style={{ color: '#94A3B8' }}>
          Шукаємо...
        </p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={buildProductPath(item.id, item)}
              prefetch={false}
              onClick={onPick}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-white/5"
            >
              <span
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="text-[9px]" style={{ color: '#54607A' }}>
                    фото
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm" style={{ color: '#F1F5F9' }}>
                  {item.name || item.article}
                </span>
                <span className="block truncate text-[11px] font-mono" style={{ color: '#60A5FA' }}>
                  {[item.brand, item.article].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold" style={{ color: '#fff' }}>
                  {formatMoney(item.retailPrice)} грн
                </span>
                <span
                  className="block text-[10px]"
                  style={{ color: item.ownStock || item.stock > 0 ? '#34D399' : '#FF6B00' }}
                >
                  {item.ownStock ? 'на нашому складі' : item.stock > 0 ? 'в наявності' : 'під замовлення'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <button
          type="button"
          onClick={() => onShowAll(correctedQuery ?? trimmed)}
          className="w-full px-3.5 py-2.5 text-left text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ color: '#60A5FA', borderTop: '1px solid rgba(255,255,255,0.08)' }}
        >
          Показати всі результати →
        </button>
      )}
    </div>
  );
}
