'use client';

// ============================================================
// Управление пользователями админки (страница /admin/managers).
// Только для владельца. Использует:
//   GET   /api/admin/users       — список
//   POST  /api/admin/users       — создать
//   PATCH /api/admin/users/[id]  — имя, роль, отключение, новый пароль
// Оформление берёт CSS-переменные из components/AdminLayout.tsx.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type Role = 'owner' | 'manager';

interface AdminUser {
  id: string;
  login: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const ROLE_LABELS: Record<Role, string> = { owner: 'Власник', manager: 'Менеджер' };

const inputStyle = { border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' };

function formatDate(value: string | null): string {
  if (!value) return 'ещё не входил';
  return new Date(value).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ManagersManager() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма "Новый сотрудник" ----
  const [form, setForm] = useState({ login: '', name: '', password: '', role: 'manager' as Role });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ---- действия над существующим пользователем ----
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить список');
      setUsers(data.users as AdminUser[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    setNotice(null);
    setCreating(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось создать');
      setForm({ login: '', name: '', password: '', role: 'manager' });
      setNotice(`Сотрудник «${data.user.name}» создан. Передайте ему логин и пароль.`);
      await fetchUsers();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setCreating(false);
    }
  };

  // Общая функция для всех изменений — одна точка для ошибок и
  // обновления списка
  const patchUser = async (user: AdminUser, changes: Record<string, unknown>, successMessage: string) => {
    setActionError(null);
    setNotice(null);
    setBusyId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить');
      setNotice(successMessage);
      await fetchUsers();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = (user: AdminUser) => {
    const password = window.prompt(`Новый пароль для «${user.name}» (не короче 8 символов):`);
    if (!password) return;
    patchUser(user, { password }, `Пароль для «${user.name}» изменён, его старые входы закрыты.`);
  };

  const handleToggleActive = (user: AdminUser) => {
    const message = user.isActive
      ? `Отключить «${user.name}»? Он сразу потеряет доступ.`
      : `Включить «${user.name}» обратно?`;
    if (!window.confirm(message)) return;
    patchUser(user, { isActive: !user.isActive }, user.isActive ? 'Сотрудник отключён.' : 'Сотрудник включён.');
  };

  const handleRename = (user: AdminUser) => {
    const name = window.prompt('Новое имя:', user.name);
    if (!name || name.trim() === user.name) return;
    patchUser(user, { name }, 'Имя изменено.');
  };

  const handleRoleChange = (user: AdminUser) => {
    const next: Role = user.role === 'owner' ? 'manager' : 'owner';
    if (!window.confirm(`Сделать «${user.name}»: ${ROLE_LABELS[next]}?`)) return;
    patchUser(user, { role: next }, 'Роль изменена, его старые входы закрыты — войти нужно заново.');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ==================== НОВЫЙ СОТРУДНИК ==================== */}
      <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <h2 className="text-base font-semibold mb-3">Новый сотрудник</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Имя (как будет видно в заказах)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="px-3 py-2 text-sm rounded-md"
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Логин (латиница, напр. ivan)"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
            autoComplete="off"
            className="px-3 py-2 text-sm rounded-md font-mono"
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Пароль (от 8 символов)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="off"
            className="px-3 py-2 text-sm rounded-md font-mono"
            style={inputStyle}
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="px-3 py-2 text-sm rounded-md"
            style={inputStyle}
          >
            <option value="manager">Менеджер</option>
            <option value="owner">Власник (полный доступ)</option>
          </select>

          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={creating}
              className="px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {creating ? 'Создание...' : 'Создать'}
            </button>
            {createError && (
              <span className="text-xs" style={{ color: 'var(--bad)' }}>
                {createError}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* ==================== СПИСОК ==================== */}
      <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <h2 className="text-base font-semibold mb-3">Сотрудники</h2>

        {notice && (
          <p className="text-xs mb-3" style={{ color: 'var(--good)' }}>
            {notice}
          </p>
        )}
        {actionError && (
          <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
            {actionError}
          </p>
        )}
        {loadError && (
          <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchUsers} className="underline">
              Повторить
            </button>
          </p>
        )}
        {loading && users.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Загрузка...
          </p>
        )}

        <div className="flex flex-col">
          {users.map((user) => {
            const actions: Array<{ label: string; onClick: () => void }> = [
              { label: 'Имя', onClick: () => handleRename(user) },
              { label: 'Пароль', onClick: () => handleResetPassword(user) },
              {
                label: user.role === 'owner' ? 'Сделать менеджером' : 'Сделать владельцем',
                onClick: () => handleRoleChange(user),
              },
              { label: user.isActive ? 'Отключить' : 'Включить', onClick: () => handleToggleActive(user) },
            ];

            return (
              <div
                key={user.id}
                className="py-3 flex flex-wrap items-center justify-between gap-3"
                style={{ borderTop: '1px solid var(--line)', opacity: user.isActive ? 1 : 0.55 }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {user.name}{' '}
                    <span
                      className="ml-1 text-[11px] px-1.5 py-0.5 rounded"
                      style={{
                        background: user.role === 'owner' ? 'var(--accent-soft)' : 'var(--surface-2)',
                        color: user.role === 'owner' ? 'var(--accent)' : 'var(--ink-muted)',
                      }}
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                    {!user.isActive && (
                      <span className="ml-1 text-[11px]" style={{ color: 'var(--bad)' }}>
                        отключён
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                    {user.login} · вход: {formatDate(user.lastLoginAt)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={busyId === user.id}
                      onClick={action.onClick}
                      className="px-3 py-1.5 rounded-md disabled:opacity-50"
                      style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
