'use client';

// ============================================================
// Страница входа в админ-панель — единственная страница под /admin/*,
// которую middleware.ts НЕ защищает паролем (иначе войти было бы
// просто некуда). Сам вход — POST /api/admin/login, который при
// верном пароле выдаёт cookie-сессию; дальше её на каждый заход
// проверяет middleware.ts.
//
// ?next=/admin/orders в адресе — куда вернуть админа после успешного
// входа (страница, которую он изначально пытался открыть, а не
// всегда просто /admin) — этот параметр туда кладёт само middleware,
// когда перенаправляет неавторизованного посетителя сюда
//
// 'use client' обязателен: страница использует хуки (useState) и
// работает с браузерным fetch/window.location
// ============================================================

import { useState } from 'react';
import type { FormEvent } from 'react';

export default function AdminLoginPage() {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось войти');
      }

      // Полная перезагрузка страницы (а не клиентская навигация) —
      // так middleware.ts гарантированно увидит уже установленную
      // cookie на следующем же запросе
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('next') || '/admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сети при входе');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5"
      style={{ background: '#0B0F17', color: '#E7ECF3' }}
    >
      <div
        className="w-full max-w-sm p-7 rounded-2xl"
        style={{ background: '#131826', border: '1px solid #232B3D' }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base mb-5"
          style={{ background: '#5B6EF5', color: '#FFFFFF' }}
        >
          A
        </div>
        <h1 className="text-xl font-bold mb-1.5">Вход в админ-панель</h1>
        <p className="text-sm mb-6" style={{ color: '#8B96AB' }}>
          Введите пароль администратора, чтобы продолжить.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль"
              autoFocus
              className="w-full px-4 py-3 text-sm rounded-lg outline-none"
              style={{
                border: `1px solid ${error ? '#F2635F' : '#232B3D'}`,
                background: '#1A2233',
                color: '#E7ECF3',
              }}
            />
            {error && (
              <p className="text-xs mt-1.5" style={{ color: '#F2635F' }}>
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !password.trim()}
            className="w-full py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ background: '#5B6EF5', color: '#FFFFFF' }}
          >
            {submitting ? 'Проверяем...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
