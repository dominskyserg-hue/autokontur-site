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
}

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

type SaveKey = 'status' | 'ttn' | 'vehicle' | 'customer' | 'delivery';
type SaveState = { state: 'idle' | 'saving' | 'saved' | 'error'; error?: string };
const IDLE: SaveState = { state: 'idle' };

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
}: {
  orderId: string;
  onClose: () => void;
  onOrderChanged: () => void;
}) {
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // ---- автосохраняемые черновики полей ----
  const [statusDraft, setStatusDraft] = useState<OrderStatus>('new');
  const [ttnDraft, setTtnDraft] = useState('');
  const [vinDraft, setVinDraft] = useState('');
  const [carInfoDraft, setCarInfoDraft] = useState('');
  // Контакти клієнта — редагуються прямо в картці (особливо потрібно
  // для "Купити в 1 клік", де покупець вводить лише одне поле імені).
  // Саме ці дані йдуть отримувачем у ТТН Нової Пошти
  const [customerNameDraft, setCustomerNameDraft] = useState('');
  const [customerSurnameDraft, setCustomerSurnameDraft] = useState('');
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState('');
  // Зміна міста/відділення прямо в картці — пошук НП з Ref'ами, тож
  // обране відділення одразу підхоплюється формою створення ТТН
  const [editingDelivery, setEditingDelivery] = useState(false);
  const [saveState, setSaveState] = useState<Record<SaveKey, SaveState>>({ status: IDLE, ttn: IDLE, vehicle: IDLE, customer: IDLE, delivery: IDLE });

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

  // ---- модалка "Принять оплату" ----
  const [showPaymentModal, setShowPaymentModal] = useState(false);
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
    [orderId, onOrderChanged]
  );

  // ---- статус — сохраняется сразу при выборе, без отдельной кнопки ----
  const handleStatusChange = (next: OrderStatus) => {
    setStatusDraft(next);
    savePatch('status', { status: next });
  };

  // ---- ТТН вручную — сохраняется при потере фокуса, если изменилось ----
  const handleTtnBlur = () => {
    if (!orderDetails) return;
    const next = ttnDraft.trim();
    if (next === (orderDetails.ttnNumber || '')) return;
    savePatch('ttn', { ttnNumber: next || null });
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
      const nextItems = orderDetails.items.map((item) => (item.id === updatedItem.id ? updatedItem : item));
      const nextTotal = nextItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      setOrderDetails({ ...orderDetails, items: nextItems, totalAmount: nextTotal });
      setEditingItemId(null);
      onOrderChanged();
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
        <div
          className="flex items-start justify-between gap-4 px-6 py-4 shrink-0 flex-wrap"
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
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-2 py-1 rounded-md shrink-0"
              style={{ color: 'var(--ink-muted)' }}
              aria-label="Закрыть"
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
                        className="w-full px-2.5 py-1.5 text-sm rounded-md"
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
                        className="w-full px-2.5 py-1.5 text-sm rounded-md"
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
                      className="w-full px-2.5 py-1.5 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      value={customerPhoneDraft}
                      onChange={(e) => setCustomerPhoneDraft(e.target.value)}
                      onBlur={handleCustomerBlur}
                    />
                  </div>

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
                      <p className="text-sm font-mono">{orderDetails.ttnNumber}</p>
                    ) : (
                      <input
                        type="text"
                        className="w-full px-3 py-1.5 text-sm rounded-md font-mono"
                        style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                        placeholder="Ще не вказано"
                        value={ttnDraft}
                        onChange={(e) => setTtnDraft(e.target.value)}
                        onBlur={handleTtnBlur}
                      />
                    )}

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
                            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Вага, кг
                            </label>
                            <input
                              type="number"
                              min={0.1}
                              step="0.1"
                              className="w-full px-2 py-1.5 text-xs rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnWeight}
                              onChange={(e) => setTtnWeight(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Місць
                            </label>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              className="w-full px-2 py-1.5 text-xs rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnSeats}
                              onChange={(e) => setTtnSeats(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] mb-1" style={{ color: 'var(--ink-muted)' }}>
                              Оцінка, грн
                            </label>
                            <input
                              type="number"
                              min={1}
                              step="1"
                              className="w-full px-2 py-1.5 text-xs rounded-md font-mono"
                              style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                              value={ttnCost}
                              onChange={(e) => setTtnCost(e.target.value)}
                            />
                          </div>
                        </div>

                        <select
                          className="w-full px-2.5 py-1.5 text-xs rounded-md"
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
                          className="w-full px-2.5 py-1.5 text-xs rounded-md"
                          style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                          value={ttnDescription}
                          onChange={(e) => setTtnDescription(e.target.value)}
                        />

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

                {/* ---- автомобіль клієнта ---- */}
                <div className="p-4 rounded-md" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-muted)' }}>
                      АВТОМОБІЛЬ КЛІЄНТА
                    </h3>
                    <SaveIndicator save={saveState.vehicle} />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                      placeholder="напр. Volkswagen Golf 2015"
                      value={carInfoDraft}
                      onChange={(e) => setCarInfoDraft(e.target.value)}
                      onBlur={handleVehicleBlur}
                    />
                    <input
                      type="text"
                      className="w-28 shrink-0 px-3 py-1.5 text-sm rounded-md font-mono uppercase"
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
                  </div>
                </div>

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
                                    <p className="truncate max-w-[220px]">{item.name || 'Без названия'}</p>
                                    <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                                      {item.article}
                                      {item.brand ? ` · ${item.brand}` : ''}
                                      {item.supplierName ? ` · ${item.supplierName}` : ''}
                                      {item.supplierContactName ? ` (${item.supplierContactName})` : ''}
                                    </p>
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
                                    </div>
                                  </td>
                                </tr>

                                {isEditing && (
                                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                                    <td colSpan={6} className="px-3 py-3">
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-2.5">
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Кількість
                                          </label>
                                          <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md font-mono"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemQuantity}
                                            onChange={(e) => setEditItemQuantity(e.target.value)}
                                            autoFocus
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Ціна продажу
                                          </label>
                                          <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md font-mono"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemPrice}
                                            onChange={(e) => setEditItemPrice(e.target.value)}
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Ціна закупки
                                          </label>
                                          <input
                                            type="number"
                                            min={0}
                                            step="any"
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md font-mono"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemCostPrice}
                                            onChange={(e) => setEditItemCostPrice(e.target.value)}
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Поставщик
                                          </label>
                                          <select
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={editItemSupplierId}
                                            onChange={(e) => setEditItemSupplierId(e.target.value)}
                                          >
                                            <option value="">Выберите поставщика</option>
                                            {suppliers.map((s) => (
                                              <option key={s.id} value={s.id}>
                                                {s.name}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                      </div>

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
                                          className="px-4 py-1.5 rounded-md text-xs font-medium disabled:opacity-50"
                                          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                                        >
                                          {editItemSaving ? 'Сохранение...' : 'Сохранить'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={cancelItemEdit}
                                          className="px-3 py-1.5 rounded-md text-xs"
                                          style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                                        >
                                          Отмена
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}

                                {isReturning && (
                                  <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}>
                                    <td colSpan={6} className="px-3 py-3">
                                      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Количество (из {item.quantity})
                                          </label>
                                          <input
                                            type="number"
                                            min={1}
                                            max={item.quantity}
                                            step={1}
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md font-mono"
                                            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                                            value={returnQuantity}
                                            onChange={(e) => setReturnQuantity(e.target.value)}
                                            autoFocus
                                          />
                                        </div>
                                        <div>
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Причина
                                          </label>
                                          <select
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md"
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
                                          <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                            Возврат денег
                                          </label>
                                          <select
                                            className="w-full px-2.5 py-1.5 text-xs rounded-md"
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
                                            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                                              Касса выдачи
                                            </label>
                                            <select
                                              className="w-full px-2.5 py-1.5 text-xs rounded-md"
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
                                        className="w-full px-2.5 py-1.5 text-xs rounded-md mb-2.5"
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
