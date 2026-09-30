'use client';

// ============================================================
// Экран "К отгрузке" (/admin/shipping) — все заказы, которые готовы
// уехать клиенту прямо сейчас (статус "На складе" или "Готов к выдаче"),
// на одном экране. Оператор отмечает галочками несколько заказов и
// одной кнопкой:
//   1. создаёт ТТН Новой Почты для всех отмеченных, у кого её ещё нет;
//   2. печатает маркировки всех отмеченных одним PDF-файлом;
//   3. отмечает их отгруженными (списание со склада + начисление
//      суммы клиенту — всё это делает уже существующий PATCH заказа).
// Раньше то же самое приходилось делать, открывая каждый заказ по
// отдельности.
//
// Использует эндпоинты:
//   GET   /api/admin/shipping          — список заказов к отгрузке
//   POST  /api/orders/[id]/create-ttn  — создать ТТН (по одному заказу)
//   GET   /api/admin/shipping/labels   — маркировки пачкой (PDF)
//   PATCH /api/orders/[id]             — { status: 'shipped' }
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import AdminLayout from './AdminLayout';
import OrderDetailsModal from './OrderDetailsModal';
import PaymentBadge from './PaymentBadge';
import { STATUS_COLORS, STATUS_LABELS, formatDateTime, formatMoney, formatOrderNumber, type OrderStatus } from '@/lib/orderUi';

interface ShippingOrder {
  id: string;
  orderNumber: number;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  status: OrderStatus;
  city: string;
  novaPoshtaAddress: string;
  hasDeliveryRefs: boolean;
  cityRef: string | null;
  warehouseRef: string | null;
  ttnNumber: string | null;
  hasTtnLabel: boolean;
  createdAt: string;
  itemsCount: number;
  totalAmount: number;
  paidAmount: number;
}

// Результат пакетной операции по одному заказу — показываем списком
// под кнопками, чтобы было видно, что прошло, а что нет и почему
interface BatchResult {
  orderNumber: number;
  ok: boolean;
  message: string;
}

const inputStyle = { border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' };

export default function ShippingScreen() {
  const [orders, setOrders] = useState<ShippingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- отмеченные галочками заказы (id) ----
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ---- параметры ТТН по умолчанию для пакетного создания ----
  // Те же значения по умолчанию, что и в карточке заказа
  // (components/OrderDetailsModal.tsx). Оголошена вартість — сумма
  // каждого заказа, её подставляем автоматически
  const [ttnWeight, setTtnWeight] = useState('1');
  const [ttnSeats, setTtnSeats] = useState('1');
  const [ttnPayerType, setTtnPayerType] = useState<'Recipient' | 'Sender'>('Recipient');
  const [ttnDescription, setTtnDescription] = useState('Запчастини');
  // Післяплата при пакетном создании ТТН: сумма у каждого заказа своя —
  // ровно сколько клиент ещё не доплатил (полностью оплаченным заказам
  // післяплата не ставится)
  const [ttnCod, setTtnCod] = useState(true);

  // ---- выполнение пакетной операции ----
  const [running, setRunning] = useState<string | null>(null); // текст "что сейчас делаем"
  const [results, setResults] = useState<BatchResult[]>([]);

  // ---- открытая карточка заказа ----
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/shipping');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить заказы к отгрузке');
      const list = data.orders as ShippingOrder[];
      setOrders(list);
      // Убираем из выбранных заказы, которых в списке больше нет
      // (например, уже отгруженные)
      setSelected((prev) => new Set(list.filter((o) => prev.has(o.id)).map((o) => o.id)));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заказов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const selectedOrders = orders.filter((o) => selected.has(o.id));
  const allSelected = orders.length > 0 && selected.size === orders.length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)));
  };

  // ------------------------------------------------------------
  // 1. СОЗДАТЬ ТТН ДЛЯ ОТМЕЧЕННЫХ
  // ------------------------------------------------------------
  // Идём по заказам ПО ОЧЕРЕДИ (а не все разом): Новая Почта не любит
  // много одновременных запросов, а ошибка одного заказа не должна
  // останавливать остальные
  const handleCreateTtns = async () => {
    const weight = parseFloat(ttnWeight.replace(',', '.'));
    const seats = parseInt(ttnSeats, 10);
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isInteger(seats) || seats <= 0) {
      setResults([{ orderNumber: 0, ok: false, message: 'Проверьте вес и количество мест — нужны числа больше нуля.' }]);
      return;
    }

    const batch: BatchResult[] = [];
    for (const order of selectedOrders) {
      if (order.ttnNumber) {
        batch.push({ orderNumber: order.orderNumber, ok: true, message: `ТТН уже есть: ${order.ttnNumber}` });
        continue;
      }
      if (!order.hasDeliveryRefs) {
        batch.push({
          orderNumber: order.orderNumber,
          ok: false,
          message: 'Не выбрано отделение Новой Почты — откройте заказ и создайте ТТН вручную',
        });
        continue;
      }

      setRunning(`Создаю ТТН для заказа ${formatOrderNumber(order.orderNumber)}...`);
      try {
        // Город и отделение — те, что покупатель выбрал на сайте
        // при оформлении заказа
        const response = await fetch(`/api/orders/${order.id}/create-ttn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipientCityRef: order.cityRef,
            recipientWarehouseRef: order.warehouseRef,
            weight,
            seatsAmount: seats,
            cost: Math.ceil(order.totalAmount),
            payerType: ttnPayerType,
            description: ttnDescription,
            codAmount: ttnCod ? Math.max(0, Math.ceil(order.totalAmount - order.paidAmount)) : 0,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось создать ТТН');
        const cod = ttnCod ? Math.max(0, Math.ceil(order.totalAmount - order.paidAmount)) : 0;
        batch.push({
          orderNumber: order.orderNumber,
          ok: true,
          message: `ТТН создана: ${data.ttnNumber}` + (cod > 0 ? ` (післяплата ${formatMoney(cod)} грн)` : ''),
        });
      } catch (error) {
        batch.push({
          orderNumber: order.orderNumber,
          ok: false,
          message: error instanceof Error ? error.message : 'Ошибка сети',
        });
      }
    }

    setRunning(null);
    setResults(batch);
    await fetchOrders();
  };

  // ------------------------------------------------------------
  // 2. ПЕЧАТЬ МАРКИРОВОК ОДНИМ ФАЙЛОМ
  // ------------------------------------------------------------
  const labelIds = selectedOrders.filter((o) => o.hasTtnLabel).map((o) => o.id);
  const handlePrintLabels = () => {
    if (labelIds.length === 0) return;
    window.open(`/api/admin/shipping/labels?ids=${labelIds.join(',')}`, '_blank', 'noopener');
  };

  // ------------------------------------------------------------
  // 3. ОТМЕТИТЬ ОТГРУЖЕННЫМИ
  // ------------------------------------------------------------
  const handleShip = async () => {
    // Не полностью оплаченные заказы перечисляем отдельно — отгрузка
    // без оплаты должна быть осознанным решением, а не случайностью
    const unpaid = selectedOrders.filter((o) => o.paidAmount < o.totalAmount);
    const unpaidWarning =
      unpaid.length > 0
        ? '\n\n⚠ Не оплачены полностью:\n' +
          unpaid
            .map(
              (o) =>
                `${formatOrderNumber(o.orderNumber)} — оплачено ${formatMoney(o.paidAmount)} из ${formatMoney(o.totalAmount)} грн`
            )
            .join('\n')
        : '';
    const confirmed = window.confirm(
      `Отметить отгруженными ${selectedOrders.length} заказ(ов)? Товар спишется со склада, а сумма заказа ` +
        'начислится клиенту. Отменить это одной кнопкой нельзя.' +
        unpaidWarning
    );
    if (!confirmed) return;

    const batch: BatchResult[] = [];
    for (const order of selectedOrders) {
      setRunning(`Отгружаю заказ ${formatOrderNumber(order.orderNumber)}...`);
      try {
        const response = await fetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'shipped' }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Не удалось отгрузить заказ');
        batch.push({ orderNumber: order.orderNumber, ok: true, message: 'Отгружен' });
      } catch (error) {
        batch.push({
          orderNumber: order.orderNumber,
          ok: false,
          message: error instanceof Error ? error.message : 'Ошибка сети',
        });
      }
    }

    setRunning(null);
    setResults(batch);
    await fetchOrders();
  };

  const busy = running !== null;
  const noSelection = selectedOrders.length === 0;

  return (
    <AdminLayout active="shipping">
      <header className="mb-6">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / К отгрузке
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">К отгрузке</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Заказы в статусе «На складе» и «Готов к выдаче». Отметьте нужные галочками — и создайте ТТН, распечатайте
          наклейки и отгрузите их сразу пачкой. Нажмите на номер заказа, чтобы открыть его карточку.
        </p>
      </header>

      {/* ==================== ПАРАМЕТРЫ ТТН ==================== */}
      <div
        className="p-4 rounded-lg mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <p className="text-xs font-medium mb-3" style={{ color: 'var(--ink-muted)' }}>
          Параметры для новых ТТН (объявленная стоимость = сумма заказа)
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
              Вес, кг
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-3 py-2 text-sm rounded-md font-mono"
              style={inputStyle}
              value={ttnWeight}
              onChange={(e) => setTtnWeight(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
              Мест
            </label>
            <input
              type="number"
              min={1}
              className="w-full px-3 py-2 text-sm rounded-md font-mono"
              style={inputStyle}
              value={ttnSeats}
              onChange={(e) => setTtnSeats(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
              Кто платит за доставку
            </label>
            <select
              className="w-full px-3 py-2 text-sm rounded-md"
              style={inputStyle}
              value={ttnPayerType}
              onChange={(e) => setTtnPayerType(e.target.value as 'Recipient' | 'Sender')}
            >
              <option value="Recipient">Получатель</option>
              <option value="Sender">Мы (отправитель)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
              Описание груза
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 text-sm rounded-md"
              style={inputStyle}
              value={ttnDescription}
              onChange={(e) => setTtnDescription(e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
          <input type="checkbox" checked={ttnCod} onChange={(e) => setTtnCod(e.target.checked)} />
          З післяплатою — сума у кожного заказу своя: скільки клієнт ще не доплатив (оплаченим — без післяплати)
        </label>
      </div>

      {/* ==================== КНОПКИ ПАКЕТНЫХ ДЕЙСТВИЙ ==================== */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Выбрано: <b style={{ color: 'var(--ink)' }}>{selectedOrders.length}</b>
        </span>
        <button
          type="button"
          disabled={busy || noSelection}
          onClick={handleCreateTtns}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          1. Создать ТТН
        </button>
        <button
          type="button"
          disabled={busy || labelIds.length === 0}
          onClick={handlePrintLabels}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-40"
          style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
        >
          2. Печать наклеек{labelIds.length > 0 ? ` (${labelIds.length})` : ''}
        </button>
        <button
          type="button"
          disabled={busy || noSelection}
          onClick={handleShip}
          className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-40"
          style={{ background: 'var(--good)', color: '#fff' }}
        >
          3. Отметить отгруженными
        </button>
        {running && (
          <span className="text-xs" style={{ color: 'var(--warn)' }}>
            {running}
          </span>
        )}
      </div>

      {/* ==================== РЕЗУЛЬТАТ ПОСЛЕДНЕЙ ОПЕРАЦИИ ==================== */}
      {results.length > 0 && (
        <div
          className="p-3 rounded-lg mb-4 text-xs flex flex-col gap-1"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        >
          {results.map((r, i) => (
            <p key={i} style={{ color: r.ok ? 'var(--good)' : 'var(--bad)' }}>
              {r.orderNumber ? `${formatOrderNumber(r.orderNumber)}: ` : ''}
              {r.message}
            </p>
          ))}
          <button
            type="button"
            onClick={() => setResults([])}
            className="self-start underline mt-1"
            style={{ color: 'var(--ink-faint)' }}
          >
            Скрыть
          </button>
        </div>
      )}

      {/* ==================== ТАБЛИЦА ЗАКАЗОВ ==================== */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loadError && (
          <p className="text-xs p-4" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchOrders} className="underline">
              Повторить
            </button>
          </p>
        )}
        {!loadError && loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}
        {!loadError && !loading && orders.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Сейчас отгружать нечего — все готовые заказы уже уехали.
          </p>
        )}
        {!loadError && !loading && orders.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="px-3 py-2.5 text-left">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Выбрать все" />
                  </th>
                  {['№', 'Клиент', 'Доставка', 'Сумма', 'Статус / Оплата', 'ТТН'].map((heading) => (
                    <th
                      key={heading}
                      className="text-left px-3 py-2.5 text-xs font-medium whitespace-nowrap"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const colors = STATUS_COLORS[order.status];
                  return (
                    <tr
                      key={order.id}
                      onClick={() => toggleOne(order.id)}
                      className="cursor-pointer"
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: selected.has(order.id) ? 'var(--accent-soft)' : 'transparent',
                      }}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(order.id)}
                          onChange={() => toggleOne(order.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Выбрать заказ ${order.orderNumber}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            // stopPropagation — клик по номеру открывает карточку,
                            // а не ставит/снимает галочку строки
                            e.stopPropagation();
                            setOpenOrderId(order.id);
                          }}
                          className="font-mono underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          {formatOrderNumber(order.orderNumber)}
                        </button>
                        <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          {formatDateTime(order.createdAt)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {order.customerName} {order.customerSurname}
                        <p className="text-[11px] font-mono" style={{ color: 'var(--ink-faint)' }}>
                          {order.customerPhone}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                        {order.city ? `${order.city}, ${order.novaPoshtaAddress}` : 'Самовывоз / адрес не указан'}
                        {order.city && !order.hasDeliveryRefs && (
                          <p className="text-[11px]" style={{ color: 'var(--warn)' }}>
                            отделение не выбрано из списка НП
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">{formatMoney(order.totalAmount)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className="text-[11px] px-2 py-1 rounded-full font-medium"
                            style={{ background: colors.bg, color: colors.fg }}
                          >
                            {STATUS_LABELS[order.status]}
                          </span>
                          <PaymentBadge paidAmount={order.paidAmount} totalAmount={order.totalAmount} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
                        {order.ttnNumber || <span style={{ color: 'var(--ink-faint)' }}>нет</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openOrderId && (
        <OrderDetailsModal
          // key — при переходе к соседнему заказу окно создаётся заново
          key={openOrderId}
          orderId={openOrderId}
          onClose={() => setOpenOrderId(null)}
          onOrderChanged={fetchOrders}
          navigation={(() => {
            const index = orders.findIndex((o) => o.id === openOrderId);
            if (index === -1) return undefined;
            return {
              onPrev: index > 0 ? () => setOpenOrderId(orders[index - 1].id) : null,
              onNext: index < orders.length - 1 ? () => setOpenOrderId(orders[index + 1].id) : null,
              positionLabel: `${index + 1} з ${orders.length}`,
            };
          })()}
        />
      )}
    </AdminLayout>
  );
}
