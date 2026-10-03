'use client';

// ============================================================
// Блок "Менеджер заказа" в шапке окна заказа (OrderDetailsModal).
// Показывает, кто ведёт заказ, и даёт:
//   - "Взять в работу" — если заказ ничей;
//   - "Передать" другому сотруднику и "Снять с себя" — текущему
//     ответственному и владельцу;
//   - владельцу — назначить незанятый заказ любому сотруднику.
// Сами правила проверяет сервер (POST /api/orders/[id]/assign), здесь
// кнопки лишь показываются по тем же правилам, чтобы не вводить в
// заблуждение.
// ============================================================

import { useEffect, useState } from 'react';

export interface AssignedManager {
  id: string;
  name: string;
}

interface Assignee {
  id: string;
  name: string;
  role: 'owner' | 'manager';
}

interface Me {
  id: string | null;
  role: 'owner' | 'manager';
}

export default function OrderManagerAssign({
  orderId,
  assigned,
  onChanged,
}: {
  orderId: string;
  assigned: AssignedManager | null;
  onChanged: (next: AssignedManager | null) => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/me')
      .then((response) => response.json())
      .then((data) => {
        if (data.user) setMe({ id: data.user.id, role: data.user.role });
      })
      .catch(() => {
        // Без этого кнопок просто не будет — окно заказа работает и так
      });
    fetch('/api/admin/assignees')
      .then((response) => response.json())
      .then((data) => {
        if (data.users) setAssignees(data.users as Assignee[]);
      })
      .catch(() => {
        // Список нужен только для "Передать"
      });
  }, []);

  const assign = async (managerId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося змінити менеджера');
      onChanged(data.assignedManager as AssignedManager | null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка мережі');
    } finally {
      setBusy(false);
    }
  };

  const isOwner = me?.role === 'owner';
  const isMine = Boolean(me?.id && assigned && assigned.id === me.id);
  const canTake = Boolean(me?.id) && !assigned;
  const canManage = Boolean(assigned) && (isMine || isOwner);
  // Кому можно передать: все активные, кроме текущего ответственного.
  // Незанятый заказ другому назначает только владелец
  const transferTargets = assignees.filter((user) => user.id !== assigned?.id && user.id !== me?.id);
  const canTransfer = (canManage || (!assigned && isOwner)) && transferTargets.length > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs">
      <span style={{ color: 'var(--ink-faint)' }}>Менеджер:</span>
      {assigned ? (
        <span
          className="px-2 py-0.5 rounded-full font-medium"
          style={{
            background: isMine ? 'var(--accent-soft)' : 'var(--surface-2)',
            color: isMine ? 'var(--accent)' : 'var(--ink)',
          }}
        >
          {assigned.name}
          {isMine ? ' (ви)' : ''}
        </span>
      ) : (
        <span style={{ color: 'var(--warn)' }}>не призначено</span>
      )}

      {canTake && (
        <button
          type="button"
          disabled={busy}
          onClick={() => assign(me?.id ?? null)}
          className="px-2.5 py-1 rounded-md font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Взяти в роботу
        </button>
      )}

      {canTransfer && (
        <select
          disabled={busy}
          value=""
          onChange={(e) => {
            if (e.target.value) assign(e.target.value);
          }}
          className="px-2 py-1 rounded-md disabled:opacity-50"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink-muted)' }}
        >
          <option value="">{assigned ? 'Передати…' : 'Призначити…'}</option>
          {transferTargets.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      )}

      {/* Владельцу — забрать заказ себе у другого менеджера */}
      {assigned && !isMine && isOwner && me?.id && (
        <button
          type="button"
          disabled={busy}
          onClick={() => assign(me.id)}
          className="px-2.5 py-1 rounded-md disabled:opacity-50"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
        >
          Забрати собі
        </button>
      )}

      {canManage && (
        <button
          type="button"
          disabled={busy}
          onClick={() => assign(null)}
          className="px-2.5 py-1 rounded-md disabled:opacity-50"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
        >
          {isMine ? 'Зняти з себе' : 'Зняти з менеджера'}
        </button>
      )}

      {error && <span style={{ color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}
