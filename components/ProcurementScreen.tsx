'use client';

// ============================================================
// Экран "Закупки" — управление цепочкой "заказ клиента -> заказ
// поставщику -> приёмка на склад" (секция 28 schema.sql). Две вкладки:
//
//   "Нужно заказать"    — позиции заказов клиентов в статусе 'pending',
//                          сгруппированные по поставщику. Можно отметить
//                          несколько позиций и одной кнопкой оформить
//                          заказ поставщику (order_items.status ->
//                          'ordered_from_supplier'), либо, если товар
//                          и так уже есть на складе, сразу нажать
//                          "Есть в наличии" — без похода к поставщику.
//   "Ожидают приёмки"    — уже заказанные у поставщика позиции
//                          ('ordered_from_supplier'). Здесь оформляется
//                          приходная накладная: вводится фактически
//                          принятое количество (может быть меньше
//                          заказанного — частичный приход) и закупочная
//                          цена, после чего товар зачисляется на склад
//                          и наш долг перед поставщиком растёт.
//
// Использует эндпоинты:
//   GET  /api/admin/procurement/needed?status=pending|ordered_from_supplier
//   POST /api/admin/procurement/order-from-supplier
//   POST /api/admin/procurement/mark-in-stock
//   POST /api/admin/procurement/receive
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';

interface NeededItem {
  id: string;
  orderId: string;
  article: string;
  brand: string | null;
  name: string | null;
  quantity: number;
  costPrice: number;
  currentStock: number | null;
  remainingToReceive: number | null;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  orderStatus: string;
  orderCreatedAt: string;
}

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  items: NeededItem[];
}

interface PrintGroup {
  supplierName: string;
  items: { article: string; brand: string | null; name: string | null; quantity: number; costPrice: number }[];
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

type Tab = 'toOrder' | 'toReceive';

export default function ProcurementScreen() {
  const [tab, setTab] = useState<Tab>('toOrder');

  const [toOrderGroups, setToOrderGroups] = useState<SupplierGroup[]>([]);
  const [toReceiveGroups, setToReceiveGroups] = useState<SupplierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [printGroups, setPrintGroups] = useState<PrintGroup[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pendingRes, orderedRes] = await Promise.all([
        fetch('/api/admin/procurement/needed?status=pending'),
        fetch('/api/admin/procurement/needed?status=ordered_from_supplier'),
      ]);
      const pendingData = await pendingRes.json();
      const orderedData = await orderedRes.json();
      if (!pendingRes.ok) throw new Error(pendingData.error || 'Не удалось загрузить список "Нужно заказать"');
      if (!orderedRes.ok) throw new Error(orderedData.error || 'Не удалось загрузить список "Ожидают приёмки"');
      setToOrderGroups(pendingData.groups as SupplierGroup[]);
      setToReceiveGroups(orderedData.groups as SupplierGroup[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке закупок');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalToOrder = toOrderGroups.reduce((sum, g) => sum + g.items.length, 0);
  const totalToReceive = toReceiveGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <AdminLayout active="procurement">
      <header className="mb-6">
        <h1 className="text-xl font-semibold mb-1.5">Закупки у поставщиков</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Цепочка «заказ клиента → заказ поставщику → приёмка на склад → отгрузка». Отгрузка заказа возможна только
          после того, как все его позиции окажутся на складе.
        </p>
      </header>

      {(actionError || actionNotice) && (
        <div
          className="mb-4 px-4 py-3 rounded-md text-sm"
          style={
            actionError
              ? { background: 'var(--bad-soft)', color: 'var(--bad)' }
              : { background: 'var(--good-soft)', color: 'var(--good)' }
          }
        >
          {actionError || actionNotice}
        </div>
      )}

      <div className="flex gap-2 mb-5">
        <button
          type="button"
          onClick={() => setTab('toOrder')}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{
            background: tab === 'toOrder' ? 'var(--accent-soft)' : 'var(--surface)',
            color: tab === 'toOrder' ? 'var(--accent)' : 'var(--ink-muted)',
            border: '1px solid var(--line)',
          }}
        >
          Нужно заказать {totalToOrder > 0 && `(${totalToOrder})`}
        </button>
        <button
          type="button"
          onClick={() => setTab('toReceive')}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{
            background: tab === 'toReceive' ? 'var(--accent-soft)' : 'var(--surface)',
            color: tab === 'toReceive' ? 'var(--accent)' : 'var(--ink-muted)',
            border: '1px solid var(--line)',
          }}
        >
          Ожидают приёмки {totalToReceive > 0 && `(${totalToReceive})`}
        </button>
      </div>

      {loading && <p style={{ color: 'var(--ink-muted)' }}>Загрузка...</p>}
      {loadError && (
        <p className="text-sm mb-4" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchData} className="underline">
            Повторить
          </button>
        </p>
      )}

      {!loading && !loadError && tab === 'toOrder' && (
        <ToOrderTab
          groups={toOrderGroups}
          onRefresh={fetchData}
          onError={setActionError}
          onNotice={setActionNotice}
          onPrint={setPrintGroups}
        />
      )}

      {!loading && !loadError && tab === 'toReceive' && (
        <ToReceiveTab groups={toReceiveGroups} onRefresh={fetchData} onError={setActionError} onNotice={setActionNotice} />
      )}

      {printGroups && <PrintModal groups={printGroups} onClose={() => setPrintGroups(null)} />}
    </AdminLayout>
  );
}

// ============================================================
// ВКЛАДКА "НУЖНО ЗАКАЗАТЬ"
// ============================================================
function ToOrderTab({
  groups,
  onRefresh,
  onError,
  onNotice,
  onPrint,
}: {
  groups: SupplierGroup[];
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
  onPrint: (groups: PrintGroup[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: SupplierGroup) => {
    const allSelected = group.items.every((item) => selected.has(item.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of group.items) {
        if (allSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  };

  const handleOrderFromSupplier = async () => {
    if (selected.size === 0) return;
    onError(null);
    onNotice(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/procurement/order-from-supplier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderItemIds: Array.from(selected) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось оформить заказ поставщику');

      const bySupplier = new Map<string, PrintGroup>();
      for (const item of data.items as {
        supplierName: string | null;
        article: string;
        brand: string | null;
        name: string | null;
        quantity: number;
        costPrice: number;
      }[]) {
        const key = item.supplierName || 'Без поставщика';
        if (!bySupplier.has(key)) bySupplier.set(key, { supplierName: key, items: [] });
        bySupplier.get(key)!.items.push(item);
      }
      onPrint(Array.from(bySupplier.values()));

      onNotice(`Заказ поставщику оформлен: позиций — ${data.items.length}.`);
      setSelected(new Set());
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Ошибка сети при оформлении заказа поставщику');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkInStock = async (itemId: string) => {
    onError(null);
    onNotice(null);
    setMarkingId(itemId);
    try {
      const response = await fetch('/api/admin/procurement/mark-in-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderItemId: itemId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось отметить позицию');
      onNotice('Позиция отмечена как имеющаяся на складе.');
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setMarkingId(null);
    }
  };

  if (groups.length === 0) {
    return <p style={{ color: 'var(--ink-muted)' }}>Всё заказано — нет позиций, ожидающих закупки.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {selected.size > 0 && (
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 rounded-md"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
        >
          <span className="text-sm">Выбрано позиций: {selected.size}</span>
          <button
            type="button"
            disabled={submitting}
            onClick={handleOrderFromSupplier}
            className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {submitting ? 'Оформление...' : 'Сформировать заказ поставщику'}
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.supplierId || 'none'} className="rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
            <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={group.items.every((item) => selected.has(item.id))}
                onChange={() => toggleGroup(group)}
              />
              {group.supplierName}
              <span className="text-xs font-normal" style={{ color: 'var(--ink-faint)' }}>
                ({group.items.length})
              </span>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--ink-faint)' }}>
                  <th className="text-left px-4 py-2 font-normal"></th>
                  <th className="text-left px-2 py-2 font-normal">Товар</th>
                  <th className="text-left px-2 py-2 font-normal">Заказ</th>
                  <th className="text-right px-2 py-2 font-normal">Кол-во</th>
                  <th className="text-right px-2 py-2 font-normal">Закупка</th>
                  <th className="text-right px-2 py-2 font-normal">На складе</th>
                  <th className="text-right px-4 py-2 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => {
                  const hasStock = item.currentStock !== null && item.currentStock >= item.quantity;
                  return (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                      </td>
                      <td className="px-2 py-2">
                        <div>{item.name || item.article}</div>
                        <div className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                          {item.brand} {item.article}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <div>
                          {item.customerName} {item.customerSurname}
                        </div>
                        <div style={{ color: 'var(--ink-faint)' }}>
                          {item.customerPhone} · {formatDate(item.orderCreatedAt)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">{item.quantity}</td>
                      <td className="px-2 py-2 text-right font-mono">{formatMoney(item.costPrice)}</td>
                      <td className="px-2 py-2 text-right" style={{ color: hasStock ? 'var(--good)' : 'var(--ink-faint)' }}>
                        {item.currentStock ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {hasStock && (
                          <button
                            type="button"
                            disabled={markingId === item.id}
                            onClick={() => handleMarkInStock(item.id)}
                            className="text-xs px-2.5 py-1.5 rounded-md disabled:opacity-50"
                            style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                          >
                            {markingId === item.id ? '...' : 'Есть в наличии'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ============================================================
// ВКЛАДКА "ОЖИДАЮТ ПРИЁМКИ"
// ============================================================
interface ReceiveDraft {
  checked: boolean;
  quantity: string;
  costPrice: string;
}

function ToReceiveTab({
  groups,
  onRefresh,
  onError,
  onNotice,
}: {
  groups: SupplierGroup[];
  onRefresh: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, ReceiveDraft>>({});
  const [invoiceMeta, setInvoiceMeta] = useState<Record<string, { invoiceNumber: string; comment: string }>>({});
  const [submittingSupplierId, setSubmittingSupplierId] = useState<string | null>(null);

  const draftFor = (item: NeededItem): ReceiveDraft =>
    drafts[item.id] || { checked: true, quantity: String(item.remainingToReceive ?? item.quantity), costPrice: String(item.costPrice) };

  const updateDraft = (itemId: string, patch: Partial<ReceiveDraft>, item: NeededItem) => {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...draftFor(item), ...prev[itemId], ...patch } }));
  };

  const metaFor = (supplierKey: string) => invoiceMeta[supplierKey] || { invoiceNumber: '', comment: '' };

  const handleReceive = async (group: SupplierGroup) => {
    if (!group.supplierId) {
      onError('У позиций без поставщика приход оформить нельзя — сначала привяжите товар к поставщику в каталоге.');
      return;
    }
    onError(null);
    onNotice(null);

    const items = group.items
      .map((item) => ({ item, draft: draftFor(item) }))
      .filter(({ draft }) => draft.checked)
      .map(({ item, draft }) => ({
        orderItemId: item.id,
        quantity: parseInt(draft.quantity, 10),
        costPrice: parseFloat(draft.costPrice),
      }));

    if (items.length === 0) {
      onError('Отметьте хотя бы одну позицию для приёмки.');
      return;
    }
    if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity <= 0)) {
      onError('Количество должно быть целым числом больше нуля.');
      return;
    }
    if (items.some((i) => !Number.isFinite(i.costPrice) || i.costPrice < 0)) {
      onError('Закупочная цена указана некорректно.');
      return;
    }

    const meta = metaFor(group.supplierId);
    setSubmittingSupplierId(group.supplierId);
    try {
      const response = await fetch('/api/admin/procurement/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierId: group.supplierId,
          invoiceNumber: meta.invoiceNumber || undefined,
          comment: meta.comment || undefined,
          items,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось оформить приход товара');

      onNotice(`Приход оформлен на сумму ${formatMoney(data.totalAmount)} грн. Новый долг перед поставщиком: ${formatMoney(data.newSupplierBalance)} грн.`);
      onRefresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Ошибка сети при оформлении прихода');
    } finally {
      setSubmittingSupplierId(null);
    }
  };

  if (groups.length === 0) {
    return <p style={{ color: 'var(--ink-muted)' }}>Нет позиций, заказанных у поставщика и ожидающих приёмки.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const supplierKey = group.supplierId || 'none';
        const meta = metaFor(supplierKey);
        return (
          <section
            key={supplierKey}
            className="rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <div className="px-4 py-3 text-sm font-semibold" style={{ borderBottom: '1px solid var(--line)' }}>
              {group.supplierName} <span className="text-xs font-normal" style={{ color: 'var(--ink-faint)' }}>({group.items.length})</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--ink-faint)' }}>
                    <th className="text-left px-4 py-2 font-normal"></th>
                    <th className="text-left px-2 py-2 font-normal">Товар</th>
                    <th className="text-left px-2 py-2 font-normal">Заказ</th>
                    <th className="text-right px-2 py-2 font-normal">Заказано</th>
                    <th className="text-right px-2 py-2 font-normal">Принять сейчас</th>
                    <th className="text-right px-4 py-2 font-normal">Закупочная цена</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const draft = draftFor(item);
                    return (
                      <tr key={item.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={draft.checked}
                            onChange={(e) => updateDraft(item.id, { checked: e.target.checked }, item)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div>{item.name || item.article}</div>
                          <div className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                            {item.brand} {item.article}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <div>
                            {item.customerName} {item.customerSurname}
                          </div>
                          <div style={{ color: 'var(--ink-faint)' }}>{item.customerPhone}</div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {item.remainingToReceive !== item.quantity ? (
                            <span title="Есть предыдущий частичный приход">
                              {item.remainingToReceive} из {item.quantity}
                            </span>
                          ) : (
                            item.quantity
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={1}
                            max={item.remainingToReceive ?? item.quantity}
                            className="w-20 px-2 py-1 text-right text-sm rounded-md font-mono"
                            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
                            value={draft.quantity}
                            onChange={(e) => updateDraft(item.id, { quantity: e.target.value }, item)}
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            className="w-24 px-2 py-1 text-right text-sm rounded-md font-mono"
                            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
                            value={draft.costPrice}
                            onChange={(e) => updateDraft(item.id, { costPrice: e.target.value }, item)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                  № накладной
                </label>
                <input
                  type="text"
                  className="px-3 py-1.5 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
                  value={meta.invoiceNumber}
                  onChange={(e) => setInvoiceMeta((prev) => ({ ...prev, [supplierKey]: { ...meta, invoiceNumber: e.target.value } }))}
                />
              </div>
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Комментарий
                </label>
                <input
                  type="text"
                  className="w-full px-3 py-1.5 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)' }}
                  value={meta.comment}
                  onChange={(e) => setInvoiceMeta((prev) => ({ ...prev, [supplierKey]: { ...meta, comment: e.target.value } }))}
                />
              </div>
              <button
                type="button"
                disabled={submittingSupplierId === group.supplierId}
                onClick={() => handleReceive(group)}
                className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                {submittingSupplierId === group.supplierId ? 'Оформление...' : 'Оформить приход'}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ============================================================
// МОДАЛКА "ПЕЧАТНАЯ ФОРМА ЗАКАЗА ПОСТАВЩИКУ"
// ============================================================
function PrintModal({ groups, onClose }: { groups: PrintGroup[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg p-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Заказ поставщику оформлен</h2>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Закрыть
          </button>
        </div>

        <div id="procurement-print-area">
          {groups.map((group) => (
            <div key={group.supplierName} className="mb-5">
              <h3 className="text-sm font-semibold mb-2">{group.supplierName}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--ink-faint)' }}>
                    <th className="text-left py-1 font-normal">Артикул</th>
                    <th className="text-left py-1 font-normal">Бренд</th>
                    <th className="text-left py-1 font-normal">Название</th>
                    <th className="text-right py-1 font-normal">Кол-во</th>
                    <th className="text-right py-1 font-normal">Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="py-1 font-mono">{item.article}</td>
                      <td className="py-1">{item.brand}</td>
                      <td className="py-1">{item.name}</td>
                      <td className="py-1 text-right">{item.quantity}</td>
                      <td className="py-1 text-right font-mono">{formatMoney(item.costPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="w-full py-2.5 rounded-md text-sm font-medium mt-2"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          Печать
        </button>
      </div>
    </div>
  );
}
