'use client';

// ============================================================
// Модальное окно карточки заказа — открывается из списка заказов
// (components/OrdersScreen.tsx). Вынесено в отдельный компонент при
// редизайне: раньше вся эта разметка жила прямо в OrdersScreen.tsx
// одним узким окном с двойной прокруткой (скролл внутри левой
// колонки И скролл всего окна) и отдельной кнопкой "Сохранить" под
// каждым полем — неудобно для ежедневной работы оператора.
//
// Что изменилось:
//   - Окно широкое (max-w-6xl), с ОДНИМ скроллом на всё тело —
//     левая колонка (клиент/доставка/авто) и правая (состав заказа)
//     скроллятся вместе, а не по отдельности.
//   - Шапка — номер заказа, статус (меняется сразу при выборе, без
//     отдельной кнопки), сумма заказа и главные действия (принять
//     оплату, печать маркировки ТТН).
//   - Поля ТТН/авто/VIN сохраняются САМИ при потере фокуса (onBlur),
//     если значение реально изменилось — видно короткий индикатор
//     "Збережено" рядом с полем. Отдельных кнопок "Сохранить" под
//     каждым полем больше нет.
//   - Состав заказа — компактная таблица вместо карточек в столбик.
//
// Использует те же эндпоинты, что и раньше:
//   GET   /api/orders/[id]
//   PATCH /api/orders/[id]                    — статус/ТТН/авто/VIN
//   PATCH /api/orders/[id]/items/[itemId]      — цена/поставщик позиции
//   POST  /api/admin/orders/[id]/returns       — возврат позиции
//   POST  /api/admin/orders/[id]/payment       — приём оплаты
//   POST  /api/orders/[id]/create-ttn          — создать ТТН через API Новой Пошти
// ============================================================

import { Fragment, useCallback, useEffect, useState } from 'react';
import PrintDocumentsPanel from './PrintDocumentsPanel';
import AdminNovaPoshtaPicker from './AdminNovaPoshtaPicker';
import PaymentBadge from './PaymentBadge';
import {
  ITEM_STATUS_COLORS,
  ITEM_STATUS_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  formatDateTime,
  formatMoney,
  formatOrderNumber,
  type OrderItemStatus,
  type OrderStatus,
} from '@/lib/orderUi';

interface OrderItem {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  costPrice: number;
  quantity: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierContactName: string | null;
  status: OrderItemStatus;
  // Товар в каталоге сейчас: фото и страница на сайте (null — товара нет)
  productId?: string | null;
  imageUrl?: string | null;
  productPath?: string | null;
}

// Предложение того же артикула у одного из поставщиков — то, что
// отдаёт GET /api/admin/products/offers (варианты при редактировании
// позиции: у кого ещё есть деталь, почём и сколько)
interface SupplierOffer {
  productId: string;
  supplierId: string;
  supplierName: string;
  brand: string | null;
  name: string | null;
  costPrice: number;
  retailPrice: number;
  stock: number;
  sameBrand: boolean;
}

// Аналог с ДРУГИМ артикулом (кросс-номер), которым можно заменить деталь
// позиции (GET /api/admin/products/offers — поле analogs)
interface AnalogOffer extends SupplierOffer {
  article: string;
  relation: 'oem' | 'aftermarket';
}

// Кнопки быстрой наценки на цену продажи: +15%, +20%, +30% от закупки
const QUICK_MARKUPS = [15, 20, 30];

interface OrderDetails {
  id: string;
  orderNumber: number;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  cityRef: string | null;
  warehouseRef: string | null;
  comment: string | null;
  ttnNumber: string | null;
  ttnRef: string | null;
  vin: string | null;
  carInfo: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  totalAmount: number;
  paidAmount: number;
  // Внутренняя заметка менеджера — клиент её не видит
  managerNote: string | null;
  // Клиент и его общий баланс по всем заказам (+ должен, − предоплата);
  // null — у старых заказов клиент не привязан
  customer: { id: string; balance: number; orderCount: number } | null;
  // Подключил ли клиент Telegram-бота магазина (сообщение о ТТН уходит
  // ему автоматически)
  telegramLinked: boolean;
  // Откуда пришёл клиент (lib/orderSource.ts)
  source: { label: string; detail: string | null; kind: 'ads' | 'search' | 'social' | 'messenger' | 'other' | 'direct' };
  // Персональное правило цены клиента: скидка/наценка в % от закупки
  pricingRule: { ruleType: 'discount' | 'markup'; percent: number } | null;
  // Напоминание "Передзвонити" (ISO) или null
  callbackAt: string | null;
}

// Дата в формате поля <input type="datetime-local"> — "2026-10-01T10:00"
// по МЕСТНОМУ времени браузера (toISOString дал бы UTC и сдвинул часы)
function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Цвет плашки "Звідки клієнт" по типу источника
const SOURCE_COLORS: Record<OrderDetails['source']['kind'], { bg: string; fg: string }> = {
  ads: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  search: { bg: 'var(--good-soft)', fg: 'var(--good)' },
  social: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  messenger: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  other: { bg: 'var(--surface-2)', fg: 'var(--ink-muted)' },
  direct: { bg: 'var(--surface-2)', fg: 'var(--ink-faint)' },
};

// Кнопки быстрой скидки на цену продажи позиции: −5%, −10%
const QUICK_DISCOUNTS = [5, 10];

// Статус посылки от Новой Почты (GET /api/orders/[id]/ttn-status,
// lib/novaPoshta/tracking.ts)
interface TtnStatusInfo {
  statusText: string;
  statusCode: number | null;
  kind: 'created' | 'in_transit' | 'arrived' | 'received' | 'problem' | 'unknown';
  warehouse: string | null;
  arrivedAt: string | null;
  paidStorageFrom: string | null;
  receivedAt: string | null;
  scheduledDelivery: string | null;
  daysAtWarehouse: number | null;
}

// Через сколько дней в отделении предупреждать, что клиент не забирает
// посылку (после этого у Новой Почты обычно начинается платное хранение)
const STORAGE_WARNING_DAYS = 5;

// Цвет плашки статуса посылки по его смыслу
const TTN_KIND_COLORS: Record<TtnStatusInfo['kind'], { bg: string; fg: string }> = {
  created: { bg: 'var(--surface-2)', fg: 'var(--ink-muted)' },
  in_transit: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  arrived: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
  received: { bg: 'var(--good-soft)', fg: 'var(--good)' },
  problem: { bg: 'var(--bad-soft)', fg: 'var(--bad)' },
  unknown: { bg: 'var(--surface-2)', fg: 'var(--ink-muted)' },
};

// Деталь на НАШЕМ складе под позицию заказа
// (GET /api/orders/[id]/stock-availability, lib/warehouseStock.ts)
interface WarehouseStockOption {
  productId: string;
  supplierName: string;
  brand: string | null;
  available: number;
  costPrice: number;
}

// Одно событие истории изменений заказа (GET /api/orders/[id]/history)
interface OrderHistoryEvent {
  id: string;
  message: string;
  createdBy: string;
  createdAt: string;
}

// Переход к соседнему заказу списка стрелками ← → (пункт "стрелки между
// заказами"): список, из которого открыли окно, передаёт сюда, есть ли
// соседи и что делать при переходе
export interface OrderNavigation {
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  // Например "3 з 20" — где мы в текущем списке
  positionLabel: string;
}

interface SupplierOption {
  id: string;
  name: string;
}

interface CashRegisterOption {
  id: string;
  name: string;
  type: 'cash' | 'bank_account' | 'card';
  balance: number;
}

// Один товар у результатах пошуку для "Додати товар" — те саме, що
// віддає GET /api/products?search=... (components/NewOrderScreen.tsx
// вже використовує цей ендпоінт так само)
interface AddItemProductOption {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  supplierName: string;
}

type SaveKey = 'status' | 'ttn' | 'vehicle' | 'customer' | 'delivery' | 'note' | 'callback';
type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string };
const IDLE: SaveState = { state: 'idle' };

// Телефон в международном формате без "+" (380XXXXXXXXX) — нужен для
// ссылок Viber и Telegram. Украинские номера часто вводят как
// 0XXXXXXXXX или 80XXXXXXXXX — дописываем код страны. Если номер
// совсем не похож на телефон — возвращаем null, и кнопки не показываем
function toInternationalPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('380')) return digits;
  if (digits.length === 11 && digits.startsWith('80')) return `3${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return `38${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

// Миниатюра товара в строке позиции: если картинка не загрузилась
// (ссылка устарела, сайт-источник недоступен), вместо значка "битой
// картинки" показываем аккуратную надпись
function ItemThumb({ src }: { src: string | null | undefined }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="text-[10px] text-center leading-tight" style={{ color: 'var(--ink-faint)' }}>
        немає фото
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" onError={() => setBroken(true)} />
  );
}

// Маленькая кнопка "скопировать" — после нажатия на пару секунд
// показывает "✓", чтобы было видно, что текст уже в буфере обмена
function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Буфер обмена недоступен (очень старый браузер или не https) —
      // не критично, номер всё равно виден и его можно выделить руками
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className="text-xs px-2 py-1 rounded-md shrink-0"
      style={{ border: '1px solid var(--line)', color: copied ? 'var(--good)' : 'var(--ink-muted)' }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}

// Небольшой индикатор рядом с полем — заменяет отдельную кнопку
// "Сохранить": пусто, пока поле не трогали, спиннер-текст во время
// запроса, зелёная галочка на пару секунд после успеха, красный текст
// при ошибке (и тогда остаётся до следующей попытки)
function SaveIndicator({ save }: { save: SaveState }) {
  if (save.state === 'idle') return null;
  if (save.state === 'saving') {
    return (
      <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
        Сохранение...
      </span>
    );
  }
  if (save.state === 'error') {
    return (
      <span className="text-[11px]" style={{ color: 'var(--bad)' }}>
        {save.error || 'Ошибка сохранения'}
      </span>
    );
  }
  return (
    <span className="text-[11px]" style={{ color: 'var(--good)' }}>
      ✓ Сохранено
    </span>
  );
}

export default function OrderDetailsModal({
  orderId,
  onClose,
  onOrderChanged,
  navigation,
  onOpenOrder,
}: {
  orderId: string;
  onClose: () => void;
  onOrderChanged: () => void;
  navigation?: OrderNavigation;
  // Открыть другой заказ в этом же окне (например, только что созданный
  // кнопкой "Повторити замовлення")
  onOpenOrder?: (orderId: string) => void;
}) {
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // ---- автосохраняемые черновики полей ----
  const [statusDraft, setStatusDraft] = useState<OrderStatus>('new');
  const [ttnDraft, setTtnDraft] = useState('');
  const [vinDraft, setVinDraft] = useState('');
  const [carInfoDraft, setCarInfoDraft] = useState('');
  const [managerNoteDraft, setManagerNoteDraft] = useState('');
  // Контакти клієнта — редагуються прямо в картці (особливо потрібно
  // для "Купити в 1 клік", де покупець вводить лише одне поле імені).
  // Саме ці дані йдуть отримувачем у ТТН Нової Пошти
  const [customerNameDraft, setCustomerNameDraft] = useState('');
  const [customerSurnameDraft, setCustomerSurnameDraft] = useState('');
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState('');
  // Зміна міста/відділення прямо в картці — пошук НП з Ref'ами, тож
  // обране відділення одразу підхоплюється формою створення ТТН
  const [editingDelivery, setEditingDelivery] = useState(false);
  const [saveState, setSaveState] = useState<Record<SaveKey, SaveState>>({ status: IDLE, ttn: IDLE, vehicle: IDLE, customer: IDLE, delivery: IDLE, note: IDLE, callback: IDLE });

  // ---- создание ТТН через API Новой Почты ----
  const [showCreateTtn, setShowCreateTtn] = useState(false);
  const [ttnRecipient, setTtnRecipient] = useState<{ cityRef: string; warehouseRef: string; label: string } | null>(
    null
  );
  // Якщо покупець на вітрині вже обрав місто й відділення через
  // реальний пошук Нової Пошти — orderDetails.cityRef/warehouseRef
  // заповнені (секція 33 schema.sql), і шукати їх заново не треба:
  // одразу підставляємо готового отримувача. showManualPicker вмикає
  // ручний пошук (components/AdminNovaPoshtaPicker.tsx) — коли Ref'ів
  // немає (замовлення оформлене вручну текстом) або коли адмін сам
  // натиснув "Змінити", бо клієнт попросив інше відділення
  const [showManualPicker, setShowManualPicker] = useState(false);
  const [ttnWeight, setTtnWeight] = useState('1');
  const [ttnSeats, setTtnSeats] = useState('1');
  const [ttnCost, setTtnCost] = useState('');
  // Післяплата: галочка и сумма. По умолчанию включена, если заказ
  // оплачен не полностью, а сумма = сколько клиент ещё не доплатил
  const [ttnCodEnabled, setTtnCodEnabled] = useState(false);
  const [ttnCodAmount, setTtnCodAmount] = useState('');
  const [ttnPayerType, setTtnPayerType] = useState<'Recipient' | 'Sender'>('Recipient');
  const [ttnDescription, setTtnDescription] = useState('Запчастини');
  const [creatingTtn, setCreatingTtn] = useState(false);
  const [createTtnError, setCreateTtnError] = useState<string | null>(null);

  // ---- справочники ----
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [cashRegisters, setCashRegisters] = useState<CashRegisterOption[]>([]);

  // ---- редактирование позиции (цена продажи/закупки + поставщик + кількість) ----
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemPrice, setEditItemPrice] = useState('');
  const [editItemCostPrice, setEditItemCostPrice] = useState('');
  const [editItemSupplierId, setEditItemSupplierId] = useState('');
  const [editItemQuantity, setEditItemQuantity] = useState('');
  // ---- предложения всех поставщиков по артикулу редактируемой позиции ----
  const [itemOffers, setItemOffers] = useState<SupplierOffer[]>([]);
  const [itemOffersLoading, setItemOffersLoading] = useState(false);
  const [itemOffersError, setItemOffersError] = useState<string | null>(null);
  const [itemAnalogs, setItemAnalogs] = useState<AnalogOffer[]>([]);
  const [replacingProductId, setReplacingProductId] = useState<string | null>(null);
  const [editItemSaving, setEditItemSaving] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);

  // ---- додавання нової позиції в заказ (клієнт докупляє ще щось) ----
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState('');
  const [addItemResults, setAddItemResults] = useState<AddItemProductOption[]>([]);
  const [addItemSearching, setAddItemSearching] = useState(false);
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const [addItemError, setAddItemError] = useState<string | null>(null);

  // ---- возврат позиции ----
  const [returningItemId, setReturningItemId] = useState<string | null>(null);
  const [returnQuantity, setReturnQuantity] = useState('1');
  const [returnReason, setReturnReason] = useState<'defect' | 'customer_mistake' | 'staff_mistake' | 'refused'>(
    'customer_mistake'
  );
  const [returnRefundMethod, setReturnRefundMethod] = useState<'balance' | 'cash' | 'card'>('cash');
  const [returnComment, setReturnComment] = useState('');
  const [returnCashRegisterId, setReturnCashRegisterId] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnSuccessItemId, setReturnSuccessItemId] = useState<string | null>(null);

  // ---- телефон відділення Нової Пошти (контакт для дзвінка) ----
  const [warehousePhone, setWarehousePhone] = useState<string | null>(null);

  // ---- закупка и прибыль в шапке: скрыты, пока не нажмёшь ----
  // (чтобы клиент, стоящий рядом с менеджером, не видел нашу наценку)
  const [showProfit, setShowProfit] = useState(false);

  // ---- модалка "Принять оплату" ----
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // ---- история изменений заказа ----
  // historyVersion увеличиваем после каждого действия, которое меняет
  // заказ, — эффект ниже тогда перечитывает историю с сервера
  const [history, setHistory] = useState<OrderHistoryEvent[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/history`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success) setHistory(data.events as OrderHistoryEvent[]);
      })
      .catch(() => {
        // История — справочная информация; если не загрузилась, окно
        // заказа работает как обычно
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, historyVersion]);

  // ---- статус посылки от Новой Почты ----
  // Грузим, когда у заказа есть номер ТТН (и заново — по кнопке
  // "Оновити" или после создания ТТН)
  const [ttnStatus, setTtnStatus] = useState<TtnStatusInfo | null>(null);
  const [ttnStatusLoading, setTtnStatusLoading] = useState(false);
  const [ttnStatusError, setTtnStatusError] = useState<string | null>(null);
  const [ttnStatusVersion, setTtnStatusVersion] = useState(0);
  const currentTtnNumber = orderDetails?.ttnNumber || null;

  useEffect(() => {
    if (!currentTtnNumber) {
      setTtnStatus(null);
      setTtnStatusError(null);
      return;
    }
    let cancelled = false;
    setTtnStatusLoading(true);
    setTtnStatusError(null);
    fetch(`/api/orders/${orderId}/ttn-status`)
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data.error || 'Не вдалося отримати статус');
        setTtnStatus(data.status as TtnStatusInfo);
      })
      .catch((error) => {
        if (!cancelled) setTtnStatusError(error instanceof Error ? error.message : 'Помилка мережі');
      })
      .finally(() => {
        if (!cancelled) setTtnStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, currentTtnNumber, ttnStatusVersion]);

  // ---- что из позиций заказа уже лежит на нашем складе ----
  // Перечитываем вместе с историей (после любого изменения заказа)
  const [stockAvailability, setStockAvailability] = useState<Record<string, WarehouseStockOption[]>>({});
  const [takingItemId, setTakingItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/stock-availability`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success) setStockAvailability(data.availability as Record<string, WarehouseStockOption[]>);
      })
      .catch(() => {
        // Не критично: просто не покажем подсказку про склад
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, historyVersion]);

  // Перечитать заказ целиком с сервера — после действий, которые меняют
  // сразу несколько полей (скидка меняет цены всех позиций, "Взяти зі
  // складу" — ещё и статус заказа)
  const reloadOrder = async () => {
    const orderResponse = await fetch(`/api/orders/${orderId}`);
    const orderData = await orderResponse.json();
    if (orderResponse.ok && orderData.order) {
      setOrderDetails(orderData.order as OrderDetails);
      setStatusDraft((orderData.order as OrderDetails).status);
    }
  };

  // ---- скидка на весь заказ ----
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState('');
  const [discountSaving, setDiscountSaving] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  const handleApplyDiscount = async () => {
    const value = parseFloat(discountValue.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      setDiscountError('Вкажіть розмір знижки — число більше нуля');
      return;
    }
    setDiscountSaving(true);
    setDiscountError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/discount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: discountType, value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося застосувати знижку');
      await reloadOrder();
      setShowDiscount(false);
      setDiscountValue('');
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setDiscountError(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setDiscountSaving(false);
    }
  };

  // ---- разделить заказ: выбранные позиции -> в новый связанный заказ ----
  const [showSplit, setShowSplit] = useState(false);
  const [splitSelected, setSplitSelected] = useState<Set<string>>(new Set());
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);

  // По умолчанию отмечаем всё, что ещё НЕ на складе: готовое остаётся
  // в этом заказе и может ехать клиенту сейчас
  const openSplit = () => {
    if (!orderDetails) return;
    const notReady = orderDetails.items
      .filter((i) => i.status === 'pending' || i.status === 'ordered_from_supplier')
      .map((i) => i.id);
    setSplitSelected(new Set(notReady));
    setSplitError(null);
    setShowSplit(true);
  };

  const handleSplit = async () => {
    if (!orderDetails) return;
    setSplitting(true);
    setSplitError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderDetails.id}/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: Array.from(splitSelected) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося розділити замовлення');
      setShowSplit(false);
      await reloadOrder();
      onOrderChanged();
      bumpHistory();
      if (onOpenOrder && window.confirm(`Створено замовлення №${data.orderNumber}. Відкрити його?`)) {
        onOpenOrder(data.orderId as string);
      }
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setSplitting(false);
    }
  };

  // ---- повторить заказ: новый заказ с теми же товарами по текущим ценам ----
  const [repeating, setRepeating] = useState(false);
  const handleRepeatOrder = async () => {
    if (!orderDetails) return;
    const confirmed = window.confirm(
      `Створити нове замовлення для ${orderDetails.customerName} з тими самими товарами?\n\n` +
        'Ціни будуть актуальні з каталогу (з урахуванням персонального правила клієнта), доставка — та сама.'
    );
    if (!confirmed) return;
    setRepeating(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderDetails.id}/repeat`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося повторити замовлення');
      onOrderChanged();
      const skippedNote =
        (data.skipped as string[]).length > 0
          ? `\n\nНе перенесено (товару вже немає в каталозі): ${(data.skipped as string[]).join(', ')}`
          : '';
      if (onOpenOrder) {
        if (skippedNote) window.alert(`Створено замовлення №${data.orderNumber}.${skippedNote}`);
        onOpenOrder(data.orderId as string);
      } else {
        window.alert(`Створено замовлення №${data.orderNumber}.${skippedNote}`);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setRepeating(false);
    }
  };

  // "Взяти зі складу": позиция закрепляется за деталью с нашей полки и
  // сразу становится "На складе". Статус всего заказа мог при этом
  // сдвинуться дальше — поэтому перечитываем заказ целиком
  const handleTakeFromStock = async (item: OrderItem, option: WarehouseStockOption) => {
    if (!orderDetails) return;
    setTakingItemId(item.id);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items/${item.id}/take-from-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: option.productId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося взяти зі складу');

      await reloadOrder();
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setTakingItemId(null);
    }
  };

  // ---- удаление позиции из заказа ----
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [paymentCashRegisterId, setPaymentCashRegisterId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentComment, setPaymentComment] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // СПРАВОЧНИКИ — поставщики и кассы, загружаются один раз при
  // открытии модалки
  // ------------------------------------------------------------
  useEffect(() => {
    fetch('/api/suppliers')
      .then((response) => response.json())
      .then((data) => {
        if (data.suppliers) {
          setSuppliers(
            (data.suppliers as Array<{ id: string; name: string }>).map((s) => ({ id: s.id, name: s.name }))
          );
        }
      })
      .catch(() => {
        // Список нужен только для смены поставщика внутри позиции —
        // если он не загрузился, сам заказ всё равно можно посмотреть
      });

    fetch('/api/admin/cash-registers?activeOnly=1')
      .then((response) => response.json())
      .then((data) => {
        if (data.registers) setCashRegisters(data.registers as CashRegisterOption[]);
      })
      .catch(() => {
        // Список нужен только для форм оплаты/возврата
      });
  }, []);

  // ------------------------------------------------------------
  // ЗАГРУЗКА ЗАКАЗА
  // ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadingDetails(true);
    setDetailsError(null);

    fetch(`/api/orders/${orderId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Не удалось загрузить заказ');
        }
        if (!cancelled) {
          const order = data.order as OrderDetails;
          setOrderDetails(order);
          setStatusDraft(order.status);
          setTtnDraft(order.ttnNumber || '');
          setVinDraft(order.vin || '');
          setCarInfoDraft(order.carInfo || '');
          setManagerNoteDraft(order.managerNote || '');
          setCustomerNameDraft(order.customerName || '');
          setCustomerSurnameDraft(order.customerSurname || '');
          setCustomerPhoneDraft(order.customerPhone || '');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailsError(error instanceof Error ? error.message : 'Ошибка сети при загрузке заказа');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // ------------------------------------------------------------
  // ТЕЛЕФОН ВІДДІЛЕННЯ НОВОЇ ПОШТИ — підтягується окремим, необов'язковим
  // запитом, коли у заказа вже відомі місто й відділення отримувача.
  // Замовлення зберігає лише текст ("Дніпро", "Відділення №5, вул. ...")
  // без Ref — тому щоб дізнатись телефон, шукаємо відділення повторно
  // через GET /api/nova-poshta/warehouse-info. Якщо Нова Пошта
  // недоступна або відділення не знайдено — просто не показуємо
  // телефон, це не критична для перегляду заказа інформація
  // ------------------------------------------------------------
  useEffect(() => {
    setWarehousePhone(null);
    if (!orderDetails?.city || !orderDetails?.novaPoshtaAddress) return;

    let cancelled = false;
    const params = new URLSearchParams({
      city: orderDetails.city,
      address: orderDetails.novaPoshtaAddress,
    });

    fetch(`/api/nova-poshta/warehouse-info?${params}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.success && data.phone) {
          setWarehousePhone(data.phone as string);
        }
      })
      .catch(() => {
        // мовчки лишаємо порожнім — це лише додаткова довідкова інформація
      });

    return () => {
      cancelled = true;
    };
  }, [orderDetails?.city, orderDetails?.novaPoshtaAddress]);

  // ------------------------------------------------------------
  // ОБЩИЙ ПОМОЩНИК АВТОСОХРАНЕНИЯ — один и тот же PATCH
  // /api/orders/[id] используется и для статуса, и для ТТН, и для
  // авто/VIN; отличается только то, какие поля передаются и под каким
  // ключом показывать индикатор сохранения рядом с полем
  // ------------------------------------------------------------
  const savePatch = useCallback(
    async (key: SaveKey, payload: Record<string, unknown>) => {
      setSaveState((prev) => ({ ...prev, [key]: { state: 'saving' } }));
      try {
        const response = await fetch(`/api/orders/${orderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Не удалось сохранить изменения');
        }

        setOrderDetails((prev) => (prev ? { ...prev, ...(data.order as Partial<OrderDetails>) } : prev));
        setSaveState((prev) => ({ ...prev, [key]: { state: 'saved' } }));
        onOrderChanged();
      bumpHistory();
        bumpHistory();
        setTimeout(() => {
          setSaveState((prev) => (prev[key]?.state === 'saved' ? { ...prev, [key]: IDLE } : prev));
        }, 2000);
      } catch (error) {
        setSaveState((prev) => ({
          ...prev,
          [key]: { state: 'error', error: error instanceof Error ? error.message : 'Ошибка сети' },
        }));
      }
    },
    [orderId, onOrderChanged, bumpHistory]
  );

  // ---- горячая клавиша Esc: закрывает то, что открыто "сверху" ----
  // Сначала — форма редактирования или возврата позиции, потом окно
  // оплаты, и только если ничего не открыто — само окно заказа.
  // Enter для сохранения позиции — в самой форме (onKeyDown ниже)
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (editingItemId) {
        setEditingItemId(null);
        setEditItemError(null);
      } else if (returningItemId) {
        setReturningItemId(null);
      } else if (showPaymentModal) {
        setShowPaymentModal(false);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editingItemId, returningItemId, showPaymentModal, onClose]);

  // ---- статус — сохраняется сразу при выборе, без отдельной кнопки ----
  // ---- стрелки ← → на клавиатуре листают заказы (если окно открыто
  // из списка). В полях ввода стрелки двигают курсор — там не
  // перехватываем, иначе нельзя было бы исправить цифру в цене ----
  useEffect(() => {
    if (!navigation) return;
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (event.key === 'ArrowLeft' && navigation.onPrev) navigation.onPrev();
      if (event.key === 'ArrowRight' && navigation.onNext) navigation.onNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigation]);

  // ---- статус — сохраняется сразу при выборе, без отдельной кнопки ----
  // Отгрузка не полностью оплаченного заказа — частая ошибка: сначала
  // спрашиваем подтверждение. Если менеджер отказался — возвращаем
  // прежний статус в выпадающем списке
  const handleStatusChange = (next: OrderStatus) => {
    if (next === 'shipped' && orderDetails && orderDetails.paidAmount < orderDetails.totalAmount) {
      const confirmed = window.confirm(
        `Заказ оплачен на ${formatMoney(orderDetails.paidAmount)} грн из ${formatMoney(orderDetails.totalAmount)} грн ` +
          `(не хватает ${formatMoney(orderDetails.totalAmount - orderDetails.paidAmount)} грн).\n\n` +
          'Всё равно отметить заказ отгруженным?'
      );
      if (!confirmed) return;
    }
    setStatusDraft(next);
    savePatch('status', { status: next });
  };

  // ---- отправка сообщения о ТТН клиенту (кнопка в блоке ТТН) ----
  const [ttnNotify, setTtnNotify] = useState<{ state: 'idle' | 'sending' | 'done' | 'error'; text?: string }>({
    state: 'idle',
  });
  const handleNotifyTtn = async () => {
    if (!orderDetails) return;
    setTtnNotify({ state: 'sending' });
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/notify-ttn`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося надіслати');
      const texts: Record<string, string> = {
        sent: '✓ Надіслано клієнту в Telegram',
        not_linked: 'Клієнт не підключав Telegram-бота — надішліть текст у Viber або скопіюйте',
        failed: 'Telegram не прийняв повідомлення (можливо, клієнт заблокував бота)',
      };
      setTtnNotify({ state: data.result === 'sent' ? 'done' : 'error', text: texts[data.result] || data.result });
      bumpHistory();
    } catch (error) {
      setTtnNotify({ state: 'error', text: error instanceof Error ? error.message : 'Помилка мережі' });
    }
  };

  // ---- ТТН вручную — сохраняется при потере фокуса, если изменилось ----
  const handleTtnBlur = () => {
    if (!orderDetails) return;
    const next = ttnDraft.trim();
    if (next === (orderDetails.ttnNumber || '')) return;
    savePatch('ttn', { ttnNumber: next || null });
  };

  // ---- напоминание "Передзвонити": сохраняется сразу при выборе ----
  // null — снять напоминание (кнопка "Виконано")
  const saveCallback = (date: Date | null) => {
    savePatch('callback', { callbackAt: date ? date.toISOString() : null });
  };

  // ---- заметка менеджера — сохраняется при потере фокуса, если изменилась ----
  const handleManagerNoteBlur = () => {
    if (!orderDetails) return;
    const next = managerNoteDraft.trim();
    if (next === (orderDetails.managerNote || '')) return;
    savePatch('note', { managerNote: next || null });
  };

  // ---- авто/VIN — сохраняются вместе при потере фокуса любого из двух ----
  const handleVehicleBlur = () => {
    if (!orderDetails) return;
    const nextCar = carInfoDraft.trim();
    const nextVin = vinDraft.trim();
    if (nextCar === (orderDetails.carInfo || '') && nextVin === (orderDetails.vin || '')) return;
    savePatch('vehicle', { carInfo: nextCar || null, vin: nextVin || null });
  };

  // ---- контакты клиента — сохраняются вместе при потере фокуса любого поля ----
  const handleCustomerBlur = () => {
    if (!orderDetails) return;
    const nextName = customerNameDraft.trim();
    const nextSurname = customerSurnameDraft.trim();
    const nextPhone = customerPhoneDraft.trim();
    if (
      nextName === (orderDetails.customerName || '') &&
      nextSurname === (orderDetails.customerSurname || '') &&
      nextPhone === (orderDetails.customerPhone || '')
    ) {
      return;
    }
    if (!nextName || !nextSurname || !nextPhone) {
      setSaveState((prev) => ({
        ...prev,
        customer: { state: 'error', error: "Ім'я, прізвище і телефон не можуть бути порожніми" },
      }));
      return;
    }
    savePatch('customer', { customerName: nextName, customerSurname: nextSurname, customerPhone: nextPhone });
  };

  // ---- місто/відділення — зберігаються одразу після вибору відділення ----
  const handleDeliveryPick = async (value: {
    cityRef: string;
    cityName: string;
    warehouseRef: string;
    warehouseDescription: string;
  }) => {
    await savePatch('delivery', {
      delivery: {
        city: value.cityName,
        novaPoshtaAddress: value.warehouseDescription,
        cityRef: value.cityRef,
        warehouseRef: value.warehouseRef,
      },
    });
    setEditingDelivery(false);
  };

  // ------------------------------------------------------------
  // СОЗДАНИЕ ТТН ЧЕРЕЗ API НОВОЙ ПОЧТЫ
  // ------------------------------------------------------------
  const openCreateTtn = () => {
    setCreateTtnError(null);
    setTtnCost(orderDetails ? String(Math.ceil(orderDetails.totalAmount)) : '');
    const unpaid = orderDetails ? Math.max(0, Math.ceil(orderDetails.totalAmount - orderDetails.paidAmount)) : 0;
    setTtnCodEnabled(unpaid > 0);
    setTtnCodAmount(unpaid > 0 ? String(unpaid) : '');

    const knownRecipient =
      orderDetails?.cityRef && orderDetails?.warehouseRef
        ? { cityRef: orderDetails.cityRef, warehouseRef: orderDetails.warehouseRef, label: `${orderDetails.city}, ${orderDetails.novaPoshtaAddress}` }
        : null;
    setTtnRecipient(knownRecipient);
    // Ручний пошук потрібен лише тоді, коли готового відповідника
    // немає — інакше адмін одразу бачить те відділення, яке покупець
    // вже обрав на сайті, і йому не треба нічого шукати заново
    setShowManualPicker(!knownRecipient);

    setShowCreateTtn(true);
  };

  const handleCreateTtn = async () => {
    if (!orderDetails) return;
    if (!ttnRecipient) {
      setCreateTtnError('Оберіть місто та відділення отримувача.');
      return;
    }
    if (ttnCodEnabled && !(parseFloat(ttnCodAmount.replace(',', '.')) > 0)) {
      setCreateTtnError('Вкажіть суму післяплати або зніміть галочку.');
      return;
    }

    setCreatingTtn(true);
    setCreateTtnError(null);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/create-ttn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientCityRef: ttnRecipient.cityRef,
          recipientWarehouseRef: ttnRecipient.warehouseRef,
          weight: parseFloat(ttnWeight),
          seatsAmount: parseInt(ttnSeats, 10),
          cost: parseFloat(ttnCost),
          payerType: ttnPayerType,
          description: ttnDescription,
          codAmount: ttnCodEnabled ? parseFloat(ttnCodAmount.replace(',', '.')) || 0 : 0,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось создать ТТН');
      }

      setTtnDraft(data.ttnNumber as string);
      setOrderDetails({ ...orderDetails, ttnNumber: data.ttnNumber as string, ttnRef: data.ttnRef as string });
      setShowCreateTtn(false);
      setTtnRecipient(null);
      bumpHistory();
    } catch (error) {
      setCreateTtnError(error instanceof Error ? error.message : 'Ошибка сети при создании ТТН');
    } finally {
      setCreatingTtn(false);
    }
  };

  // ------------------------------------------------------------
  // РЕДАКТИРОВАНИЕ ПОЗИЦИИ ЗАКАЗА (цена + поставщик + кількість)
  // ------------------------------------------------------------
  const openItemEdit = (item: OrderItem) => {
    setReturningItemId(null);
    setEditingItemId(item.id);
    setEditItemPrice(String(item.price));
    setEditItemCostPrice(String(item.costPrice));
    setEditItemSupplierId(item.supplierId || '');
    setEditItemQuantity(String(item.quantity));
    setEditItemError(null);
    loadItemOffers(item);
  };

  // Предложения того же артикула у всех поставщиков — грузим при
  // открытии редактирования позиции
  const loadItemOffers = async (item: OrderItem) => {
    setItemOffers([]);
    setItemAnalogs([]);
    setItemOffersError(null);
    setItemOffersLoading(true);
    try {
      const params = new URLSearchParams({ article: item.article });
      if (item.brand) params.set('brand', item.brand);
      const response = await fetch(`/api/admin/products/offers?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить предложения');
      setItemOffers(data.offers as SupplierOffer[]);
      setItemAnalogs((data.analogs as AnalogOffer[]) || []);
    } catch (error) {
      setItemOffersError(error instanceof Error ? error.message : 'Ошибка сети');
    } finally {
      setItemOffersLoading(false);
    }
  };

  // Выбор предложения — подставляем поставщика и его цену закупки.
  // Цену продажи НЕ трогаем: её менеджер решает сам (или кнопками
  // быстрой цены под полем)
  const pickOffer = (offer: SupplierOffer) => {
    setEditItemSupplierId(offer.supplierId);
    setEditItemCostPrice(String(offer.costPrice));
  };

  // Заменить деталь позиции на аналог (другой артикул). Цену продажи
  // оставляем ту, что сейчас в поле формы (о ней уже могли договориться
  // с клиентом), — поменять её можно сразу после замены
  const handleReplaceWithAnalog = async (item: OrderItem, analog: AnalogOffer) => {
    if (!orderDetails) return;
    const price = parseFloat(editItemPrice.replace(',', '.'));
    const confirmed = window.confirm(
      `Замінити ${item.brand || ''} ${item.article} на ${analog.brand || ''} ${analog.article} ` +
        `(${analog.supplierName}, закупка ${formatMoney(analog.costPrice)} грн)?\n\n` +
        `Ціна продажу залишиться ${Number.isFinite(price) ? formatMoney(price) : formatMoney(item.price)} грн — за потреби змініть її після заміни.`
    );
    if (!confirmed) return;
    setReplacingProductId(analog.productId);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: analog.productId, ...(Number.isFinite(price) ? { price } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося замінити позицію');
      setEditingItemId(null);
      // Перечитываем заказ: у позиции новый товар — новое фото и ссылка
      await reloadOrder();
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setEditItemError(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setReplacingProductId(null);
    }
  };

  const cancelItemEdit = () => {
    setEditingItemId(null);
    setEditItemError(null);
  };

  const handleSaveItem = async () => {
    if (!orderDetails || !editingItemId) return;

    const price = parseFloat(editItemPrice.replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) {
      setEditItemError('Цена должна быть числом не меньше нуля');
      return;
    }
    const costPrice = parseFloat(editItemCostPrice.replace(',', '.'));
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      setEditItemError('Закупочная цена должна быть числом не меньше нуля');
      return;
    }
    if (!editItemSupplierId) {
      setEditItemError('Выберите поставщика');
      return;
    }
    const quantity = parseInt(editItemQuantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setEditItemError('Количество должно быть целым числом больше нуля');
      return;
    }

    setEditItemSaving(true);
    setEditItemError(null);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items/${editingItemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price, costPrice, supplierId: editItemSupplierId, quantity }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить позицию заказа');
      }

      const updatedItem = data.item as OrderItem;
      // Слияние, а не замена: ответ PATCH не содержит фото и ссылку товара
      const nextItems = orderDetails.items.map((item) => (item.id === updatedItem.id ? { ...item, ...updatedItem } : item));
      const nextTotal = nextItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      setOrderDetails({ ...orderDetails, items: nextItems, totalAmount: nextTotal });
      setEditingItemId(null);
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setEditItemError(error instanceof Error ? error.message : 'Ошибка сети при сохранении позиции');
    } finally {
      setEditItemSaving(false);
    }
  };

  // ------------------------------------------------------------
  // ДОДАВАННЯ НОВОЇ ПОЗИЦІЇ В ЗАКАЗ (клієнт хоче докупити щось ще)
  // ------------------------------------------------------------
  useEffect(() => {
    const term = addItemSearch.trim();
    if (!term) {
      setAddItemResults([]);
      return;
    }
    setAddItemSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(term)}&pageSize=8`);
        const data = await response.json();
        setAddItemResults(response.ok ? (data.products as AddItemProductOption[]) : []);
      } catch {
        setAddItemResults([]);
      } finally {
        setAddItemSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [addItemSearch]);

  const closeAddItem = () => {
    setShowAddItem(false);
    setAddItemSearch('');
    setAddItemResults([]);
    setAddItemError(null);
  };

  // Кількість одразу 1 — той самий підхід, що і в "Популярні товари"
  // на вітрині: швидке додавання, а поправити кількість/ціну можна
  // одразу після через "✎" (той самий пенсіл, що і для інших позицій)
  const handleAddItem = async (product: AddItemProductOption) => {
    if (!orderDetails) return;
    setAddingItemId(product.id);
    setAddItemError(null);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, quantity: 1 }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось добавить товар в заказ');
      }

      const newItem = data.item as OrderItem;
      const nextItems = [...orderDetails.items, newItem];
      const nextTotal = nextItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      setOrderDetails({ ...orderDetails, items: nextItems, totalAmount: nextTotal });
      setAddItemSearch('');
      setAddItemResults([]);
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setAddItemError(error instanceof Error ? error.message : 'Ошибка сети при добавлении товара');
    } finally {
      setAddingItemId(null);
    }
  };

  // ------------------------------------------------------------
  // ВОЗВРАТ ОДНОЙ ПОЗИЦИИ ЗАКАЗА
  // ------------------------------------------------------------
  const openItemReturn = (item: OrderItem) => {
    setEditingItemId(null);
    setReturningItemId(item.id);
    setReturnQuantity('1');
    setReturnReason('customer_mistake');
    setReturnRefundMethod('cash');
    setReturnCashRegisterId('');
    setReturnComment('');
    setReturnError(null);
    setReturnSuccessItemId(null);
  };

  // Удалить позицию: подтверждение с понятным предупреждением — что
  // будет с уже заказанной у поставщика или уже лежащей на складе деталью
  const handleDeleteItem = async (item: OrderItem) => {
    if (!orderDetails) return;
    const warnings: Record<string, string> = {
      ordered_from_supplier:
        '\n\n⚠ Цю позицію вже замовлено у постачальника — не забудьте скасувати замовлення у нього вручну.',
      in_stock: '\n\nДеталь вже на складі — вона там і залишиться (з\'явиться в розділі «Склад»).',
    };
    const confirmed = window.confirm(
      `Видалити з замовлення позицію ${item.article}${item.name ? ` «${item.name}»` : ''} ` +
        `(${item.quantity} шт × ${formatMoney(item.price)} грн)?` +
        (warnings[item.status] || '')
    );
    if (!confirmed) return;

    setDeletingItemId(item.id);
    try {
      const response = await fetch(`/api/orders/${orderDetails.id}/items/${item.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не вдалося видалити позицію');

      if (editingItemId === item.id) setEditingItemId(null);
      if (returningItemId === item.id) setReturningItemId(null);
      setOrderDetails((prev) => {
        if (!prev) return prev;
        const nextItems = prev.items.filter((i) => i.id !== item.id);
        const nextTotal = nextItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
        return { ...prev, items: nextItems, totalAmount: nextTotal };
      });
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Помилка мережі');
    } finally {
      setDeletingItemId(null);
    }
  };

  const cancelItemReturn = () => {
    setReturningItemId(null);
    setReturnError(null);
  };

  const handleSubmitReturn = async () => {
    if (!orderDetails || !returningItemId) return;

    const quantity = parseInt(returnQuantity, 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setReturnError('Количество должно быть целым числом больше нуля');
      return;
    }
    if (returnRefundMethod !== 'balance' && !returnCashRegisterId) {
      setReturnError('Укажите кассу, из которой выдаются деньги клиенту');
      return;
    }

    setReturnSaving(true);
    setReturnError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderDetails.id}/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId: returningItemId,
          quantity,
          reason: returnReason,
          refundMethod: returnRefundMethod,
          cashRegisterId: returnRefundMethod !== 'balance' ? returnCashRegisterId : undefined,
          comment: returnComment || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось оформить возврат');
      }

      // Возврат наличными/картой реально уменьшает оплаченную сумму
      // (cash_movements 'customer_refund', см. app/api/orders/[id]/route.ts) —
      // бейдж оплаты должен это сразу учитывать. Возврат "на баланс
      // клиента", наоборот, кассы не касается, paidAmount не трогаем
      if (returnRefundMethod !== 'balance') {
        const returnedItem = orderDetails.items.find((item) => item.id === returningItemId);
        if (returnedItem) {
          const refundAmount = returnedItem.price * quantity;
          setOrderDetails((prev) => (prev ? { ...prev, paidAmount: prev.paidAmount - refundAmount } : prev));
        }
      }

      setReturnSuccessItemId(returningItemId);
      setReturningItemId(null);
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : 'Ошибка сети при оформлении возврата');
    } finally {
      setReturnSaving(false);
    }
  };

  // ------------------------------------------------------------
  // ПРИЁМ ОПЛАТЫ
  // ------------------------------------------------------------
  const openPaymentModal = () => {
    setPaymentCashRegisterId('');
    setPaymentAmount(orderDetails ? String(orderDetails.totalAmount) : '');
    setPaymentComment('');
    setPaymentError(null);
    setShowPaymentModal(true);
  };

  const handleSubmitPayment = async () => {
    if (!orderDetails) return;

    const amount = parseFloat(paymentAmount);
    if (!paymentCashRegisterId) {
      setPaymentError('Выберите кассу, через которую прошла оплата');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Сумма должна быть положительным числом');
      return;
    }

    setPaymentSaving(true);
    setPaymentError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderDetails.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashRegisterId: paymentCashRegisterId, amount, comment: paymentComment || undefined }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось провести платёж');
      }

      setCashRegisters((prev) =>
        prev.map((r) => (r.id === paymentCashRegisterId ? { ...r, balance: data.newCashRegisterBalance } : r))
      );
      // Бейдж оплаты (PaymentBadge) должен сразу отразить только что
      // принятые деньги, не дожидаясь повторного открытия карточки
      setOrderDetails((prev) => (prev ? { ...prev, paidAmount: prev.paidAmount + amount } : prev));
      setShowPaymentModal(false);
      onOrderChanged();
      bumpHistory();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Ошибка сети при проведении платежа');
    } finally {
      setPaymentSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[90vh] rounded-lg flex flex-col overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ==================== ШАПКА ==================== */}
        {/* relative + pr-14 — место под крестик, закреплённый в правом
            верхнем углу (кнопки шапки могут переноситься на новую строку,
            а крестик всегда остаётся в углу) */}
        <div
          className="relative flex items-start justify-between gap-4 pl-6 pr-14 py-4 shrink-0 flex-wrap"
          style={{ borderBottom: '1px solid var(--line)' }}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-semibold whitespace-nowrap">
                Заказ {orderDetails ? formatOrderNumber(orderDetails.orderNumber) : ''}
              </h2>
              {orderDetails && (
                <>
                  <select
                    value={statusDraft}
                    onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium border-0 cursor-pointer"
                    style={{ background: STATUS_COLORS[statusDraft].bg, color: STATUS_COLORS[statusDraft].fg }}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status} style={{ background: 'var(--surface-2)', color: 'var(--ink)' }}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <SaveIndicator save={saveState.status} />
                </>
              )}
            </div>
            {orderDetails && (
              <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                {orderDetails.customerName} {orderDetails.customerSurname} · Создан{' '}
                {formatDateTime(orderDetails.createdAt)}
              </p>
            )}
            {/* Звідки прийшов клієнт — щоб бачити, які замовлення приносить
                реклама Google Ads, а які — звичайний пошук чи прямий захід */}
            {orderDetails && (
              <p className="mt-1.5">
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: SOURCE_COLORS[orderDetails.source.kind].bg, color: SOURCE_COLORS[orderDetails.source.kind].fg }}
                  title="Звідки клієнт прийшов на сайт (за мітками при оформленні замовлення)"
                >
                  Звідки: {orderDetails.source.label}
                </span>
                {orderDetails.source.detail && (
                  <span className="text-[11px] ml-1.5" style={{ color: 'var(--ink-faint)' }}>
                    {orderDetails.source.detail}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {orderDetails && (
              <div className="text-right">
                <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Сумма заказа
                </p>
                <p className="text-lg font-semibold font-mono">{formatMoney(orderDetails.totalAmount)} грн</p>
              </div>
            )}
            {/* Закупка и прибыль по заказу — только по живым позициям
                (отменённые и возвращённые не считаем: их уже не продаём) */}
            {orderDetails &&
              (() => {
                const activeItems = orderDetails.items.filter(
                  (item) => item.status !== 'cancelled' && item.status !== 'returned'
                );
                const revenue = activeItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
                const cost = activeItems.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
                const profit = revenue - cost;
                const markupPercent = cost > 0 ? (profit / cost) * 100 : null;
                // Позиции без цены закупки завышают прибыль (закупка = 0) —
                // в таком случае честно предупреждаем и красим прибыль в серый
                const withoutCost = activeItems.filter((item) => !(item.costPrice > 0)).length;
                // Скрыто: вместо цифр — кнопка "Прибуток", по нажатию показываем
                if (!showProfit) {
                  return (
                    <button
                      type="button"
                      onClick={() => setShowProfit(true)}
                      className="text-right pl-3 cursor-pointer"
                      style={{ borderLeft: '1px solid var(--line)' }}
                      title="Показати закупку і прибуток"
                    >
                      <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        Прибуток
                      </p>
                      <p className="text-lg font-semibold font-mono" style={{ color: 'var(--ink-faint)' }}>
                        👁 •••
                      </p>
                    </button>
                  );
                }
                return (
                  <button
                    type="button"
                    onClick={() => setShowProfit(false)}
                    className="text-right pl-3 cursor-pointer"
                    style={{ borderLeft: '1px solid var(--line)' }}
                    title="Сховати закупку і прибуток"
                  >
                    <p className="text-[11px]" style={{ color: withoutCost > 0 ? 'var(--warn)' : 'var(--ink-faint)' }}>
                      {withoutCost > 0
                        ? `Без закупки: ${withoutCost} поз. — прибуток неточний`
                        : `Закупка ${formatMoney(cost)} грн`}
                    </p>
                    <p
                      className="text-lg font-semibold font-mono"
                      style={{ color: withoutCost > 0 ? 'var(--ink-faint)' : profit < 0 ? 'var(--bad)' : 'var(--good)' }}
                      title="Прибуток = продаж − закупка"
                    >
                      {profit < 0 ? '−' : '+'}
                      {formatMoney(Math.abs(profit))} грн
                      {markupPercent !== null && (
                        <span className="text-xs font-normal ml-1" style={{ color: 'var(--ink-muted)' }}>
                          ({markupPercent.toFixed(0)}%)
                        </span>
                      )}
                    </p>
                  </button>
                );
              })()}
            {orderDetails && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openPaymentModal}
                  className="px-3.5 py-2 rounded-md text-sm font-medium whitespace-nowrap"
                  style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                >
                  Принять оплату
                </button>
                <button
                  type="button"
                  disabled={repeating}
                  onClick={handleRepeatOrder}
                  className="px-3.5 py-2 rounded-md text-sm font-medium whitespace-nowrap disabled:opacity-50"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                  title="Нове замовлення з тими самими товарами за актуальними цінами"
                >
                  {repeating ? 'Створюю...' : '↻ Повторити'}
                </button>
                {orderDetails.ttnRef && (
                  <a
                    href={`/api/orders/${orderDetails.id}/ttn-label`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-md text-sm font-medium whitespace-nowrap"
                    style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                  >
                    Друкувати ТТН
                  </a>
                )}
              </div>
            )}
            {/* Листание заказов текущего списка: кнопки и стрелки ← → на клавиатуре */}
            {navigation && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={!navigation.onPrev}
                  onClick={() => navigation.onPrev?.()}
                  className="text-sm px-2.5 py-1.5 rounded-md disabled:opacity-30"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                  title="Попереднє замовлення (←)"
                  aria-label="Попереднє замовлення"
                >
                  ←
                </button>
                <span className="text-[11px] px-1 whitespace-nowrap" style={{ color: 'var(--ink-faint)' }}>
                  {navigation.positionLabel}
                </span>
                <button
                  type="button"
                  disabled={!navigation.onNext}
                  onClick={() => navigation.onNext?.()}
                  className="text-sm px-2.5 py-1.5 rounded-md disabled:opacity-30"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                  title="Наступне замовлення (→)"
                  aria-label="Наступне замовлення"
                >
                  →
                </button>
              </div>
            )}
            {/* Крестик — всегда в правом верхнем углу окна */}
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-md text-lg hover:bg-white/5"
              style={{ color: 'var(--ink-muted)' }}
              aria-label="Закрыть"
              title="Закрити (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {detailsError && (
          <p className="text-xs px-6 pt-4" style={{ color: 'var(--bad)' }}>
            {detailsError}
          </p>
        )}
        {loadingDetails && (
          <p className="text-xs px-6 py-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {/* ==================== ТЕЛО — ОДИН ОБЩИЙ СКРОЛЛ ==================== */}
        {!loadingDetails && orderDetails && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 p-6">
              {/* ==================== ЛЕВАЯ КОЛОНКА: КЛИЕНТ/ДОСТАВКА/АВТО ==================== */}
              <div className="flex flex-col gap-4 min-w-0">
                {/* ---- клиент и доставка ---- */}
                <div className="p-4 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                      КЛІЄНТ І ДОСТАВКА
                    </h3>
                    <SaveIndicator save={saveState.customer} />
                  </div>

                  {/* ---- контакти клієнта — редагуються, йдуть отримувачем у ТТН ---- */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="block text-[11px] mb-0.5" style={{ color: 'var(--ink-faint)' }}>
                        Ім&apos;я
                      </label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 text-sm rounded-md"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                        value={customerNameDraft}
                        onChange={(e) => setCustomerNameDraft(e.target.value)}
                        onBlur={handleCustomerBlur}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] mb-0.5" style={{ color: 'var(--ink-faint)' }}>
                        Прізвище
                      </label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 text-sm rounded-md"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                        value={customerSurnameDraft}
                        onChange={(e) => setCustomerSurnameDraft(e.target.value)}
                        onBlur={handleCustomerBlur}
                      />
                    </div>
                  </div>
                  <div className="mb-1">
                    <label className="block text-[11px] mb-0.5" style={{ color: 'var(--ink-faint)' }}>
                      Телефон
                    </label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      value={customerPhoneDraft}
                      onChange={(e) => setCustomerPhoneDraft(e.target.value)}
                      onBlur={handleCustomerBlur}
                    />
                    {/* Быстрые действия с телефоном: позвонить, написать в
                        Viber/Telegram, скопировать. На компьютере ссылки
                        открывают установленные приложения Viber/Telegram */}
                    {(() => {
                      const intl = toInternationalPhone(customerPhoneDraft);
                      if (!intl) return null;
                      const linkStyle = { border: '1px solid var(--line)', color: 'var(--ink-muted)' };
                      return (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <a href={`tel:+${intl}`} className="text-xs px-2 py-1 rounded-md" style={linkStyle}>
                            📞 Подзвонити
                          </a>
                          <a
                            href={`viber://chat?number=%2B${intl}`}
                            className="text-xs px-2 py-1 rounded-md"
                            style={{ ...linkStyle, color: '#9B8CFF' }}
                          >
                            Viber
                          </a>
                          <a
                            href={`https://t.me/+${intl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded-md"
                            style={{ ...linkStyle, color: '#4FB3F0' }}
                          >
                            Telegram
                          </a>
                          <CopyButton text={customerPhoneDraft.trim()} title="Скопіювати телефон" />
                        </div>
                      );
                    })()}
                  </div>

                  {/* Общий баланс клиента по ВСЕМ его заказам — видно, если
                      клиент уже должен по другим заказам */}
                  {orderDetails.customer && (
                    <div
                      className="flex items-center justify-between gap-2 text-xs mt-2 px-3 py-2 rounded-md"
                      style={{
                        background:
                          orderDetails.customer.balance > 0
                            ? 'var(--bad-soft)'
                            : orderDetails.customer.balance < 0
                              ? 'var(--good-soft)'
                              : 'var(--surface)',
                      }}
                    >
                      <span
                        style={{
                          color:
                            orderDetails.customer.balance > 0
                              ? 'var(--bad)'
                              : orderDetails.customer.balance < 0
                                ? 'var(--good)'
                                : 'var(--ink-muted)',
                        }}
                      >
                        {orderDetails.customer.balance > 0
                          ? `Клієнт винен: ${formatMoney(orderDetails.customer.balance)} грн`
                          : orderDetails.customer.balance < 0
                            ? `Передоплата клієнта: ${formatMoney(-orderDetails.customer.balance)} грн`
                            : 'Боргу немає'}
                        <span style={{ color: 'var(--ink-faint)' }}> · замовлень: {orderDetails.customer.orderCount}</span>
                      </span>
                      <a
                        href={`/admin/customers/${orderDetails.customer.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline shrink-0"
                        style={{ color: 'var(--accent)' }}
                      >
                        Картка →
                      </a>
                    </div>
                  )}

                  {/* Персональне правило ціни клієнта (розділ «Скидки и наценки
                      клиентам») — щоб менеджер не забув про нього, коли
                      домовляється про ціну */}
                  {orderDetails.pricingRule && (
                    <p className="text-xs mt-1.5 px-3 py-1.5 rounded-md" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                      Персональне правило: {orderDetails.pricingRule.ruleType === 'discount' ? 'знижка' : 'націнка'}{' '}
                      {orderDetails.pricingRule.percent}% від закупки
                    </p>
                  )}

                  <div className="text-sm flex flex-col gap-1 mb-3">
                    {orderDetails.comment && (
                      <div className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
                        {orderDetails.comment}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      Доставка Новою Поштою
                    </span>
                    <div className="flex items-center gap-2">
                      <SaveIndicator save={saveState.delivery} />
                      {!orderDetails.ttnRef && (
                        <button
                          type="button"
                          onClick={() => setEditingDelivery((v) => !v)}
                          className="text-[11px] underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          {editingDelivery ? 'Скасувати' : 'Змінити місто / відділення'}
                        </button>
                      )}
                    </div>
                  </div>

                  {editingDelivery && (
                    <div className="mb-3">
                      {/* Для "Купити в 1 клік" у city записано позначку
                          "Уточнити при дзвінку" — підставляти її в пошук
                          сенсу немає, тому стартуємо з порожнього поля */}
                      <AdminNovaPoshtaPicker
                        initialCityQuery={orderDetails.cityRef ? orderDetails.city : ''}
                        initialWarehouseQuery={orderDetails.warehouseRef ? orderDetails.novaPoshtaAddress : ''}
                        onPick={handleDeliveryPick}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                    <div>
                      <p style={{ color: 'var(--ink-faint)' }}>Місто</p>
                      <p className="mt-0.5">{orderDetails.city || '—'}</p>
                    </div>
                    <div>
                      <p style={{ color: 'var(--ink-faint)' }}>Відділення</p>
                      <p className="mt-0.5">{orderDetails.novaPoshtaAddress || '—'}</p>
                      {warehousePhone && (
                        <a
                          href={`tel:+${warehousePhone.replace(/\s+/g, '')}`}
                          className="mt-0.5 block font-mono text-[11px] hover:underline"
                          style={{ color: 'var(--accent)' }}
                        >
                          ☎ +{warehousePhone}
                        </a>
                      )}
                    </div>
                  </div>

                  {/* ---- ТТН — компактно, без отдельной кнопки ---- */}
                  <div className="pt-3" style={{ borderTop: '1px dashed var(--line)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                        ТТН
                      </label>
                      <SaveIndicator save={saveState.ttn} />
                    </div>

                    {orderDetails.ttnRef ? (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono">{orderDetails.ttnNumber}</p>
                        {orderDetails.ttnNumber && <CopyButton text={orderDetails.ttnNumber} title="Скопіювати ТТН" />}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="w-full px-3 py-2 text-sm rounded-md font-mono"
                          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                          placeholder="Ще не вказано"
                          value={ttnDraft}
                          onChange={(e) => setTtnDraft(e.target.value)}
                          onBlur={handleTtnBlur}
                        />
                        {ttnDraft.trim() && <CopyButton text={ttnDraft.trim()} title="Скопіювати ТТН" />}
                      </div>
                    )}

                    {/* ---- де зараз посилка (статус від Нової Пошти) ---- */}
                    {orderDetails.ttnNumber && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between gap-2">
                          {ttnStatus ? (
                            <span
                              className="text-xs px-2 py-1 rounded-md font-medium"
                              style={{ background: TTN_KIND_COLORS[ttnStatus.kind].bg, color: TTN_KIND_COLORS[ttnStatus.kind].fg }}
                            >
                              {ttnStatus.statusText}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: ttnStatusError ? 'var(--bad)' : 'var(--ink-faint)' }}>
                              {ttnStatusLoading ? 'Перевіряю статус посилки...' : ttnStatusError || ''}
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={ttnStatusLoading}
                            onClick={() => setTtnStatusVersion((v) => v + 1)}
                            className="text-[11px] underline shrink-0 disabled:opacity-50"
                            style={{ color: 'var(--accent)' }}
                          >
                            {ttnStatusLoading ? '...' : 'Оновити'}
                          </button>
                        </div>
                        {ttnStatus && (
                          <div className="text-[11px] mt-1 flex flex-col gap-0.5" style={{ color: 'var(--ink-muted)' }}>
                            {ttnStatus.kind === 'in_transit' && ttnStatus.scheduledDelivery && (
                              <span>Очікувана доставка: {formatDateTime(ttnStatus.scheduledDelivery)}</span>
                            )}
                            {ttnStatus.kind === 'arrived' && ttnStatus.arrivedAt && (
                              <span>
                                У відділенні з {formatDateTime(ttnStatus.arrivedAt)}
                                {ttnStatus.daysAtWarehouse !== null ? ` · днів: ${ttnStatus.daysAtWarehouse}` : ''}
                              </span>
                            )}
                            {ttnStatus.kind === 'arrived' && ttnStatus.paidStorageFrom && (
                              <span>Платне зберігання з: {formatDateTime(ttnStatus.paidStorageFrom)}</span>
                            )}
                            {ttnStatus.kind === 'received' && ttnStatus.receivedAt && (
                              <span>Отримано: {formatDateTime(ttnStatus.receivedAt)}</span>
                            )}
                            {/* Клієнт давно не забирає посилку — час подзвонити,
                                поки не почалось платне зберігання чи повернення */}
                            {ttnStatus.kind === 'arrived' &&
                              ttnStatus.daysAtWarehouse !== null &&
                              ttnStatus.daysAtWarehouse >= STORAGE_WARNING_DAYS && (
                                <span className="font-medium" style={{ color: 'var(--bad)' }}>
                                  ⚠ Посилка лежить у відділенні {ttnStatus.daysAtWarehouse} дн. — зателефонуйте клієнту
                                </span>
                              )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ---- повідомлення клієнту про ТТН ----
                        Автоматично воно йде в Telegram, як тільки з'являється
                        номер, — але лише тим, хто підключив бота магазину.
                        Тут видно, чи підключений клієнт, і можна надіслати
                        ще раз або відправити текст у Viber вручну */}
                    {orderDetails.ttnNumber && (() => {
                      const orderNumber = orderDetails.orderNumber;
                      const ttn = orderDetails.ttnNumber;
                      const trackingUrl = `https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(ttn.replace(/\s+/g, ''))}`;
                      const messageText = [
                        `Ваше замовлення №${orderNumber} відправлено Новою Поштою!`,
                        `Номер ТТН: ${ttn}`,
                        `Відстежити: ${trackingUrl}`,
                      ].join('\n');
                      const buttonStyle = { border: '1px solid var(--line)', color: 'var(--ink-muted)' };
                      return (
                        <div className="mt-2.5 p-2.5 rounded-md" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                          <p className="text-[11px] mb-1.5" style={{ color: orderDetails.telegramLinked ? 'var(--good)' : 'var(--ink-faint)' }}>
                            {orderDetails.telegramLinked
                              ? '✓ Клієнт підключив Telegram — ТТН надсилається йому автоматично'
                              : 'Клієнт не підключав Telegram-бота — автоматично ТТН не отримає'}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {orderDetails.telegramLinked && (
                              <button
                                type="button"
                                disabled={ttnNotify.state === 'sending'}
                                onClick={handleNotifyTtn}
                                className="text-xs px-2 py-1 rounded-md disabled:opacity-50"
                                style={{ ...buttonStyle, color: '#4FB3F0' }}
                              >
                                {ttnNotify.state === 'sending' ? 'Надсилаю...' : 'Надіслати ТТН у Telegram'}
                              </button>
                            )}
                            <a
                              href={`viber://forward?text=${encodeURIComponent(messageText)}`}
                              className="text-xs px-2 py-1 rounded-md"
                              style={{ ...buttonStyle, color: '#9B8CFF' }}
                              title="Відкриє Viber і запропонує обрати, кому переслати текст"
                            >
                              Надіслати у Viber
                            </a>
                            <a
                              href={trackingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-2 py-1 rounded-md"
                              style={buttonStyle}
                            >
                              Відстежити ↗
                            </a>
                            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--ink-faint)' }}>
                              текст:
                              <CopyButton text={messageText} title="Скопіювати текст повідомлення" />
                            </span>
                          </div>
                          {ttnNotify.text && (
                            <p
                              className="text-[11px] mt-1.5"
                              style={{ color: ttnNotify.state === 'done' ? 'var(--good)' : 'var(--warn)' }}
                            >
                              {ttnNotify.text}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {!orderDetails.ttnRef && !orderDetails.ttnNumber && !showCreateTtn && (
                      <button
                        type="button"
                        onClick={openCreateTtn}
                        className="text-[11px] mt-1.5 underline"
                        style={{ color: 'var(--accent)' }}
                      >
                        Створити ТТН автоматично через Нову Пошту →
                      </button>
                    )}

                    {showCreateTtn && (
                      <div className="mt-2.5 pt-2.5 flex flex-col gap-2" style={{ borderTop: '1px dashed var(--line)' }}>
                        {/* Покупець уже обрав це відділення на сайті через
                            реальний пошук Нової Пошти (city_ref/warehouse_ref,
                            секція 33 schema.sql) — шукати заново не треба,
                            просто показуємо, що саме буде використано, з
                            можливістю обрати інше через "Змінити" */}
                        {!showManualPicker && ttnRecipient ? (
                          <div
                            className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-[11px]"
                            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                          >
                            <span style={{ color: 'var(--good)' }}>
                              ✓ {ttnRecipient.label} <span style={{ color: 'var(--ink-faint)' }}>(з форми замовлення)</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowManualPicker(true)}
                              className="underline shrink-0"
                              style={{ color: 'var(--accent)' }}
                            >
                              Змінити
                            </button>
                          </div>
                        ) : (
                          <>
                            <AdminNovaPoshtaPicker
                              initialCityQuery={orderDetails.city}
                              initialWarehouseQuery={orderDetails.novaPoshtaAddress}
                              onPick={({ cityRef, cityName, warehouseRef, warehouseDescription }) =>
                                setTtnRecipient({ cityRef, warehouseRef, label: `${cityName}, ${warehouseDescription}` })
                              }
                            />
                            {ttnRecipient && (
                              <p className="text-[11px]" style={{ color: 'var(--good)' }}>
                                Обрано: {ttnRecipient.label}
                              </p>
                            )}
                          </>
                        )}

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Вага, кг
                            </label>
                            <input
                              type="number"
                              min={0.1}
                              step="0.1"
                              className="w-full px-3 py-2 text-sm rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnWeight}
                              onChange={(e) => setTtnWeight(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Місць
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              className="w-full px-3 py-2 text-sm rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnSeats}
                              onChange={(e) => setTtnSeats(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Оцінка, грн
                            </label>
                            <input
                              type="number"
                              min={1}
                              step="1"
                              className="w-full px-3 py-2 text-sm rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnCost}
                              onChange={(e) => setTtnCost(e.target.value)}
                            />
                          </div>
                        </div>

                        <select
                          className="w-full px-3 py-2 text-sm rounded-md"
                          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                          value={ttnPayerType}
                          onChange={(e) => setTtnPayerType(e.target.value as 'Recipient' | 'Sender')}
                        >
                          <option value="Recipient">Платить отримувач</option>
                          <option value="Sender">Платить відправник</option>
                        </select>

                        <input
                          type="text"
                          placeholder="Опис відправлення"
                          className="w-full px-3 py-2 text-sm rounded-md"
                          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                          value={ttnDescription}
                          onChange={(e) => setTtnDescription(e.target.value)}
                        />

                        {/* ---- післяплата: Нова Пошта візьме гроші з клієнта при
                            отриманні й перекаже нам (комісію платить отримувач) ---- */}
                        <div className="p-2.5 rounded-md" style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={ttnCodEnabled}
                              onChange={(e) => setTtnCodEnabled(e.target.checked)}
                            />
                            З післяплатою
                          </label>
                          {ttnCodEnabled && (
                            <div className="flex items-center gap-2 mt-2">
                              <input
                                type="text"
                                inputMode="decimal"
                                className="w-32 px-3 py-2 text-sm rounded-md font-mono text-right"
                                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                                value={ttnCodAmount}
                                onChange={(e) => setTtnCodAmount(e.target.value)}
                              />
                              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                                грн
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setTtnCodAmount(
                                    String(Math.max(0, Math.ceil(orderDetails.totalAmount - orderDetails.paidAmount)))
                                  )
                                }
                                className="text-[11px] underline"
                                style={{ color: 'var(--accent)' }}
                              >
                                = недоплата ({formatMoney(Math.max(0, orderDetails.totalAmount - orderDetails.paidAmount))} грн)
                              </button>
                            </div>
                          )}
                          <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                            Клієнт заплатить при отриманні. Оголошена вартість автоматично буде не меншою за суму
                            післяплати.
                          </p>
                        </div>

                        {createTtnError && (
                          <p className="text-[11px]" style={{ color: 'var(--bad)' }}>
                            {createTtnError}
                          </p>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={creatingTtn}
                            onClick={handleCreateTtn}
                            className="flex-1 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                          >
                            {creatingTtn ? 'Створення...' : 'Створити ТТН'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowCreateTtn(false)}
                            className="px-3 py-1.5 rounded-md text-xs"
                            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                          >
                            Відміна
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ---- нагадування "Передзвонити" ----
                    Замовлення з нагадуванням на сьогодні видно у списку (фільтр
                    «📞 Передзвонити»), а в меню — лічильник, коли час настав */}
                {(() => {
                  const callbackDate = orderDetails.callbackAt ? new Date(orderDetails.callbackAt) : null;
                  const isDue = callbackDate ? callbackDate.getTime() <= Date.now() : false;
                  const quickButtonStyle = { border: '1px solid var(--line)', color: 'var(--ink-muted)' };
                  const at = (daysAhead: number, hours: number) => {
                    const d = new Date();
                    d.setDate(d.getDate() + daysAhead);
                    d.setHours(hours, 0, 0, 0);
                    return d;
                  };
                  return (
                    <div
                      className="p-4 rounded-md"
                      style={{
                        background: isDue ? 'var(--bad-soft)' : 'var(--surface-2)',
                        border: '1px solid var(--line)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-semibold" style={{ color: isDue ? 'var(--bad)' : 'var(--ink-muted)' }}>
                          📞 ПЕРЕДЗВОНИТИ{isDue ? ' — ЧАС НАСТАВ' : ''}
                        </h3>
                        <SaveIndicator save={saveState.callback} />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="datetime-local"
                          className="px-3 py-2 text-sm rounded-md"
                          // colorScheme: 'dark' — иначе значок календаря чёрный на тёмном фоне
                          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', colorScheme: 'dark' }}
                          value={callbackDate ? toDateTimeLocal(callbackDate) : ''}
                          onChange={(e) => {
                            if (!e.target.value) return;
                            const d = new Date(e.target.value);
                            if (!Number.isNaN(d.getTime())) saveCallback(d);
                          }}
                        />
                        {callbackDate && (
                          <button
                            type="button"
                            onClick={() => saveCallback(null)}
                            className="text-xs px-2.5 py-1.5 rounded-md font-medium"
                            style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                            title="Зателефонували — зняти нагадування"
                          >
                            ✓ Виконано
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <button type="button" onClick={() => saveCallback(new Date(Date.now() + 60 * 60 * 1000))} className="text-[11px] px-2 py-1 rounded-md" style={quickButtonStyle}>
                          через 1 год
                        </button>
                        <button type="button" onClick={() => saveCallback(at(0, 17))} className="text-[11px] px-2 py-1 rounded-md" style={quickButtonStyle}>
                          сьогодні 17:00
                        </button>
                        <button type="button" onClick={() => saveCallback(at(1, 10))} className="text-[11px] px-2 py-1 rounded-md" style={quickButtonStyle}>
                          завтра 10:00
                        </button>
                        <button type="button" onClick={() => saveCallback(at(3, 10))} className="text-[11px] px-2 py-1 rounded-md" style={quickButtonStyle}>
                          через 3 дні
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ---- внутрішня замітка менеджера (клієнт її не бачить) ---- */}
                <div className="p-4 rounded-md" style={{ background: 'var(--warn-soft)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold" style={{ color: 'var(--warn)' }}>
                      ЗАМІТКА МЕНЕДЖЕРА
                    </h3>
                    <SaveIndicator save={saveState.note} />
                  </div>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2 text-sm rounded-md resize-y"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                    placeholder="напр. «дзвонити після 18:00», «чекаємо деталь у п'ятницю»"
                    value={managerNoteDraft}
                    onChange={(e) => setManagerNoteDraft(e.target.value)}
                    onBlur={handleManagerNoteBlur}
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                    Бачать лише співробітники. Зберігається сама, коли клацнете поза полем.
                  </p>
                </div>

                {/* ---- автомобіль клієнта ---- */}
                <div className="p-4 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                      АВТОМОБІЛЬ КЛІЄНТА
                    </h3>
                    <SaveIndicator save={saveState.vehicle} />
                  </div>
                  {/* Авто и VIN — в две строки: VIN из 17 символов в узком поле
                      рядом с авто не помещался и цифры обрезались */}
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      placeholder="напр. Volkswagen Golf 2015"
                      value={carInfoDraft}
                      onChange={(e) => setCarInfoDraft(e.target.value)}
                      onBlur={handleVehicleBlur}
                    />
                    <input
                      type="text"
                      maxLength={17}
                      className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase tracking-wide"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      placeholder="VIN"
                      value={vinDraft}
                      onChange={(e) => setVinDraft(e.target.value.toUpperCase())}
                      onBlur={handleVehicleBlur}
                    />
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                    Необов&apos;язково — потрапляє в шапку друкованих документів.
                  </p>
                </div>

                {/* ---- друк документів ---- */}
                <PrintDocumentsPanel
                  orderId={orderDetails.id}
                  orderNumber={orderDetails.orderNumber}
                  telegramLinked={orderDetails.telegramLinked}
                  items={orderDetails.items}
                  onItemNameSaved={(itemId, name) => {
                    setOrderDetails((prev) =>
                      prev
                        ? { ...prev, items: prev.items.map((item) => (item.id === itemId ? { ...item, name } : item)) }
                        : prev
                    );
                  }}
                />
              </div>

              {/* ==================== ПРАВАЯ КОЛОНКА: СОСТАВ ЗАКАЗА ==================== */}
              <div className="min-w-0">
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                    СКЛАД ЗАМОВЛЕННЯ
                  </h3>
                  <div className="flex items-center gap-2">
                    <PaymentBadge paidAmount={orderDetails.paidAmount} totalAmount={orderDetails.totalAmount} />
                    {orderDetails.status !== 'shipped' && (
                      <button
                        type="button"
                        onClick={() => (showAddItem ? closeAddItem() : setShowAddItem(true))}
                        className="text-[11px] px-2 py-1 rounded-md"
                        style={{
                          color: showAddItem ? 'var(--accent-ink)' : 'var(--accent)',
                          background: showAddItem ? 'var(--accent)' : 'transparent',
                          border: '1px solid var(--accent)',
                        }}
                      >
                        + Додати товар
                      </button>
                    )}
                    {orderDetails.status !== 'shipped' && orderDetails.items.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowDiscount((v) => !v);
                          setDiscountError(null);
                        }}
                        className="text-[11px] px-2 py-1 rounded-md"
                        style={{
                          color: showDiscount ? 'var(--accent-ink)' : 'var(--warn)',
                          background: showDiscount ? 'var(--warn)' : 'transparent',
                          border: '1px solid var(--warn)',
                        }}
                      >
                        % Знижка
                      </button>
                    )}
                    {orderDetails.status !== 'shipped' &&
                      orderDetails.status !== 'cancelled' &&
                      orderDetails.items.filter((i) => i.status !== 'cancelled' && i.status !== 'returned').length >= 2 && (
                        <button
                          type="button"
                          onClick={() => (showSplit ? setShowSplit(false) : openSplit())}
                          className="text-[11px] px-2 py-1 rounded-md"
                          style={{
                            color: showSplit ? 'var(--accent-ink)' : 'var(--ink-muted)',
                            background: showSplit ? 'var(--ink-muted)' : 'transparent',
                            border: '1px solid var(--ink-muted)',
                          }}
                          title="Перенести частину позицій у нове замовлення"
                        >
                          ✂ Розділити
                        </button>
                      )}
                  </div>
                </div>

                {/* ---- розділення замовлення: відмічені позиції переїдуть у нове
                    замовлення (готові лишаються тут і можуть їхати зараз) ---- */}
                {showSplit && (
                  <div className="mb-3 p-3 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <p className="text-xs mb-2" style={{ color: 'var(--ink-muted)' }}>
                      Відмітьте позиції, які переїдуть у <b>нове замовлення</b>. Решта залишиться тут.
                    </p>
                    <div className="flex flex-col gap-1">
                      {orderDetails.items
                        .filter((i) => i.status !== 'cancelled' && i.status !== 'returned')
                        .map((item) => {
                          const movable = item.status === 'pending' || item.status === 'ordered_from_supplier' || item.status === 'in_stock';
                          return (
                            <label
                              key={item.id}
                              className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md cursor-pointer"
                              style={{ background: 'var(--surface)', opacity: movable ? 1 : 0.5 }}
                            >
                              <input
                                type="checkbox"
                                disabled={!movable}
                                checked={splitSelected.has(item.id)}
                                onChange={(e) =>
                                  setSplitSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(item.id);
                                    else next.delete(item.id);
                                    return next;
                                  })
                                }
                              />
                              <span className="font-mono text-xs">{item.article}</span>
                              <span className="truncate">{item.name || ''}</span>
                              <span className="ml-auto text-[11px]" style={{ color: ITEM_STATUS_COLORS[item.status].fg }}>
                                {ITEM_STATUS_LABELS[item.status]}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        type="button"
                        disabled={splitting || splitSelected.size === 0}
                        onClick={handleSplit}
                        className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                        style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                      >
                        {splitting ? 'Розділяю...' : `Перенести ${splitSelected.size} поз. у нове замовлення`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowSplit(false)}
                        className="px-4 py-2 rounded-md text-sm"
                        style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                      >
                        Скасувати
                      </button>
                    </div>
                    {splitError && (
                      <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                        {splitError}
                      </p>
                    )}
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                      Оплати залишаться в цьому замовленні. Доставка, клієнт і авто скопіюються в нове.
                    </p>
                  </div>
                )}

                {/* ---- знижка на все замовлення: відсоток або сума в гривнях
                    (сума розкладається на позиції пропорційно їх вартості) ---- */}
                {showDiscount && (
                  <div className="mb-3 p-3 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="px-3 py-2 text-sm rounded-md"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value as 'percent' | 'amount')}
                      >
                        <option value="percent">Відсоток, %</option>
                        <option value="amount">Сума, грн</option>
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        className="w-28 px-3 py-2 text-sm rounded-md font-mono text-right"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                        placeholder={discountType === 'percent' ? '5' : '200'}
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleApplyDiscount();
                          }
                        }}
                      />
                      <button
                        type="button"
                        disabled={discountSaving}
                        onClick={handleApplyDiscount}
                        className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                        style={{ background: 'var(--warn)', color: '#1a1a1a' }}
                      >
                        {discountSaving ? 'Застосовую...' : 'Застосувати'}
                      </button>
                      {/* Попередній перегляд нової суми — до натискання */}
                      {(() => {
                        const value = parseFloat(discountValue.replace(',', '.'));
                        if (!Number.isFinite(value) || value <= 0) return null;
                        const activeTotal = orderDetails.items
                          .filter((i) => i.status !== 'shipped' && i.status !== 'returned' && i.status !== 'cancelled')
                          .reduce((sum, i) => sum + i.price * i.quantity, 0);
                        const after = discountType === 'percent' ? activeTotal * (1 - value / 100) : activeTotal - value;
                        return (
                          <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                            {formatMoney(activeTotal)} → <b>{formatMoney(Math.max(0, after))} грн</b>
                          </span>
                        );
                      })()}
                    </div>
                    {discountError && (
                      <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                        {discountError}
                      </p>
                    )}
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                      Знижка змінює ціни продажу позицій (без відвантажених і повернених). Знижку на одну позицію — у
                      формі редагування позиції (кнопки «−5%», «−10%»).
                    </p>
                  </div>
                )}

                {/* ---- пошук і додавання нової позиції (клієнт хоче
                    докупити щось ще, вже після оформлення заказа) ---- */}
                {showAddItem && (
                  <div className="mb-3 p-3 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                    <input
                      type="text"
                      autoFocus
                      value={addItemSearch}
                      onChange={(e) => setAddItemSearch(e.target.value)}
                      placeholder="Артикул або назва товару..."
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                    />
                    {addItemSearching && (
                      <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
                        Пошук...
                      </p>
                    )}
                    {addItemError && (
                      <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                        {addItemError}
                      </p>
                    )}
                    {addItemResults.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                        {addItemResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={addingItemId === p.id}
                            onClick={() => handleAddItem(p)}
                            className="flex items-center justify-between gap-2 p-2 rounded-md text-left text-xs disabled:opacity-50"
                            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                          >
                            <div className="min-w-0">
                              <p className="truncate">{p.name || p.article}</p>
                              <p className="font-mono mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                                {p.article}
                                {p.brand ? ` · ${p.brand}` : ''} · {p.supplierName} ·{' '}
                                {p.stock > 0 ? `${p.stock} шт` : 'під замовлення'}
                              </p>
                            </div>
                            <span className="font-mono shrink-0">
                              {addingItemId === p.id ? 'Додавання...' : `${formatMoney(p.retailPrice)} грн`}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {orderDetails.items.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                    В заказе нет ни одной позиции.
                  </p>
                ) : (
                  <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--line)' }}>
                            {['Товар', 'К-сть', 'Ціна', 'Сума', 'Статус', ''].map((h, i) => (
                              <th
                                key={h || i}
                                className={`text-left px-3 py-2 text-[11px] font-medium whitespace-nowrap ${
                                  i === 1 || i === 2 || i === 3 ? 'text-right' : ''
                                }`}
                                style={{ color: 'var(--ink-muted)' }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {orderDetails.items.map((item) => {
                            const isEditing = editingItemId === item.id;
                            const isReturning = returningItemId === item.id;

                            return (
                              <Fragment key={item.id}>
                                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                                  <td className="px-3 py-2.5 align-top">
                                    <div className="flex gap-2.5">
                                    {/* Фото товара (или заглушка) — клик открывает страницу
                                        товара на сайте, чтобы сверить деталь с клиентом */}
                                    {item.productPath ? (
                                      <a
                                        href={item.productPath}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="shrink-0 w-11 h-11 rounded-md overflow-hidden flex items-center justify-center"
                                        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                                        title="Відкрити сторінку товару на сайті"
                                      >
                                        <ItemThumb src={item.imageUrl} />
                                      </a>
                                    ) : (
                                      <div
                                        className="shrink-0 w-11 h-11 rounded-md flex items-center justify-center text-[10px] text-center"
                                        style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink-faint)' }}
                                        title="Товару вже немає в каталозі"
                                      >
                                        —
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                    <p className="truncate max-w-[220px]">{item.name || 'Без названия'}</p>
                                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                                      {item.article}
                                      {item.brand ? ` · ${item.brand}` : ''}
                                      {item.supplierName ? ` · ${item.supplierName}` : ''}
                                      {item.supplierContactName ? ` (${item.supplierContactName})` : ''}
                                    </p>
                                    {item.productPath && (
                                      <a
                                        href={item.productPath}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] underline"
                                        style={{ color: 'var(--accent)' }}
                                      >
                                        на сайті ↗
                                      </a>
                                    )}
                                    {/* Деталь уже лежить у нас на складі — можна не замовляти
                                        у постачальника, а одразу взяти з полиці */}
                                    {item.status === 'pending' &&
                                      (stockAvailability[item.id] || []).length > 0 &&
                                      (() => {
                                        const options = stockAvailability[item.id];
                                        const enough = options.find((o) => o.available >= item.quantity);
                                        const total = options.reduce((sum, o) => sum + o.available, 0);
                                        return (
                                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                            <span className="text-xs" style={{ color: 'var(--good)' }}>
                                              ● У нас на складі: {total} шт
                                            </span>
                                            {enough ? (
                                              <button
                                                type="button"
                                                disabled={takingItemId === item.id}
                                                onClick={() => handleTakeFromStock(item, enough)}
                                                className="text-[11px] px-2 py-0.5 rounded-md disabled:opacity-50"
                                                style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                                                title={`Взяти ${item.quantity} шт з нашого складу (${enough.supplierName}, закупка ${formatMoney(enough.costPrice)} грн)`}
                                              >
                                                {takingItemId === item.id ? 'Беру...' : 'Взяти зі складу'}
                                              </button>
                                            ) : (
                                              <span className="text-[11px]" style={{ color: 'var(--warn)' }}>
                                                (потрібно {item.quantity} шт — не вистачає)
                                              </span>
                                            )}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right font-mono whitespace-nowrap">
                                    {item.quantity}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right font-mono whitespace-nowrap">
                                    {formatMoney(item.price)}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right font-mono whitespace-nowrap">
                                    {formatMoney(item.price * item.quantity)}
                                  </td>
                                  <td className="px-3 py-2.5 align-top whitespace-nowrap">
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                      style={{
                                        background: ITEM_STATUS_COLORS[item.status].bg,
                                        color: ITEM_STATUS_COLORS[item.status].fg,
                                      }}
                                    >
                                      {ITEM_STATUS_LABELS[item.status]}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                                    <div className="flex justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => (isEditing ? cancelItemEdit() : openItemEdit(item))}
                                        className="text-base leading-none px-2.5 py-2 rounded-md"
                                        style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                        title="Изменить цену/поставщика"
                                      >
                                        ✎
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => (isReturning ? cancelItemReturn() : openItemReturn(item))}
                                        className="text-base leading-none px-2.5 py-2 rounded-md"
                                        style={{ border: '1px solid var(--line)', color: 'var(--bad)' }}
                                        title="Оформить возврат"
                                      >
                                        ↩
                                      </button>
                                      {/* Удалить можно только то, что ещё не уехало клиенту:
                                          отгруженное/возвращённое оформляется возвратом (↩) */}
                                      {orderDetails.status !== 'shipped' &&
                                        item.status !== 'shipped' &&
                                        item.status !== 'returned' && (
                                          <button
                                            type="button"
                                            disabled={deletingItemId === item.id}
                                            onClick={() => handleDeleteItem(item)}
                                            className="text-base leading-none px-2.5 py-2 rounded-md disabled:opacity-40"
                                            style={{ border: '1px solid var(--line)', color: 'var(--bad)' }}
                                            title="Видалити позицію з замовлення"
                                            aria-label="Видалити позицію"
                                          >
                                            🗑
                                          </button>
                                        )}
                                    </div>
                                  </td>
                                </tr>

                                {isEditing && (
                                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                                    <td
                                      colSpan={6}
                                      className="px-3 py-3"
                                      // Enter в любом поле формы — сохранить позицию
                                      // (Esc — отменить, см. обработчик клавиш выше).
                                      // На кнопках Enter работает как обычно
                                      onKeyDown={(e) => {
                                        const tag = (e.target as HTMLElement).tagName;
                                        if (e.key === 'Enter' && tag !== 'BUTTON' && !editItemSaving) {
                                          e.preventDefault();
                                          handleSaveItem();
                                        }
                                      }}
                                    >
                                      {/* ==== ПРЕДЛОЖЕНИЯ ВСЕХ ПОСТАВЩИКОВ ПО ЭТОМУ АРТИКУЛУ ==== */}
                                      <div className="mb-3">
                                        <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                                          Хто ще має цей артикул
                                        </p>
                                        {itemOffersLoading && (
                                          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                                            Пошук пропозицій...
                                          </p>
                                        )}
                                        {itemOffersError && (
                                          <p className="text-xs" style={{ color: 'var(--bad)' }}>
                                            {itemOffersError}
                                          </p>
                                        )}
                                        {!itemOffersLoading && !itemOffersError && itemOffers.length === 0 && (
                                          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                                            Інших пропозицій у прайсах не знайдено.
                                          </p>
                                        )}
                                        {itemOffers.length > 0 && (
                                          <div
                                            className="rounded-md overflow-hidden max-h-56 overflow-y-auto"
                                            style={{ border: '1px solid var(--line)' }}
                                          >
                                            <table className="w-full text-sm">
                                              <thead>
                                                <tr style={{ background: 'var(--surface)' }}>
                                                  {['Постачальник', 'Бренд', 'Наявність', 'Закупка', 'Прайс', ''].map((h, i) => (
                                                    <th
                                                      key={h || i}
                                                      className={`px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap ${
                                                        i >= 2 && i <= 4 ? 'text-right' : 'text-left'
                                                      }`}
                                                      style={{ color: 'var(--ink-muted)' }}
                                                    >
                                                      {h}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {itemOffers.map((offer) => {
                                                  // Подсвечиваем строку того поставщика, который сейчас
                                                  // выбран в поле "Поставщик" ниже
                                                  const isSelected = offer.supplierId === editItemSupplierId;
                                                  return (
                                                    <tr
                                                      key={offer.productId}
                                                      onClick={() => pickOffer(offer)}
                                                      className="cursor-pointer"
                                                      style={{
                                                        borderTop: '1px solid var(--line)',
                                                        background: isSelected ? 'var(--accent-soft)' : 'transparent',
                                                      }}
                                                    >
                                                      <td className="px-2.5 py-1.5 whitespace-nowrap">{offer.supplierName}</td>
                                                      <td
                                                        className="px-2.5 py-1.5 whitespace-nowrap"
                                                        style={{ color: offer.sameBrand ? 'var(--ink)' : 'var(--warn)' }}
                                                        title={offer.sameBrand ? '' : 'Інший бренд — можливо, інша деталь'}
                                                      >
                                                        {offer.brand || '—'}
                                                      </td>
                                                      <td
                                                        className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap"
                                                        style={{ color: offer.stock > 0 ? 'var(--good)' : 'var(--ink-faint)' }}
                                                      >
                                                        {offer.stock > 0 ? `${offer.stock} шт` : 'немає'}
                                                      </td>
                                                      <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">
                                                        {formatMoney(offer.costPrice)}
                                                      </td>
                                                      <td
                                                        className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap"
                                                        style={{ color: 'var(--ink-muted)' }}
                                                      >
                                                        {formatMoney(offer.retailPrice)}
                                                      </td>
                                                      <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                                                        <span
                                                          className="text-[11px] px-2 py-0.5 rounded-md"
                                                          style={{
                                                            color: isSelected ? 'var(--accent-ink)' : 'var(--accent)',
                                                            background: isSelected ? 'var(--accent)' : 'transparent',
                                                            border: '1px solid var(--accent)',
                                                          }}
                                                        >
                                                          {isSelected ? 'Обрано' : 'Обрати'}
                                                        </span>
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>

                                      {/* ==== АНАЛОГИ: ІНШІ АРТИКУЛИ (крос-номери) ====
                                          Якщо оригіналу немає або він дорогий — можна замінити
                                          деталь на аналог. Лише для позицій, які ще не замовляли */}
                                      {itemAnalogs.length > 0 && item.status === 'pending' && (
                                        <div className="mb-3">
                                          <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                                            Аналоги (інші артикули) — {itemAnalogs.length}
                                          </p>
                                          <div className="rounded-md overflow-hidden max-h-56 overflow-y-auto" style={{ border: '1px solid var(--line)' }}>
                                            <table className="w-full text-sm">
                                              <thead>
                                                <tr style={{ background: 'var(--surface)' }}>
                                                  {['Деталь', 'Тип', 'Постачальник', 'Наявність', 'Закупка', 'Прайс', ''].map((h, i) => (
                                                    <th
                                                      key={h || i}
                                                      className={`px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap ${
                                                        i >= 3 && i <= 5 ? 'text-right' : 'text-left'
                                                      }`}
                                                      style={{ color: 'var(--ink-muted)' }}
                                                    >
                                                      {h}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {itemAnalogs.map((analog) => (
                                                  <tr key={analog.productId} style={{ borderTop: '1px solid var(--line)' }}>
                                                    <td className="px-2.5 py-1.5">
                                                      <span className="font-mono text-xs">{analog.article}</span>
                                                      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                                                        {' '}
                                                        · {analog.brand || '—'}
                                                      </span>
                                                    </td>
                                                    <td className="px-2.5 py-1.5 text-[11px] whitespace-nowrap" style={{ color: analog.relation === 'oem' ? 'var(--accent)' : 'var(--ink-muted)' }}>
                                                      {analog.relation === 'oem' ? 'оригінал' : 'аналог'}
                                                    </td>
                                                    <td className="px-2.5 py-1.5 text-xs whitespace-nowrap">{analog.supplierName}</td>
                                                    <td
                                                      className="px-2.5 py-1.5 text-right font-mono text-xs whitespace-nowrap"
                                                      style={{ color: analog.stock > 0 ? 'var(--good)' : 'var(--ink-faint)' }}
                                                    >
                                                      {analog.stock > 0 ? `${analog.stock} шт` : 'немає'}
                                                    </td>
                                                    <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{formatMoney(analog.costPrice)}</td>
                                                    <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                                                      {formatMoney(analog.retailPrice)}
                                                    </td>
                                                    <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                                                      <button
                                                        type="button"
                                                        disabled={replacingProductId !== null}
                                                        onClick={() => handleReplaceWithAnalog(item, analog)}
                                                        className="text-[11px] px-2 py-0.5 rounded-md disabled:opacity-50"
                                                        style={{ color: 'var(--warn)', border: '1px solid var(--warn)' }}
                                                      >
                                                        {replacingProductId === analog.productId ? '...' : 'Замінити'}
                                                      </button>
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}

                                      {/* Порядок полей — как думает менеджер: сначала У КОГО
                                          берём (поставщик), потом ПО ЧЁМ берём (закупка), потом
                                          ЗА СКОЛЬКО продаём и сколько штук. Поля крупные (text-sm,
                                          py-2), чтобы цифры целиком помещались и легко читались */}
                                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)] gap-3 mb-3">
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Поставщик
                                          </label>
                                          <select
                                            className="w-full px-3 py-2 text-sm rounded-md"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemSupplierId}
                                            onChange={(e) => setEditItemSupplierId(e.target.value)}
                                            autoFocus
                                          >
                                            <option value="">Выберите поставщика</option>
                                            {suppliers.map((s) => (
                                              <option key={s.id} value={s.id}>
                                                {s.name}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Ціна закупки, грн
                                          </label>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            className="w-full min-w-[7rem] px-3 py-2 text-sm rounded-md font-mono text-right"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemCostPrice}
                                            onChange={(e) => setEditItemCostPrice(e.target.value)}
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Ціна продажу, грн
                                          </label>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            className="w-full min-w-[7rem] px-3 py-2 text-sm rounded-md font-mono text-right"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemPrice}
                                            onChange={(e) => setEditItemPrice(e.target.value)}
                                          />
                                          {/* Быстрая цена продажи: из прайса выбранного поставщика
                                              или наценка от закупки. Округляем вверх до целой гривны —
                                              так цены выглядят аккуратно и точно не ниже расчёта */}
                                          {(() => {
                                            const cost = parseFloat(editItemCostPrice.replace(',', '.'));
                                            const selectedOffer = itemOffers.find((o) => o.supplierId === editItemSupplierId);
                                            const hasCost = Number.isFinite(cost) && cost > 0;
                                            if (!selectedOffer && !hasCost) return null;
                                            return (
                                              <div className="flex flex-wrap gap-1 mt-1.5">
                                                {selectedOffer && selectedOffer.retailPrice > 0 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setEditItemPrice(String(Math.ceil(selectedOffer.retailPrice)))}
                                                    className="text-[11px] px-1.5 py-0.5 rounded"
                                                    style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                                    title="Ціна з прайсу обраного постачальника"
                                                  >
                                                    Прайс
                                                  </button>
                                                )}
                                                {/* Знижка від поточної ціни продажу позиції */}
                                                {(() => {
                                                  const sale = parseFloat(editItemPrice.replace(',', '.'));
                                                  if (!Number.isFinite(sale) || sale <= 0) return null;
                                                  return QUICK_DISCOUNTS.map((percent) => (
                                                    <button
                                                      key={`d${percent}`}
                                                      type="button"
                                                      onClick={() => setEditItemPrice(String(Math.floor(sale * (1 - percent / 100))))}
                                                      className="text-[11px] px-1.5 py-0.5 rounded"
                                                      style={{ border: '1px solid var(--line)', color: 'var(--warn)' }}
                                                      title={`Знижка ${percent}% від поточної ціни продажу`}
                                                    >
                                                      −{percent}%
                                                    </button>
                                                  ));
                                                })()}
                                                {hasCost &&
                                                  QUICK_MARKUPS.map((percent) => (
                                                    <button
                                                      key={percent}
                                                      type="button"
                                                      onClick={() => setEditItemPrice(String(Math.ceil(cost * (1 + percent / 100))))}
                                                      className="text-[11px] px-1.5 py-0.5 rounded"
                                                      style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                                      title={`Закупка + ${percent}%`}
                                                    >
                                                      +{percent}%
                                                    </button>
                                                  ))}
                                              </div>
                                            );
                                          })()}
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Кількість
                                          </label>
                                          <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            className="w-full min-w-[4.5rem] px-3 py-2 text-sm rounded-md font-mono text-right"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemQuantity}
                                            onChange={(e) => setEditItemQuantity(e.target.value)}
                                          />
                                        </div>
                                      </div>

                                      {/* Подсказка "сколько зарабатываем" — считается сразу при
                                          вводе цен, до сохранения, чтобы не продать в минус */}
                                      {(() => {
                                        const cost = parseFloat(editItemCostPrice.replace(',', '.'));
                                        const sale = parseFloat(editItemPrice.replace(',', '.'));
                                        const qty = parseInt(editItemQuantity, 10) || 0;
                                        if (!Number.isFinite(cost) || !Number.isFinite(sale) || cost <= 0) return null;
                                        const markupPercent = ((sale - cost) / cost) * 100;
                                        const profit = (sale - cost) * qty;
                                        const isLoss = sale < cost;
                                        return (
                                          <p className="text-xs mb-3" style={{ color: isLoss ? 'var(--bad)' : 'var(--ink-muted)' }}>
                                            {isLoss ? 'Продаж у мінус! ' : ''}
                                            Націнка: <b>{markupPercent.toFixed(1)}%</b> · Прибуток з позиції:{' '}
                                            <b>{formatMoney(profit)} грн</b>
                                          </p>
                                        );
                                      })()}

                                      {editItemError && (
                                        <p className="text-[11px] mb-2" style={{ color: 'var(--bad)' }}>
                                          {editItemError}
                                        </p>
                                      )}

                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          disabled={editItemSaving}
                                          onClick={handleSaveItem}
                                          className="px-5 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                                          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                                        >
                                          {editItemSaving ? 'Сохранение...' : 'Сохранить'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelItemEdit}
                                          className="px-4 py-2 rounded-md text-sm"
                                          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                        >
                                          Отмена
                                        </button>
                                        <span className="self-center text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                                          Enter — зберегти · Esc — скасувати
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                )}

                                {isReturning && (
                                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                                    <td colSpan={6} className="px-3 py-3">
                                      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Количество (из {item.quantity})
                                          </label>
                                          <input
                                            type="number"
                                            min={1}
                                            max={item.quantity}
                                            step={1}
                                            className="w-full px-3 py-2 text-sm rounded-md font-mono"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={returnQuantity}
                                            onChange={(e) => setReturnQuantity(e.target.value)}
                                            autoFocus
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Причина
                                          </label>
                                          <select
                                            className="w-full px-3 py-2 text-sm rounded-md"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={returnReason}
                                            onChange={(e) => setReturnReason(e.target.value as typeof returnReason)}
                                          >
                                            <option value="customer_mistake">Ошибся клиент</option>
                                            <option value="staff_mistake">Ошибся менеджер</option>
                                            <option value="refused">Отказ</option>
                                            <option value="defect">Брак (списывается, не на склад)</option>
                                          </select>
                                        </div>
                                        <div>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Возврат денег
                                          </label>
                                          <select
                                            className="w-full px-3 py-2 text-sm rounded-md"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={returnRefundMethod}
                                            onChange={(e) => setReturnRefundMethod(e.target.value as typeof returnRefundMethod)}
                                          >
                                            <option value="cash">Наличными</option>
                                            <option value="card">На карту</option>
                                            <option value="balance">На баланс клиента</option>
                                          </select>
                                        </div>
                                        {returnRefundMethod !== 'balance' && (
                                          <div>
                                            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                              Касса выдачи
                                            </label>
                                            <select
                                              className="w-full px-3 py-2 text-sm rounded-md"
                                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                              value={returnCashRegisterId}
                                              onChange={(e) => setReturnCashRegisterId(e.target.value)}
                                            >
                                              <option value="">Выберите кассу</option>
                                              {cashRegisters.map((r) => (
                                                <option key={r.id} value={r.id}>
                                                  {r.name} ({r.balance.toLocaleString('ru-RU')} ₴)
                                                </option>
                                              ))}
                                            </select>
                                          </div>
                                        )}
                                      </div>

                                      <input
                                        type="text"
                                        placeholder="Комментарий (необязательно)"
                                        className="w-full px-3 py-2 text-sm rounded-md mb-2.5"
                                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                        value={returnComment}
                                        onChange={(e) => setReturnComment(e.target.value)}
                                      />

                                      {returnError && (
                                        <p className="text-[11px] mb-2" style={{ color: 'var(--bad)' }}>
                                          {returnError}
                                        </p>
                                      )}

                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          disabled={returnSaving}
                                          onClick={handleSubmitReturn}
                                          className="px-4 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                                          style={{ background: 'var(--bad)', color: '#fff' }}
                                        >
                                          {returnSaving ? 'Оформление...' : 'Оформить возврат'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelItemReturn}
                                          className="px-3 py-1.5 rounded-md text-xs"
                                          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                        >
                                          Отмена
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}

                                {returnSuccessItemId === item.id && (
                                  <tr>
                                    <td colSpan={6} className="px-3 pt-1.5 text-[11px]" style={{ color: 'var(--good)' }}>
                                      Возврат оформлен.
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: 'var(--surface-2)' }}>
                            <td colSpan={3} className="px-3 py-2.5 text-sm font-semibold">
                              Итого
                            </td>
                            <td className="px-3 py-2.5 text-sm font-semibold font-mono text-right whitespace-nowrap">
                              {formatMoney(orderDetails.totalAmount)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ЗАКАЗА ==================== */}
                {/* Кто и когда что менял — новые события сверху. По умолчанию
                    видно последние 5, остальное — по кнопке "Показати все" */}
                <div className="mt-5">
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--ink-muted)' }}>
                    ІСТОРІЯ ЗМІН
                  </h3>
                  {history.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                      Змін ще не було (історія ведеться з моменту оновлення адмінки).
                    </p>
                  ) : (
                    <div className="rounded-md" style={{ border: '1px solid var(--line)' }}>
                      {(showAllHistory ? history : history.slice(0, 5)).map((event, index) => (
                        <div
                          key={event.id}
                          className="flex gap-3 px-3 py-2 text-xs"
                          style={{ borderTop: index === 0 ? 'none' : '1px solid var(--line)' }}
                        >
                          <span className="font-mono whitespace-nowrap shrink-0" style={{ color: 'var(--ink-faint)' }}>
                            {formatDateTime(event.createdAt)}
                          </span>
                          <span style={{ color: 'var(--ink)' }}>{event.message}</span>
                        </div>
                      ))}
                      {history.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setShowAllHistory((v) => !v)}
                          className="w-full text-xs py-1.5 underline"
                          style={{ borderTop: '1px solid var(--line)', color: 'var(--accent)' }}
                        >
                          {showAllHistory ? 'Згорнути' : `Показати все (${history.length})`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== МОДАЛКА "ПРИНЯТЬ ОПЛАТУ" ==================== */}
      {showPaymentModal && orderDetails && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setShowPaymentModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg p-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Принять оплату</h2>
              <button type="button" onClick={() => setShowPaymentModal(false)} className="text-sm" style={{ color: 'var(--ink-muted)' }}>
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                  Касса
                </label>
                <select
                  value={paymentCashRegisterId}
                  onChange={(e) => setPaymentCashRegisterId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                >
                  <option value="">Выберите кассу</option>
                  {cashRegisters.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.balance.toLocaleString('ru-RU')} ₴)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                  Сумма, грн
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                  Комментарий (необязательно)
                </label>
                <input
                  type="text"
                  value={paymentComment}
                  onChange={(e) => setPaymentComment(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                />
              </div>

              {paymentError && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  {paymentError}
                </p>
              )}

              <button
                type="button"
                disabled={paymentSaving}
                onClick={handleSubmitPayment}
                className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                {paymentSaving ? 'Проведение...' : 'Провести платёж'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
