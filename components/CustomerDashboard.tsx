'use client';

// ============================================================
// Особистий кабінет покупця — "гараж і центр керування" автовласника:
// збережені авто, історія замовлень з відстеженням ТТН, обране й
// збережені адреси доставки. Сторінка живе за адресою /account (див.
// app/account/page.tsx), посилання на неї — в шапці вітрини
// (components/StorefrontHome.tsx).
//
// "Вхід" без пароля: покупець просто вводить номер телефону. Роут
// GET /api/customer/orders одночасно і "перевіряє вхід" — якщо
// замовлення з таким телефоном знайшлись, значить телефон "вірний" і
// показуємо кабінет; якщо ні — лишаємось на екрані входу з помилкою.
// У СПРАВЖНІЙ системі тут була б SMS-верифікація (код підтвердження) —
// в цьому проєкті це свідоме спрощення (детальний коментар про це і
// про те, що РЕАЛЬНО захищено — в app/api/customer/orders/route.ts).
// Та ж модель "телефон замінює пароль" діє і для гаража/обраного/адрес
// (app/api/customer/vehicles/route.ts та інші) — усюди належність
// перевіряється порівнянням останніх 9 цифр номера.
//
// Телефон, яким увійшли, зберігається в localStorage браузера (той
// самий прийом, що і для кошика, див. CART_STORAGE_KEY в
// components/StorefrontHome.tsx) — так покупець не вводить його
// заново при кожному відкритті сторінки. Той самий телефон паралельно
// пишеться і в cookie (lib/customerPhoneCookie.ts) — вона потрібна
// серверним сторінкам (категорії, марки авто) для персональної ціни.
//
// Стиль — темний Tech Premium (lib/techTheme.ts), той самий, що і на
// Головній та картці товару. Framer Motion — для перемикання вкладок
// (AnimatePresence) і появи карток гаража/обраного (motion.div).
//
// 'use client' в самому верху обов'язковий: компонент використовує
// хуки (useState/useEffect) і працює з браузерним fetch/localStorage
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Car, Package, Heart, Settings, Plus, Trash2, Copy, Check, Truck, Printer, RotateCcw, Star } from 'lucide-react';
import { CUSTOMER_PHONE_COOKIE } from '@/lib/customerPhoneCookie';
import { getCarMakeByName } from '@/lib/carMakes';
import GarageCard, { type GarageVehicle } from '@/components/GarageCard';
import {
  TECH_BG,
  TECH_SURFACE,
  TECH_SURFACE_2,
  TECH_BORDER,
  TECH_BORDER_2,
  TECH_ACCENT,
  TECH_ACCENT_BRIGHT,
  TECH_ACCENT_DIM,
  TECH_INK,
  TECH_MUTED,
  TECH_FAINT,
  TECH_GOOD,
  TECH_GOOD_SOFT,
  TECH_HEAT,
  TECH_HEAT_SOFT,
  TECH_GLOW,
  TECH_DISPLAY_FONT,
  TECH_BODY_FONT,
  TECH_MONO_FONT,
} from '@/lib/techTheme';

// ------------------------------------------------------------
// ТИПИ — повторюють те, що віддає бекенд
// ------------------------------------------------------------
type OrderStatus = 'new' | 'processing' | 'awaiting_parts' | 'ready' | 'cancelled';

interface OrderListItem {
  id: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  createdAt: string;
}

interface OrderItem {
  id: string;
  productId: string | null;
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
}

interface OrderDetails {
  id: string;
  status: OrderStatus;
  city: string;
  novaPoshtaAddress: string;
  comment: string | null;
  ttnNumber: string | null;
  createdAt: string;
  items: OrderItem[];
  totalAmount: number;
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  engine: string | null;
  vin: string | null;
  isActive: boolean;
  createdAt: string;
}

interface FavoriteItem {
  favoriteId: string;
  productId: string;
  article: string;
  brand: string | null;
  name: string | null;
  imageUrl: string | null;
  retailPrice: number;
  stock: number;
}

interface CustomerAddress {
  id: string;
  recipientName: string;
  recipientPhone: string | null;
  city: string;
  warehouse: string;
  isDefault: boolean;
}

interface PricingRule {
  ruleType: 'discount' | 'markup';
  percent: number;
}

// Кошик витрини — той самий формат, що і CART_STORAGE_KEY в
// components/StorefrontHome.tsx та components/AddToCartButton.tsx
interface CartItem {
  id: string;
  article: string;
  brand: string | null;
  name: string;
  price: number;
  quantity: number;
  stock: number;
}

const PHONE_STORAGE_KEY = 'autokontur-customer-phone';
const CART_STORAGE_KEY = 'autokontur-cart';

function setCustomerPhoneCookie(phone: string) {
  document.cookie = `${CUSTOMER_PHONE_COOKIE}=${encodeURIComponent(phone)}; path=/; max-age=31536000`;
}

function clearCustomerPhoneCookie() {
  document.cookie = `${CUSTOMER_PHONE_COOKIE}=; path=/; max-age=0`;
}

const STATUS_META: Record<OrderStatus, { label: string; bg: string; fg: string }> = {
  new: { label: 'Новий', bg: 'rgba(255,255,255,0.06)', fg: TECH_MUTED },
  processing: { label: 'В обробці', bg: TECH_HEAT_SOFT, fg: TECH_HEAT },
  awaiting_parts: { label: 'Очікує запчастини', bg: 'rgba(59,130,246,0.14)', fg: TECH_ACCENT_BRIGHT },
  ready: { label: 'Готовий до видачі', bg: TECH_GOOD_SOFT, fg: TECH_GOOD },
  cancelled: { label: 'Скасовано', bg: 'rgba(239,68,68,0.14)', fg: '#FCA5A5' },
};

const IN_PROGRESS_STATUSES: OrderStatus[] = ['new', 'processing', 'awaiting_parts'];

function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function shortId(id: string): string {
  return `№${id.slice(0, 8)}`;
}

// ------------------------------------------------------------
// МАСКА НОМЕРА ТЕЛЕФОНУ: покупець друкує лише цифри, а поле саме
// розкладає їх у вигляд "+380 XX XXX XX XX"
// ------------------------------------------------------------
function formatPhoneMask(rawValue: string): string {
  const allDigits = rawValue.replace(/\D/g, '');
  let national = allDigits.startsWith('380') ? allDigits.slice(3) : allDigits;
  if (national.startsWith('0')) national = national.slice(1);
  national = national.slice(0, 9);

  if (national.length === 0) return '+380';

  const part1 = national.slice(0, 2);
  const part2 = national.slice(2, 5);
  const part3 = national.slice(5, 7);
  const part4 = national.slice(7, 9);

  let result = '+380';
  if (part1) result += ` ${part1}`;
  if (part2) result += ` ${part2}`;
  if (part3) result += ` ${part3}`;
  if (part4) result += ` ${part4}`;
  return result;
}

function isCompletePhone(masked: string): boolean {
  return masked.replace(/\D/g, '').length === 12;
}

// Куди веде кнопка "Знайти запчастини для цього авто": для курованих
// марок (є власна SEO-сторінка /marky/[slug], lib/carMakes.ts) —
// одразу туди; для решти — вільний текстовий пошук на Головній тим
// самим механізмом, що і перехід із SEO-сторінок категорій
// (?article=..., див. components/StorefrontHome.tsx)
function findPartsHref(vehicle: Vehicle): string {
  const curated = getCarMakeByName(vehicle.make);
  if (curated) return `/marky/${curated.slug}`;
  const query = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  return `/?article=${encodeURIComponent(query)}`;
}

// ------------------------------------------------------------
// "Завантажити чек" — друкована HTML-сторінка у новій вкладці, яку
// покупець може зберегти як PDF через діалог друку браузера. Ніяка
// бібліотека генерації PDF на сайті не підключена — це навмисно
// найпростіший робочий варіант без нової залежності
// ------------------------------------------------------------
function openReceipt(order: OrderDetails, phone: string) {
  const win = window.open('', '_blank');
  if (!win) return;

  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td>${item.name || item.article}${item.brand ? ` · ${item.brand}` : ''}</td>
          <td style="text-align:center">${item.quantity}</td>
          <td style="text-align:right">${formatMoney(item.price)} грн</td>
          <td style="text-align:right">${formatMoney(item.price * item.quantity)} грн</td>
        </tr>`
    )
    .join('');

  win.document.write(`
    <!doctype html>
    <html lang="uk">
      <head>
        <meta charset="utf-8" />
        <title>Чек ${shortId(order.id)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; padding: 24px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          p { font-size: 13px; color: #444; margin: 2px 0; }
          table { width: 100%; margin-top: 16px; border-collapse: collapse; font-size: 13px; }
          th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
          tfoot td { font-weight: bold; border-top: 2px solid #111; border-bottom: none; }
        </style>
      </head>
      <body>
        <h1>DominatorParts — чек замовлення ${shortId(order.id)}</h1>
        <p>Дата: ${formatDate(order.createdAt)}</p>
        <p>Телефон: ${phone}</p>
        <p>Доставка: ${order.city}, ${order.novaPoshtaAddress}</p>
        <table>
          <thead><tr><th>Товар</th><th style="text-align:center">К-сть</th><th style="text-align:right">Ціна</th><th style="text-align:right">Сума</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3">Разом</td><td style="text-align:right">${formatMoney(order.totalAmount)} грн</td></tr></tfoot>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

type TabKey = 'garage' | 'orders' | 'favorites' | 'settings';

const TABS: { key: TabKey; label: string; icon: typeof Car }[] = [
  { key: 'garage', label: 'Мій Гараж', icon: Car },
  { key: 'orders', label: 'Історія замовлень', icon: Package },
  { key: 'favorites', label: 'Обране', icon: Heart },
  { key: 'settings', label: 'Налаштування', icon: Settings },
];

export default function CustomerDashboard() {
  const router = useRouter();

  // ---- вхід ----
  const [phoneInput, setPhoneInput] = useState('+380');
  const [loggedInPhone, setLoggedInPhone] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);

  // ---- активна вкладка ----
  const [activeTab, setActiveTab] = useState<TabKey>('garage');
  const [loadedTabs, setLoadedTabs] = useState<Set<TabKey>>(new Set());

  // ---- персональна знижка/наценка (бейдж у профілі) ----
  const [pricingRule, setPricingRule] = useState<PricingRule | null>(null);

  // ---- замовлення ----
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<string, OrderDetails>>({});
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [copiedTtnId, setCopiedTtnId] = useState<string | null>(null);

  // ---- гараж ----
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({ make: '', model: '', year: '', engine: '', vin: '' });
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleFormError, setVehicleFormError] = useState<string | null>(null);
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);

  // ---- обране ----
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
  const [busyFavoriteId, setBusyFavoriteId] = useState<string | null>(null);

  // ---- адреси доставки ----
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [addressesError, setAddressesError] = useState<string | null>(null);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [addressForm, setAddressForm] = useState({ recipientName: '', recipientPhone: '', city: '', warehouse: '' });
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressFormError, setAddressFormError] = useState<string | null>(null);
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);

  // Відновлення "сесії" зі localStorage при відкритті сторінки
  useEffect(() => {
    try {
      const savedPhone = window.localStorage.getItem(PHONE_STORAGE_KEY);
      if (savedPhone) {
        setCustomerPhoneCookie(savedPhone);
        setLoggedInPhone(savedPhone);
      }
    } catch {
      // localStorage недоступний — лишаємось на екрані входу
    } finally {
      setRestoringSession(false);
    }
  }, []);

  const fetchOrders = useCallback(async (phone: string) => {
    setLoadingOrders(true);
    setOrdersError(null);
    try {
      const response = await fetch(`/api/customer/orders?${new URLSearchParams({ phone }).toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося отримати замовлення');
      }
      setOrders(data.orders as OrderListItem[]);
    } catch (error) {
      setOrdersError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження замовлень');
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const fetchPricingRule = useCallback(async (phone: string) => {
    try {
      const response = await fetch(`/api/customer/pricing-rule?${new URLSearchParams({ phone }).toString()}`);
      const data = await response.json();
      if (data.success) setPricingRule(data.rule as PricingRule | null);
    } catch {
      // Бейдж просто не покажеться — не критично
    }
  }, []);

  // Як тільки дізнались телефон — одразу підвантажуємо замовлення й
  // бейдж персональної знижки/наценки (потрібні відразу, на відміну
  // від решти вкладок, що підвантажуються ліниво при відкритті)
  useEffect(() => {
    if (!loggedInPhone) return;
    fetchOrders(loggedInPhone);
    fetchPricingRule(loggedInPhone);
  }, [loggedInPhone, fetchOrders, fetchPricingRule]);

  // ---- ліниве підвантаження даних вкладки при першому відкритті ----
  const fetchVehicles = useCallback(async (phone: string) => {
    setLoadingVehicles(true);
    setVehiclesError(null);
    try {
      const response = await fetch(`/api/customer/vehicles?${new URLSearchParams({ phone }).toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося отримати гараж');
      setVehicles(data.vehicles as Vehicle[]);
    } catch (error) {
      setVehiclesError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження гаража');
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  const fetchFavorites = useCallback(async (phone: string) => {
    setLoadingFavorites(true);
    setFavoritesError(null);
    try {
      const response = await fetch(`/api/customer/favorites?${new URLSearchParams({ phone }).toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося отримати обране');
      setFavorites(data.favorites as FavoriteItem[]);
    } catch (error) {
      setFavoritesError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження обраного');
    } finally {
      setLoadingFavorites(false);
    }
  }, []);

  const fetchAddresses = useCallback(async (phone: string) => {
    setLoadingAddresses(true);
    setAddressesError(null);
    try {
      const response = await fetch(`/api/customer/addresses?${new URLSearchParams({ phone }).toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося отримати адреси');
      setAddresses(data.addresses as CustomerAddress[]);
    } catch (error) {
      setAddressesError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження адрес');
    } finally {
      setLoadingAddresses(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedInPhone || loadedTabs.has(activeTab)) return;

    if (activeTab === 'garage') fetchVehicles(loggedInPhone);
    if (activeTab === 'favorites') fetchFavorites(loggedInPhone);
    if (activeTab === 'settings') fetchAddresses(loggedInPhone);

    if (activeTab !== 'orders') {
      setLoadedTabs((prev) => new Set(prev).add(activeTab));
    }
  }, [activeTab, loggedInPhone, loadedTabs, fetchVehicles, fetchFavorites, fetchAddresses]);

  // ВХІД
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCompletePhone(phoneInput)) {
      setLoginError('Введіть повний номер телефону');
      return;
    }

    setLoggingIn(true);
    setLoginError(null);
    try {
      const response = await fetch(`/api/customer/orders?${new URLSearchParams({ phone: phoneInput }).toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Замовлень з таким номером не знайдено');
      }

      window.localStorage.setItem(PHONE_STORAGE_KEY, phoneInput);
      setCustomerPhoneCookie(phoneInput);
      setOrders(data.orders as OrderListItem[]);
      setLoggedInPhone(phoneInput);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Помилка мережі під час входу');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    window.localStorage.removeItem(PHONE_STORAGE_KEY);
    clearCustomerPhoneCookie();
    setLoggedInPhone(null);
    setOrders([]);
    setExpandedOrderId(null);
    setOrderDetails({});
    setPhoneInput('+380');
    setActiveTab('garage');
    setLoadedTabs(new Set());
    setVehicles([]);
    setFavorites([]);
    setAddresses([]);
    setPricingRule(null);
  };

  const toggleOrder = async (orderId: string) => {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }

    setExpandedOrderId(orderId);
    setDetailsError(null);

    if (orderDetails[orderId] || !loggedInPhone) return;

    setLoadingDetailsId(orderId);
    try {
      const response = await fetch(
        `/api/customer/orders/${orderId}?${new URLSearchParams({ phone: loggedInPhone }).toString()}`
      );
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося отримати деталі замовлення');
      setOrderDetails((prev) => ({ ...prev, [orderId]: data.order as OrderDetails }));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження деталей');
    } finally {
      setLoadingDetailsId(null);
    }
  };

  const handleCopyTtn = (ttn: string, orderId: string) => {
    navigator.clipboard?.writeText(ttn).then(() => {
      setCopiedTtnId(orderId);
      setTimeout(() => setCopiedTtnId(null), 1500);
    });
  };

  const handleRepeatOrder = (order: OrderDetails) => {
    const repeatable = order.items.filter((item) => item.productId);
    if (repeatable.length === 0) return;

    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      const cart: CartItem[] = raw ? JSON.parse(raw) : [];

      for (const item of repeatable) {
        const existing = cart.find((cartItem) => cartItem.id === item.productId);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          cart.push({
            id: item.productId as string,
            article: item.article,
            brand: item.brand,
            name: item.name || item.article,
            price: item.price,
            quantity: item.quantity,
            stock: 9999,
          });
        }
      }

      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      router.push('/');
    } catch {
      // localStorage недоступний — кнопка просто нічого не зробить
    }
  };

  const handleDownloadReceipt = (order: OrderDetails) => {
    if (!loggedInPhone) return;
    openReceipt(order, loggedInPhone);
  };

  // ---- гараж: додавання/активація/видалення ----
  const handleAddVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loggedInPhone) return;

    if (!vehicleForm.make.trim() || !vehicleForm.model.trim()) {
      setVehicleFormError('Вкажіть марку і модель авто');
      return;
    }

    setSavingVehicle(true);
    setVehicleFormError(null);
    try {
      const response = await fetch('/api/customer/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loggedInPhone, ...vehicleForm }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося додати авто');

      await fetchVehicles(loggedInPhone);
      setVehicleForm({ make: '', model: '', year: '', engine: '', vin: '' });
      setVehicleFormOpen(false);
    } catch (error) {
      setVehicleFormError(error instanceof Error ? error.message : 'Помилка мережі під час збереження авто');
    } finally {
      setSavingVehicle(false);
    }
  };

  const handleSetActiveVehicle = async (id: string) => {
    if (!loggedInPhone) return;
    setBusyVehicleId(id);
    try {
      const response = await fetch(`/api/customer/vehicles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loggedInPhone, isActive: true }),
      });
      if (response.ok) await fetchVehicles(loggedInPhone);
    } finally {
      setBusyVehicleId(null);
    }
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!loggedInPhone) return;
    if (!window.confirm('Видалити це авто з гаража?')) return;

    setBusyVehicleId(id);
    try {
      const response = await fetch(
        `/api/customer/vehicles/${id}?${new URLSearchParams({ phone: loggedInPhone }).toString()}`,
        { method: 'DELETE' }
      );
      if (response.ok) await fetchVehicles(loggedInPhone);
    } finally {
      setBusyVehicleId(null);
    }
  };

  // ---- обране: видалення ----
  const handleRemoveFavorite = async (productId: string) => {
    if (!loggedInPhone) return;
    setBusyFavoriteId(productId);
    try {
      const response = await fetch(
        `/api/customer/favorites/${productId}?${new URLSearchParams({ phone: loggedInPhone }).toString()}`,
        { method: 'DELETE' }
      );
      if (response.ok) setFavorites((prev) => prev.filter((item) => item.productId !== productId));
    } finally {
      setBusyFavoriteId(null);
    }
  };

  // ---- адреси: додавання/за замовчуванням/видалення ----
  const handleAddAddress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!loggedInPhone) return;

    if (!addressForm.recipientName.trim() || !addressForm.city.trim() || !addressForm.warehouse.trim()) {
      setAddressFormError("Вкажіть ім'я отримувача, місто і відділення");
      return;
    }

    setSavingAddress(true);
    setAddressFormError(null);
    try {
      const response = await fetch('/api/customer/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loggedInPhone, ...addressForm }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Не вдалося зберегти адресу');

      await fetchAddresses(loggedInPhone);
      setAddressForm({ recipientName: '', recipientPhone: '', city: '', warehouse: '' });
      setAddressFormOpen(false);
    } catch (error) {
      setAddressFormError(error instanceof Error ? error.message : 'Помилка мережі під час збереження адреси');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleSetDefaultAddress = async (id: string) => {
    if (!loggedInPhone) return;
    setBusyAddressId(id);
    try {
      const response = await fetch(`/api/customer/addresses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loggedInPhone, isDefault: true }),
      });
      if (response.ok) await fetchAddresses(loggedInPhone);
    } finally {
      setBusyAddressId(null);
    }
  };

  const handleDeleteAddress = async (id: string) => {
    if (!loggedInPhone) return;
    if (!window.confirm('Видалити цю адресу?')) return;

    setBusyAddressId(id);
    try {
      const response = await fetch(
        `/api/customer/addresses/${id}?${new URLSearchParams({ phone: loggedInPhone }).toString()}`,
        { method: 'DELETE' }
      );
      if (response.ok) await fetchAddresses(loggedInPhone);
    } finally {
      setBusyAddressId(null);
    }
  };

  if (restoringSession) {
    return <div className="min-h-screen" style={{ background: TECH_BG }} />;
  }

  // ==================== ЕКРАН ВХОДУ ====================
  if (!loggedInPhone) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-5" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
        <div className="w-full max-w-sm">
          <Link href="/" className="text-xs font-medium transition-colors hover:text-white" style={{ color: TECH_MUTED }}>
            ← На головну
          </Link>
        </div>
        <div
          className="w-full max-w-sm rounded-2xl p-7"
          style={{ background: TECH_SURFACE, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${TECH_BORDER_2}` }}
        >
          <div
            className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold"
            style={{ background: `linear-gradient(135deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
          >
            <Car className="h-5 w-5" />
          </div>
          <h1 className="mb-1.5 text-xl font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
            Особистий кабінет
          </h1>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: TECH_MUTED }}>
            Введіть номер телефону, який вказували при оформленні замовлення — покажемо гараж, історію
            покупок і обране.
          </p>

          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <div>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(formatPhoneMask(e.target.value))}
                placeholder="+380 XX XXX XX XX"
                className="w-full rounded-xl px-4 py-3 text-base tracking-wide outline-none transition-colors focus:border-[rgba(59,130,246,0.5)]"
                style={{
                  fontFamily: TECH_MONO_FONT,
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${loginError ? 'rgba(239,68,68,0.55)' : TECH_BORDER_2}`,
                  color: TECH_INK,
                }}
                autoFocus
              />
              {loginError && (
                <p className="mt-1.5 text-xs" style={{ color: '#FCA5A5' }}>
                  {loginError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loggingIn || !isCompletePhone(phoneInput)}
              className="w-full rounded-xl py-3 text-sm font-semibold transition-shadow hover:shadow-glow-lg disabled:opacity-50 disabled:shadow-none"
              style={{ fontFamily: TECH_BODY_FONT, background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
            >
              {loggingIn ? 'Перевіряємо...' : 'Увійти'}
            </button>
          </form>

          <p className="mt-5 text-xs" style={{ color: TECH_FAINT }}>
            Підтвердження кодом із СМС тут не потрібне — це спрощена демо-версія входу.
          </p>
        </div>
      </div>
    );
  }

  // ==================== КАБІНЕТ ====================
  const inProgressCount = orders.filter((order) => IN_PROGRESS_STATUSES.includes(order.status)).length;
  const initials = loggedInPhone.replace(/\D/g, '').slice(-2);

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <header className="backdrop-blur-xl" style={{ background: 'rgba(11,15,23,0.82)', borderBottom: `1px solid ${TECH_BORDER}` }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
          <p className="text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
            Особистий кабінет
          </p>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ background: 'rgba(255,255,255,0.05)', color: TECH_MUTED }}
            >
              ← До пошуку
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
              style={{ background: 'rgba(255,255,255,0.05)', color: TECH_MUTED }}
            >
              Вийти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <div className="grid gap-6 md:grid-cols-[15rem_1fr]">
          {/* ==================== БІЧНЕ МЕНЮ (md+) ==================== */}
          <aside className="hidden md:block">
            <div className="sticky top-24 flex flex-col gap-5">
              {/* ---- профіль ---- */}
              <div className="rounded-2xl p-5" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-sm font-bold"
                    style={{ background: `linear-gradient(135deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', fontFamily: TECH_MONO_FONT }}
                  >
                    {initials}
                  </div>
                  <p className="truncate text-sm font-medium" style={{ fontFamily: TECH_MONO_FONT, color: '#fff' }}>
                    {loggedInPhone}
                  </p>
                </div>
                {pricingRule && (
                  <div
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                    style={{
                      background: pricingRule.ruleType === 'discount' ? TECH_GOOD_SOFT : TECH_HEAT_SOFT,
                      color: pricingRule.ruleType === 'discount' ? TECH_GOOD : TECH_HEAT,
                    }}
                  >
                    <Star className="h-3 w-3" fill="currentColor" />
                    {pricingRule.ruleType === 'discount' ? `Знижка −${pricingRule.percent}%` : `Націнка +${pricingRule.percent}%`}
                  </div>
                )}
              </div>

              {/* ---- навігація ---- */}
              <nav className="flex flex-col gap-1">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className="relative flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors"
                      style={{ color: isActive ? '#fff' : TECH_MUTED }}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="dashboard-nav-thumb"
                          className="absolute inset-0 -z-10 rounded-xl"
                          style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.3)' }}
                          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                        />
                      )}
                      <Icon className="h-4 w-4" style={{ color: isActive ? TECH_ACCENT_BRIGHT : TECH_FAINT }} />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          {/* ==================== МОБІЛЬНІ ВКЛАДКИ ==================== */}
          <nav className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 md:hidden">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className="relative flex flex-none items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-medium transition-colors"
                  style={{ color: isActive ? '#fff' : TECH_MUTED }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="dashboard-nav-thumb-mobile"
                      className="absolute inset-0 -z-10 rounded-xl"
                      style={{ background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.3)' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <Icon className="h-3.5 w-3.5" style={{ color: isActive ? TECH_ACCENT_BRIGHT : TECH_FAINT }} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* ==================== ВМІСТ ВКЛАДКИ ==================== */}
          <div className="min-w-0 md:col-start-2 md:row-start-1">
            <AnimatePresence mode="wait">
              {activeTab === 'garage' && (
                <motion.div key="garage" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                      Мій Гараж
                    </h2>
                    <button
                      type="button"
                      onClick={() => setVehicleFormOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-shadow hover:shadow-glow"
                      style={{ background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff' }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Додати авто
                    </button>
                  </div>

                  {vehicleFormOpen && (
                    <form
                      onSubmit={handleAddVehicle}
                      className="mb-5 grid grid-cols-2 gap-3 rounded-2xl p-5 sm:grid-cols-3"
                      style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                    >
                      <input
                        placeholder="Марка *"
                        value={vehicleForm.make}
                        onChange={(e) => setVehicleForm({ ...vehicleForm, make: e.target.value })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Модель *"
                        value={vehicleForm.model}
                        onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Рік"
                        inputMode="numeric"
                        value={vehicleForm.year}
                        onChange={(e) => setVehicleForm({ ...vehicleForm, year: e.target.value.replace(/\D/g, '') })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Двигун (напр. 1.6 TDI)"
                        value={vehicleForm.engine}
                        onChange={(e) => setVehicleForm({ ...vehicleForm, engine: e.target.value })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="VIN (необов'язково)"
                        value={vehicleForm.vin}
                        onChange={(e) => setVehicleForm({ ...vehicleForm, vin: e.target.value.toUpperCase() })}
                        className="rounded-lg px-3 py-2 text-sm font-mono outline-none sm:col-span-2"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />

                      {vehicleFormError && (
                        <p className="col-span-2 text-xs sm:col-span-3" style={{ color: '#FCA5A5' }}>
                          {vehicleFormError}
                        </p>
                      )}

                      <div className="col-span-2 flex gap-2 sm:col-span-3">
                        <button
                          type="submit"
                          disabled={savingVehicle}
                          className="rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                          style={{ background: TECH_ACCENT, color: '#fff' }}
                        >
                          {savingVehicle ? 'Зберігаємо...' : 'Зберегти авто'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setVehicleFormOpen(false)}
                          className="rounded-lg px-4 py-2 text-xs font-medium"
                          style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
                        >
                          Скасувати
                        </button>
                      </div>
                    </form>
                  )}

                  {vehiclesError && (
                    <p className="mb-3 rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}>
                      {vehiclesError}
                    </p>
                  )}

                  {loadingVehicles && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Завантаження...
                    </p>
                  )}

                  {!loadingVehicles && vehicles.length === 0 && !vehiclesError && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      У гаражі поки немає жодного авто. Додайте своє, щоб швидко знаходити запчастини саме
                      для нього.
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <AnimatePresence>
                      {vehicles.map((vehicle) => (
                        <GarageCard
                          key={vehicle.id}
                          vehicle={vehicle as GarageVehicle}
                          findPartsHref={findPartsHref(vehicle)}
                          settingActive={busyVehicleId === vehicle.id}
                          deleting={busyVehicleId === vehicle.id}
                          onSetActive={handleSetActiveVehicle}
                          onDelete={handleDeleteVehicle}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {activeTab === 'orders' && (
                <motion.div key="orders" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  <div className="mb-6 grid grid-cols-2 gap-4">
                    <div className="rounded-2xl p-5" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                      <p style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 26, color: '#fff' }}>{orders.length}</p>
                      <p className="mt-1 text-xs" style={{ color: TECH_FAINT }}>
                        Всього замовлень
                      </p>
                    </div>
                    <div className="rounded-2xl p-5" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                      <p style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, fontSize: 26, color: inProgressCount > 0 ? TECH_HEAT : '#fff' }}>
                        {inProgressCount}
                      </p>
                      <p className="mt-1 text-xs" style={{ color: TECH_FAINT }}>
                        В роботі
                      </p>
                    </div>
                  </div>

                  <h2 className="mb-3 text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                    Історія замовлень
                  </h2>

                  {loadingOrders && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Завантаження...
                    </p>
                  )}

                  {ordersError && (
                    <p className="rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}>
                      {ordersError}
                    </p>
                  )}

                  {!loadingOrders && !ordersError && orders.length === 0 && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Замовлень поки немає.
                    </p>
                  )}

                  <div className="flex flex-col gap-3">
                    {orders.map((order) => {
                      const isExpanded = expandedOrderId === order.id;
                      const details = orderDetails[order.id];
                      const statusMeta = STATUS_META[order.status];
                      const canRepeat = details ? details.items.some((item) => item.productId) : false;

                      return (
                        <div key={order.id} className="overflow-hidden rounded-2xl" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                          <button
                            type="button"
                            onClick={() => toggleOrder(order.id)}
                            className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="text-sm" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                                {shortId(order.id)}
                              </span>
                              <span className="whitespace-nowrap text-sm" style={{ color: TECH_MUTED }}>
                                {formatDate(order.createdAt)}
                              </span>
                              <span className="hidden text-sm sm:inline" style={{ color: TECH_MUTED }}>
                                {order.itemsCount} {order.itemsCount === 1 ? 'товар' : 'товарів'}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                              <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: statusMeta.bg, color: statusMeta.fg }}>
                                {statusMeta.label}
                              </span>
                              <span className="whitespace-nowrap text-sm font-semibold" style={{ color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                                {formatMoney(order.totalAmount)} грн
                              </span>
                              <span style={{ color: TECH_FAINT, transform: isExpanded ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>
                                ▾
                              </span>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="px-5 pb-5" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
                              {loadingDetailsId === order.id && (
                                <p className="pt-4 text-xs" style={{ color: TECH_FAINT }}>
                                  Завантаження складу замовлення...
                                </p>
                              )}

                              {detailsError && loadingDetailsId !== order.id && !details && (
                                <p className="pt-4 text-xs" style={{ color: '#FCA5A5' }}>
                                  {detailsError}
                                </p>
                              )}

                              {details && (
                                <div className="pt-4">
                                  <div className="mb-4 flex flex-col gap-2 text-xs" style={{ color: TECH_MUTED }}>
                                    <p>
                                      Доставка: {details.city}, {details.novaPoshtaAddress}
                                    </p>
                                    {details.comment && <p>Коментар: {details.comment}</p>}

                                    {details.ttnNumber && (
                                      <div
                                        className="mt-1 flex flex-wrap items-center gap-2 rounded-lg p-2.5"
                                        style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}
                                      >
                                        <Truck className="h-3.5 w-3.5" style={{ color: TECH_ACCENT_BRIGHT }} />
                                        <span style={{ fontFamily: TECH_MONO_FONT, color: TECH_INK }}>{details.ttnNumber}</span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyTtn(details.ttnNumber as string, order.id)}
                                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                                          style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
                                        >
                                          {copiedTtnId === order.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                          {copiedTtnId === order.id ? 'Скопійовано' : 'Копіювати'}
                                        </button>
                                        <a
                                          href={`https://novaposhta.ua/tracking/?cargo_number=${encodeURIComponent(details.ttnNumber)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
                                          style={{ background: TECH_ACCENT, color: '#fff' }}
                                        >
                                          Відстежити
                                        </a>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex flex-col gap-2">
                                    {details.items.map((item) => (
                                      <div key={item.id} className="flex items-center justify-between gap-3 py-2" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
                                        <div className="min-w-0">
                                          <p className="text-sm" style={{ color: TECH_INK }}>
                                            {item.name || 'Без назви'}
                                          </p>
                                          <p className="mt-0.5 text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_ACCENT_BRIGHT }}>
                                            {item.article}
                                            {item.brand ? ` · ${item.brand}` : ''}
                                          </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <p className="text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                                            {item.quantity} × {formatMoney(item.price)} грн
                                          </p>
                                          <p className="text-sm font-semibold" style={{ fontFamily: TECH_MONO_FONT, color: '#fff' }}>
                                            {formatMoney(item.price * item.quantity)} грн
                                          </p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>

                                  <div className="mt-4 flex flex-wrap gap-2 pt-4" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
                                    <button
                                      type="button"
                                      disabled={!canRepeat}
                                      onClick={() => handleRepeatOrder(details)}
                                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-shadow hover:shadow-glow disabled:opacity-40"
                                      style={{ background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff' }}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      Повторити замовлення
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadReceipt(details)}
                                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
                                      style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
                                    >
                                      <Printer className="h-3.5 w-3.5" />
                                      Завантажити чек
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {activeTab === 'favorites' && (
                <motion.div key="favorites" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  <h2 className="mb-4 text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                    Обране
                  </h2>

                  {favoritesError && (
                    <p className="mb-3 rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}>
                      {favoritesError}
                    </p>
                  )}

                  {loadingFavorites && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Завантаження...
                    </p>
                  )}

                  {!loadingFavorites && favorites.length === 0 && !favoritesError && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Ви ще не додали жодного товару в обране — натисніть на сердечко на сторінці товару.
                    </p>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {favorites.map((item) => (
                      <div key={item.favoriteId} className="rounded-2xl p-4" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                        <div className="flex gap-3">
                          <Link href={`/p/${item.productId}`} className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.imageUrl} alt={item.name || item.article} className="h-full w-full object-contain" />
                            ) : (
                              <Package className="h-6 w-6" style={{ color: TECH_FAINT }} />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link href={`/p/${item.productId}`} className="truncate text-sm font-medium transition-colors hover:text-white" style={{ color: TECH_INK }}>
                              {item.name || item.article}
                            </Link>
                            <p className="mt-0.5 text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_ACCENT_BRIGHT }}>
                              {item.article}
                              {item.brand ? ` · ${item.brand}` : ''}
                            </p>
                            <p className="mt-1.5 text-sm font-semibold" style={{ color: '#fff' }}>
                              {formatMoney(item.retailPrice)} грн
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs" style={{ color: item.stock > 0 ? TECH_GOOD : TECH_HEAT }}>
                            {item.stock > 0 ? `В наявності: ${item.stock}` : 'Під замовлення'}
                          </span>
                          <button
                            type="button"
                            disabled={busyFavoriteId === item.productId}
                            onClick={() => handleRemoveFavorite(item.productId)}
                            className="rounded-md p-1.5 transition-colors hover:bg-white/5 disabled:opacity-50"
                            style={{ color: TECH_FAINT }}
                            aria-label="Прибрати з обраного"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {activeTab === 'settings' && (
                <motion.div key="settings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                  <h2 className="mb-4 text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                    Налаштування профілю & Доставка
                  </h2>

                  <div className="mb-6 rounded-2xl p-5" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                    <p className="text-xs" style={{ color: TECH_FAINT }}>
                      Номер телефону
                    </p>
                    <p className="mt-1 text-sm" style={{ fontFamily: TECH_MONO_FONT, color: '#fff' }}>
                      {loggedInPhone}
                    </p>
                  </div>

                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold" style={{ color: '#fff' }}>
                      Збережені адреси Нової Пошти
                    </h3>
                    <button
                      type="button"
                      onClick={() => setAddressFormOpen((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-shadow hover:shadow-glow"
                      style={{ background: `linear-gradient(90deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff' }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Додати адресу
                    </button>
                  </div>

                  {addressFormOpen && (
                    <form
                      onSubmit={handleAddAddress}
                      className="mb-5 grid grid-cols-2 gap-3 rounded-2xl p-5"
                      style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
                    >
                      <input
                        placeholder="Ім'я та прізвище отримувача *"
                        value={addressForm.recipientName}
                        onChange={(e) => setAddressForm({ ...addressForm, recipientName: e.target.value })}
                        className="col-span-2 rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Телефон отримувача"
                        value={addressForm.recipientPhone}
                        onChange={(e) => setAddressForm({ ...addressForm, recipientPhone: e.target.value })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Місто *"
                        value={addressForm.city}
                        onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                        className="rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />
                      <input
                        placeholder="Відділення/адреса Нової Пошти *"
                        value={addressForm.warehouse}
                        onChange={(e) => setAddressForm({ ...addressForm, warehouse: e.target.value })}
                        className="col-span-2 rounded-lg px-3 py-2 text-sm outline-none"
                        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${TECH_BORDER_2}`, color: TECH_INK }}
                      />

                      {addressFormError && (
                        <p className="col-span-2 text-xs" style={{ color: '#FCA5A5' }}>
                          {addressFormError}
                        </p>
                      )}

                      <div className="col-span-2 flex gap-2">
                        <button
                          type="submit"
                          disabled={savingAddress}
                          className="rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                          style={{ background: TECH_ACCENT, color: '#fff' }}
                        >
                          {savingAddress ? 'Зберігаємо...' : 'Зберегти адресу'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddressFormOpen(false)}
                          className="rounded-lg px-4 py-2 text-xs font-medium"
                          style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
                        >
                          Скасувати
                        </button>
                      </div>
                    </form>
                  )}

                  {addressesError && (
                    <p className="mb-3 rounded-xl p-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#FCA5A5' }}>
                      {addressesError}
                    </p>
                  )}

                  {loadingAddresses && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Завантаження...
                    </p>
                  )}

                  {!loadingAddresses && addresses.length === 0 && !addressesError && (
                    <p className="text-sm" style={{ color: TECH_FAINT }}>
                      Збережених адрес поки немає.
                    </p>
                  )}

                  <div className="flex flex-col gap-2.5">
                    {addresses.map((address) => (
                      <div key={address.id} className="flex items-start justify-between gap-3 rounded-xl p-4" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium" style={{ color: '#fff' }}>
                              {address.recipientName}
                            </p>
                            {address.isDefault && (
                              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: 'rgba(59,130,246,0.16)', color: TECH_ACCENT_BRIGHT }}>
                                Основна
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs" style={{ color: TECH_MUTED }}>
                            {address.city}, {address.warehouse}
                          </p>
                          {address.recipientPhone && (
                            <p className="mt-0.5 text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                              {address.recipientPhone}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!address.isDefault && (
                            <button
                              type="button"
                              disabled={busyAddressId === address.id}
                              onClick={() => handleSetDefaultAddress(address.id)}
                              className="rounded-md px-2.5 py-1.5 text-[11px] font-medium disabled:opacity-50"
                              style={{ border: `1px solid ${TECH_BORDER_2}`, color: TECH_MUTED }}
                            >
                              Зробити основною
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busyAddressId === address.id}
                            onClick={() => handleDeleteAddress(address.id)}
                            className="rounded-md p-1.5 transition-colors hover:bg-white/5 disabled:opacity-50"
                            style={{ color: TECH_FAINT }}
                            aria-label="Видалити адресу"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}
