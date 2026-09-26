'use client';

// ============================================================
// Кнопка "У обране" на сторінці товару (components/ProductDetailContent.tsx).
// Той самий принцип, що і в components/AddToCartButton.tsx: сторінка
// товару — Server Component, тому робота з телефоном/API покупця
// винесена в окремий маленький клієнтський компонент.
//
// Покупатель определяется по СЕССИИ кабинета (вход по коду из Telegram,
// HttpOnly-cookie — JavaScript её не видит): GET /api/customer/favorites
// отвечает 401, если не вошёл, — тогда кнопка ведёт на /account.
// Телефон в запросах не передаётся: сервер берёт его из сессии.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { isCustomerCabinetEnabled } from '@/lib/customerCabinet';

interface FavoriteButtonProps {
  productId: string;
}

// Обране живе в кабінеті покупця (/api/customer/favorites) — поки
// кабінет вимкнений (lib/customerCabinet.ts), кнопку не показуємо зовсім
export default function FavoriteButton({ productId }: FavoriteButtonProps) {
  if (!isCustomerCabinetEnabled()) return null;
  return <FavoriteButtonInner productId={productId} />;
}

function FavoriteButtonInner({ productId }: FavoriteButtonProps) {
  // loggedIn: null — ещё проверяем, false — не вошёл, true — вошёл
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/customer/favorites')
      .then(async (response) => {
        // 401 — не вошёл в кабинет: кнопка поведёт на /account
        if (response.status === 401) {
          setLoggedIn(false);
          return;
        }
        const data = await response.json();
        setLoggedIn(true);
        if (data.success) {
          const favorites = data.favorites as Array<{ productId: string }>;
          setIsFavorite(favorites.some((item) => item.productId === productId));
        }
      })
      .catch(() => {
        // Не вдалося перевірити — не критично, кнопка просто
        // почне зі стану "не в обраному"
      })
      .finally(() => setChecking(false));
  }, [productId]);

  const handleToggle = async () => {
    if (!loggedIn) return;

    setSaving(true);
    try {
      if (isFavorite) {
        const response = await fetch(`/api/customer/favorites/${productId}`, { method: 'DELETE' });
        if (response.ok) setIsFavorite(false);
      } else {
        const response = await fetch('/api/customer/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId }),
        });
        if (response.ok) setIsFavorite(true);
      }
    } catch {
      // Помилка мережі — просто лишаємо попередній стан кнопки
    } finally {
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <div
        className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-xl"
        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
      />
    );
  }

  if (!loggedIn) {
    return (
      <Link
        href="/account"
        aria-label="Увійдіть, щоб додати в обране"
        title="Увійдіть, щоб додати в обране"
        className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-xl transition-colors hover:bg-white/5"
        style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#94A3B8' }}
      >
        <Heart className="h-5 w-5" />
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={handleToggle}
      aria-label={isFavorite ? 'Прибрати з обраного' : 'Додати в обране'}
      title={isFavorite ? 'Прибрати з обраного' : 'Додати в обране'}
      className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-xl transition-colors hover:bg-white/5 disabled:opacity-50"
      style={{
        border: `1px solid ${isFavorite ? 'rgba(255,107,0,0.45)' : 'rgba(255,255,255,0.1)'}`,
        color: isFavorite ? '#FF6B00' : '#94A3B8',
      }}
    >
      <Heart className="h-5 w-5" fill={isFavorite ? 'currentColor' : 'none'} />
    </button>
  );
}
