'use client';

// ============================================================
// Экран "VIN-запросы" — заявки покупателей на подбор детали по VIN,
// оставленные через блок "Підбір за VIN" на витрине
// (components/StorefrontHome.tsx). Покупатель, который не нашёл
// деталь по артикулу, просто оставляет VIN-код авто, телефон и
// описание того, что ищет — здесь администратор видит эти заявки и
// отмечает их обработанными после того, как перезвонил и подобрал деталь.
//
// Использует эндпоинты:
//   GET   /api/vin-requests?status=...&page=...
//   PATCH /api/vin-requests/[id]  — сменить статус (new -> done)
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';

type VinRequestStatus = 'new' | 'done';

interface VinRequest {
  id: string;
  vinCode: string;
  customerPhone: string;
  description: string;
  status: VinRequestStatus;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

const STATUS_LABELS: Record<VinRequestStatus, string> = {
  new: 'Нова',
  done: 'Оброблено',
};

const STATUS_COLORS: Record<VinRequestStatus, { bg: string; fg: string }> = {
  new: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  done: { bg: 'var(--good-soft)', fg: 'var(--good)' },
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function VinRequestsScreen() {
  const [requests, setRequests] = useState<VinRequest[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<VinRequestStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (statusFilter) params.set('status', statusFilter);

      const response = await fetch(`/api/vin-requests?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось получить список заявок');
      }
      setRequests(data.vinRequests as VinRequest[]);
      setPagination(data.pagination as Pagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заявок');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Смена фильтра — сбрасываем страницу на первую, иначе легко
  // застрять на несуществующей странице 3, если после фильтра заявок
  // стало меньше
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const toggleStatus = async (request: VinRequest) => {
    const nextStatus: VinRequestStatus = request.status === 'new' ? 'done' : 'new';

    setUpdatingId(request.id);
    try {
      const response = await fetch(`/api/vin-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось обновить статус');
      }
      setRequests((prev) =>
        prev.map((item) => (item.id === request.id ? { ...item, status: nextStatus } : item))
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при обновлении статуса');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <AdminLayout active="vinRequests">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / VIN-запросы
      </p>
      <h1 className="text-2xl font-semibold mb-1">VIN-запросы</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Заявки покупателей на подбор детали по VIN-коду автомобиля — блок «Підбір за VIN» на
        витрине. {pagination ? `Всего: ${pagination.totalCount}.` : ''}
      </p>

      <div
        className="p-4 rounded-lg mb-5"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
          Статус
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as VinRequestStatus | '')}
          className="px-3 py-2 text-sm rounded-md"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
        >
          <option value="">Все статусы</option>
          <option value="new">Нові</option>
          <option value="done">Оброблені</option>
        </select>
      </div>

      {loadError && (
        <p className="text-sm p-4 rounded-lg mb-5" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        {loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loading && requests.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Заявок не найдено.
          </p>
        )}

        {!loading && requests.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Дата', 'VIN-код', 'Телефон', 'Що шукає', 'Статус', ''].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-4 py-2.5 text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const colors = STATUS_COLORS[request.status];
                  return (
                    <tr key={request.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                        {formatDateTime(request.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{request.vinCode}</td>
                      <td className="px-4 py-3 font-mono whitespace-nowrap">{request.customerPhone}</td>
                      <td className="px-4 py-3" style={{ maxWidth: '360px' }}>
                        {request.description}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium"
                          style={{ background: colors.bg, color: colors.fg }}
                        >
                          {STATUS_LABELS[request.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={updatingId === request.id}
                          onClick={() => toggleStatus(request)}
                          className="text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
                          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {updatingId === request.id
                            ? 'Сохранение...'
                            : request.status === 'new'
                              ? 'Позначити оброблено'
                              : 'Повернути в нові'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((prev) => prev - 1)}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            ← Назад
          </button>
          <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Стор. {pagination.page} з {pagination.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((prev) => prev + 1)}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Далі →
          </button>
        </div>
      )}
    </AdminLayout>
  );
}
