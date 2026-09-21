'use client';

// ============================================================
// Экран "Кассы и Финансы" (/admin/treasury) — секция 29 schema.sql:
// физическое местонахождение денег (касса магазина, эквайринг,
// расчётный счёт), в отличие от /admin/reports, который считает
// прибыль и долги, а не "где лежат деньги прямо сейчас".
//
// Использует эндпоинты:
//   GET  /api/admin/cash-registers            — список касс
//   POST /api/admin/cash-registers             — новая касса
//   PATCH /api/admin/cash-registers/[id]       — переименовать / деактивировать
//   POST /api/admin/cash-registers/transfer     — перевод между кассами
//   POST /api/admin/cash-registers/entry        — прочий доход/расход
//   GET  /api/admin/cash-registers/movements    — лента движений с фильтрами
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import AdminLayout from './AdminLayout';

interface CashRegister {
  id: string;
  name: string;
  type: 'cash' | 'bank_account' | 'card';
  balance: number;
  isActive: boolean;
}

interface CashMovement {
  id: string;
  cashRegisterId: string;
  cashRegisterName: string;
  amount: number;
  type: string;
  orderId: string | null;
  comment: string | null;
  createdBy: string | null;
  createdAt: string;
}

const REGISTER_TYPE_LABELS: Record<CashRegister['type'], string> = {
  cash: 'Наличные',
  bank_account: 'Расчётный счёт',
  card: 'Терминал/карта',
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  customer_prepayment: 'Предоплата от клиента',
  customer_payment: 'Оплата заказа клиентом',
  customer_refund: 'Возврат денег клиенту',
  supplier_payment: 'Оплата поставщику',
  transfer_out: 'Перевод — списание',
  transfer_in: 'Перевод — зачисление',
  expense: 'Прочий расход',
  income: 'Прочий доход',
};

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PAGE_SIZE = 30;

export default function TreasuryScreen() {
  const [registers, setRegisters] = useState<CashRegister[]>([]);
  const [loadingRegisters, setLoadingRegisters] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [movementsTotal, setMovementsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMovements, setLoadingMovements] = useState(true);

  const [filterRegisterId, setFilterRegisterId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [modal, setModal] = useState<'new' | 'transfer' | 'entry' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchRegisters = useCallback(async () => {
    setLoadingRegisters(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/cash-registers');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить кассы');
      setRegisters(data.registers as CashRegister[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке касс');
    } finally {
      setLoadingRegisters(false);
    }
  }, []);

  const fetchMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (filterRegisterId) params.set('registerId', filterRegisterId);
      if (filterType) params.set('type', filterType);
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const response = await fetch(`/api/admin/cash-registers/movements?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить ленту движений');
      setMovements(data.movements as CashMovement[]);
      setMovementsTotal(data.pagination.totalCount);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке ленты движений');
    } finally {
      setLoadingMovements(false);
    }
  }, [page, filterRegisterId, filterType, filterDateFrom, filterDateTo]);

  useEffect(() => {
    fetchRegisters();
  }, [fetchRegisters]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  const refreshAll = () => {
    fetchRegisters();
    fetchMovements();
  };

  const totalPages = Math.max(1, Math.ceil(movementsTotal / PAGE_SIZE));

  return (
    <AdminLayout active="treasury">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold mb-1.5">Кассы и финансы</h1>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Где физически лежат деньги прямо сейчас — наличные, эквайринг, расчётные счета.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModal('entry')}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Доход / расход
          </button>
          <button
            type="button"
            onClick={() => setModal('transfer')}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Перевод между кассами
          </button>
          <button
            type="button"
            onClick={() => setModal('new')}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            + Новая касса
          </button>
        </div>
      </header>

      {notice && (
        <div className="mb-4 px-4 py-3 rounded-md text-sm" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
          {notice}
        </div>
      )}
      {loadError && (
        <p className="text-sm mb-4" style={{ color: 'var(--bad)' }}>
          {loadError}
        </p>
      )}

      {/* ==================== КАРТОЧКИ КАСС ==================== */}
      {loadingRegisters ? (
        <p style={{ color: 'var(--ink-muted)' }}>Загрузка...</p>
      ) : registers.length === 0 ? (
        <p style={{ color: 'var(--ink-muted)' }}>Касс ещё нет — создайте первую.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {registers.map((register) => (
            <div
              key={register.id}
              className="p-4 rounded-lg"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                opacity: register.isActive ? 1 : 0.5,
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold">{register.name}</p>
                  <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                    {REGISTER_TYPE_LABELS[register.type]}
                    {!register.isActive && ' · неактивна'}
                  </p>
                </div>
              </div>
              <p className="text-2xl font-semibold font-mono">{formatMoney(register.balance)} ₴</p>
            </div>
          ))}
        </div>
      )}

      {/* ==================== ЛЕНТА ДВИЖЕНИЙ ==================== */}
      <section className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <div className="flex flex-wrap items-end gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <h2 className="text-base font-semibold mr-auto">Лента движений</h2>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              Касса
            </label>
            <select
              value={filterRegisterId}
              onChange={(e) => {
                setPage(1);
                setFilterRegisterId(e.target.value);
              }}
              className="px-2.5 py-1.5 text-xs rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            >
              <option value="">Все кассы</option>
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              Тип операции
            </label>
            <select
              value={filterType}
              onChange={(e) => {
                setPage(1);
                setFilterType(e.target.value);
              }}
              className="px-2.5 py-1.5 text-xs rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            >
              <option value="">Все типы</option>
              {Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              С
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => {
                setPage(1);
                setFilterDateFrom(e.target.value);
              }}
              className="px-2.5 py-1.5 text-xs rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
          </div>
          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
              По
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                setPage(1);
                setFilterDateTo(e.target.value);
              }}
              className="px-2.5 py-1.5 text-xs rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
          </div>
        </div>

        {loadingMovements ? (
          <p className="text-sm px-5 py-4" style={{ color: 'var(--ink-muted)' }}>
            Загрузка...
          </p>
        ) : movements.length === 0 ? (
          <p className="text-sm px-5 py-4" style={{ color: 'var(--ink-faint)' }}>
            Движений не найдено.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Дата', 'Касса', 'Тип', 'Сумма', 'Комментарий'].map((h) => (
                    <th key={h} className="text-left px-5 py-2 text-xs font-medium whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td className="px-5 py-2 whitespace-nowrap text-xs" style={{ color: 'var(--ink-faint)' }}>
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td className="px-5 py-2 whitespace-nowrap">{m.cashRegisterName}</td>
                    <td className="px-5 py-2 whitespace-nowrap">{MOVEMENT_TYPE_LABELS[m.type] || m.type}</td>
                    <td className="px-5 py-2 whitespace-nowrap font-mono" style={{ color: m.amount >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                      {m.amount >= 0 ? '+' : ''}
                      {formatMoney(m.amount)}
                    </td>
                    <td className="px-5 py-2 text-xs" style={{ color: 'var(--ink-muted)' }}>
                      {m.comment || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-muted)' }}>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
              ← Назад
            </button>
            <span>
              Страница {page} из {totalPages}
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">
              Вперёд →
            </button>
          </div>
        )}
      </section>

      {modal === 'new' && (
        <NewRegisterModal
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            refreshAll();
          }}
        />
      )}
      {modal === 'transfer' && (
        <TransferModal
          registers={registers}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            refreshAll();
          }}
        />
      )}
      {modal === 'entry' && (
        <EntryModal
          registers={registers}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            refreshAll();
          }}
        />
      )}
    </AdminLayout>
  );
}

// ============================================================
// Общая обёртка модалки
// ============================================================
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-lg p-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = { border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' } as const;

// ============================================================
// Модалка "Новая касса"
// ============================================================
function NewRegisterModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'cash' | 'bank_account' | 'card'>('cash');
  const [openingBalance, setOpeningBalance] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Укажите название кассы.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/cash-registers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          openingBalance: openingBalance ? parseFloat(openingBalance) : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось создать кассу');
      onDone(`Касса «${name.trim()}» создана.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сети');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Новая касса или счёт" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Название
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="напр. Касса Магазин №1"
            className="w-full px-3 py-2 text-sm rounded-md"
            style={inputStyle}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Тип
          </label>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle}>
            <option value="cash">Наличные</option>
            <option value="bank_account">Расчётный счёт</option>
            <option value="card">Терминал/карта</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Начальный остаток (необязательно)
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md font-mono"
            style={inputStyle}
          />
        </div>
        {error && (
          <p className="text-xs" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={saving} className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          {saving ? 'Создание...' : 'Создать кассу'}
        </button>
      </form>
    </ModalShell>
  );
}

// ============================================================
// Модалка "Перевод между кассами"
// ============================================================
function TransferModal({ registers, onClose, onDone }: { registers: CashRegister[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRegisters = registers.filter((r) => r.isActive);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!fromId || !toId) {
      setError('Выберите обе кассы.');
      return;
    }
    if (fromId === toId) {
      setError('Касса-источник и касса-получатель должны отличаться.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Сумма должна быть положительным числом.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/cash-registers/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromCashRegisterId: fromId, toCashRegisterId: toId, amount: parsedAmount, comment: comment || undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось выполнить перевод');
      onDone(`Переведено ${parsedAmount.toLocaleString('ru-RU')} ₴.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сети');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Перевод между кассами" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Откуда
          </label>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle}>
            <option value="">Выберите кассу</option>
            {activeRegisters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({formatMoney(r.balance)} ₴)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Куда
          </label>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle}>
            <option value="">Выберите кассу</option>
            {activeRegisters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({formatMoney(r.balance)} ₴)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Сумма, грн
          </label>
          <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 text-sm rounded-md font-mono" style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Комментарий (необязательно)
          </label>
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="напр. инкассация вечерней выручки" className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle} />
        </div>
        {error && (
          <p className="text-xs" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={saving} className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          {saving ? 'Перевод...' : 'Перевести'}
        </button>
      </form>
    </ModalShell>
  );
}

// ============================================================
// Модалка "Доход / расход"
// ============================================================
function EntryModal({ registers, onClose, onDone }: { registers: CashRegister[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [cashRegisterId, setCashRegisterId] = useState('');
  const [direction, setDirection] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeRegisters = registers.filter((r) => r.isActive);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAmount = parseFloat(amount);
    if (!cashRegisterId) {
      setError('Выберите кассу.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Сумма должна быть положительным числом.');
      return;
    }
    if (!comment.trim()) {
      setError('Укажите комментарий — на что расход или откуда доход.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/cash-registers/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashRegisterId, direction, amount: parsedAmount, comment: comment.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось записать операцию');
      onDone(direction === 'income' ? 'Доход записан.' : 'Расход записан.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сети');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Прочий доход / расход" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Касса
          </label>
          <select value={cashRegisterId} onChange={(e) => setCashRegisterId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle}>
            <option value="">Выберите кассу</option>
            {activeRegisters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({formatMoney(r.balance)} ₴)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Направление
          </label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle}>
            <option value="expense">Расход (аренда, зарплата, логистика...)</option>
            <option value="income">Доход (взнос учредителя и т.п.)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Сумма, грн
          </label>
          <input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 text-sm rounded-md font-mono" style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
            Комментарий
          </label>
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="напр. аренда за сентябрь" className="w-full px-3 py-2 text-sm rounded-md" style={inputStyle} />
        </div>
        {error && (
          <p className="text-xs" style={{ color: 'var(--bad)' }}>
            {error}
          </p>
        )}
        <button type="submit" disabled={saving} className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          {saving ? 'Сохранение...' : 'Записать'}
        </button>
      </form>
    </ModalShell>
  );
}
