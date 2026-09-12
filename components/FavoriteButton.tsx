'use client';

// ============================================================
// Кнопка "У обране" на сторінці товару (components/ProductDetailContent.tsx).
// Той самий принцип, що і в components/AddToCartButton.tsx: сторінка
// товару — Server Component, тому робота з телефоном/API покупця
// винесена в окремий маленький клієнтський компонент.
//
// Телефон береться з localStorage (PHONE_STORAGE_KEY — той самий
// ключ, яким "вхід" у кабінет зберігає його, див.
// components/CustomerDashboard.tsx) — якщо покупець ще не заходив у
// кабінет, телефону немає і кнопка веде на /account замість виклику API.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';

const PHONE_STORAGE_KEY = 'autokontur-customer-phone';

interface FavoriteButtonProps {
  productId: string;
}

export default function FavoriteButton({ productId }: FavoriteButtonProps) {
  const [phone, setPhone] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let savedPhone: string | null = null;
    try {
      savedPhone = window.localStorage.getItem(PHONE_STORAGE_KEY);
    } catch {
      // localStorage недоступний — просто лишаємось без телефону,
      // кнопка поведе на /account
    }
    setPhone(savedPhone);

    if (!savedPhone) {
      setChecking(false);
      return;
    }

    fetch(`/api/customer/favorites?${new URLSearchParams({ phone: savedPhone }).toString()}`)
      .then((response) => response.json())
      .then((data) => {
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
    if (!phone) return;

    setSaving(true);
    try {
      if (isFavorite) {
        const response = await fetch(
          `/api/customer/favorites/${productId}?${new URLSearchParams({ phone }).toString()}`,
          { method: 'DELETE' }
        );
        if (response.ok) setIsFavorite(false);
      } else {
        const response = await fetch('/api/customer/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, productId }),
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

  if (!phone) {
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
