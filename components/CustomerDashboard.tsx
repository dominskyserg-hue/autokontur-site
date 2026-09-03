'use client';

// ============================================================
// Особистий кабінет покупця — історія його замовлень і статус
// виконання. Сторінка живе за адресою /account (див. app/account/
// page.tsx), посилання на неї — в шапці вітрини
// (components/StorefrontHome.tsx).
//
// "Вхід" без пароля: покупець просто вводить номер телефону. Роут
// GET /api/customer/orders одночасно і "перевіряє вхід" — якщо
// замовлення з таким телефоном знайшлись, значить телефон "вірний" і
// показуємо кабінет; якщо ні — лишаємось на екрані входу з помилкою.
// У СПРАВЖНІЙ системі тут була б SMS-верифікація (код підтвердження) —
// в цьому проєкті це свідоме спрощення (детальний коментар про це і
// про те, що РЕАЛЬНО захищено — в app/api/customer/orders/route.ts).
//
// Телефон, яким увійшли, зберігається в localStorage браузера (той
// самий прийом, що і для кошика, див. CART_STORAGE_KEY в
// components/StorefrontHome.tsx) — так покупець не вводить його
// заново при кожному відкритті сторінки.
//
// 'use client' в самому верху обов'язковий: компонент використовує
// хуки (useState/useEffect) і працює з браузерним fetch/localStorage
// ============================================================

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

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
  createdAt: string;
  items: OrderItem[];
  totalAmount: number;
}

const PHONE_STORAGE_KEY = 'autokontur-customer-phone';

// Людський переклад статусу + колір — точно за вимогами задання
const STATUS_META: Record<OrderStatus, { label: string; bg: string; fg: string }> = {
  new: { label: 'Новий', bg: '#EEF0F3', fg: '#5B6472' },
  processing: { label: 'В обробці', bg: '#FFF1E8', fg: '#EA580C' },
  awaiting_parts: { label: 'Очікує запчастини', bg: '#FEF9C3', fg: '#A16207' },
  ready: { label: 'Готовий до видачі', bg: '#DCFCE7', fg: '#16A34A' },
  cancelled: { label: 'Скасовано', bg: '#FEE2E2', fg: '#DC2626' },
};

// Статуси, которые считаются "в работе" для сводной статистики
// кабинета — всё, что ещё не завершилось (готово или отменено)
const IN_PROGRESS_STATUSES: OrderStatus[] = ['new', 'processing', 'awaiting_parts'];

// Копійки покупцю не показуємо — тільки цілі гривні, округлені ВГОРУ
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
// розкладає їх у вигляд "+380 XX XXX XX XX" — так завжди видно,
// скільки цифр ще бракує, і неможливо ввести літери чи зайві символи
// ------------------------------------------------------------
function formatPhoneMask(rawValue: string): string {
  // rawValue — це ВЕСЬ поточний вміст поля (разом із "+380 " та
  // пробілами, які вже додала попередня маска) — спершу прибираємо
  // все, крім цифр, і будуємо маску заново з чистого числа
  const allDigits = rawValue.replace(/\D/g, '');

  // Відрізаємо код країни "380", якщо він вже присутній на початку
  // (а він майже завжди присутній — поле завжди показує "+380" ще до
  // того, як покупець почав друкувати)
  let national = allDigits.startsWith('380') ? allDigits.slice(3) : allDigits;

  // Далі покупець за звичкою міг почати САМ НОМЕР ще з одного "0" —
  // так номер записують у домашньому (не міжнародному) форматі,
  // "0" + 9 цифр. Це стосується цифр ПІСЛЯ коду країни, а не всього
  // рядка цілком — тому перевіряємо саме national, а не allDigits:
  // якщо перевіряти allDigits, "0" одразу після вже показаного "+380"
  // ніколи не опиниться на самому початку рядка, і цю звичку
  // неможливо було б розпізнати
  if (national.startsWith('0')) national = national.slice(1);
  national = national.slice(0, 9); // більше 9 цифр у номері однаково не буває

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
  return masked.replace(/\D/g, '').length === 12; // 380 + 9 цифр номера
}

export default function CustomerDashboard() {
  // ---- вхід ----
  const [phoneInput, setPhoneInput] = useState('+380');
  const [loggedInPhone, setLoggedInPhone] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Поки читаємо localStorage при завантаженні сторінки — не показуємо
  // ні форму входу, ні кабінет, щоб не було "миготіння" між ними
  const [restoringSession, setRestoringSession] = useState(true);

  // ---- замовлення ----
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // ---- деталізація (акордеон) ----
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [orderDetails, setOrderDetails] = useState<Record<string, OrderDetails>>({});
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Відновлення "сесії" зі localStorage при відкритті сторінки
  useEffect(() => {
    try {
      const savedPhone = window.localStorage.getItem(PHONE_STORAGE_KEY);
      if (savedPhone) {
        setLoggedInPhone(savedPhone);
      }
    } catch {
      // localStorage недоступний (приватний режим тощо) — просто
      // залишаємось на екрані входу, це не критично
    } finally {
      setRestoringSession(false);
    }
  }, []);

  // Як тільки дізнались телефон (щойно ввели або відновили з
  // localStorage) — одразу підвантажуємо список замовлень
  useEffect(() => {
    if (!loggedInPhone) return;
    fetchOrders(loggedInPhone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedInPhone]);

  const fetchOrders = async (phone: string) => {
    setLoadingOrders(true);
    setOrdersError(null);
    try {
      const params = new URLSearchParams({ phone });
      const response = await fetch(`/api/customer/orders?${params.toString()}`);
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
  };

  // ВХІД — та ж сама перевірка "чи є замовлення з таким телефоном",
  // що й на бекенді (GET /api/customer/orders сам виконує цю роль)
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isCompletePhone(phoneInput)) {
      setLoginError("Введіть повний номер телефону");
      return;
    }

    setLoggingIn(true);
    setLoginError(null);
    try {
      const params = new URLSearchParams({ phone: phoneInput });
      const response = await fetch(`/api/customer/orders?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Замовлень з таким номером не знайдено');
      }

      // Успіх — запам'ятовуємо телефон і показуємо кабінет одразу з
      // уже отриманими замовленнями (повторний запит не потрібен)
      window.localStorage.setItem(PHONE_STORAGE_KEY, phoneInput);
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
    setLoggedInPhone(null);
    setOrders([]);
    setExpandedOrderId(null);
    setOrderDetails({});
    setPhoneInput('+380');
  };

  // РОЗГОРТАННЯ ЗАМОВЛЕННЯ — деталі підвантажуються ЛІНИВО (тільки
  // коли покупець реально розгортає картку) і кешуються в
  // orderDetails, щоб повторне розгортання не робило зайвий запит
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
      const params = new URLSearchParams({ phone: loggedInPhone });
      const response = await fetch(`/api/customer/orders/${orderId}?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося отримати деталі замовлення');
      }
      setOrderDetails((prev) => ({ ...prev, [orderId]: data.order as OrderDetails }));
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Помилка мережі під час завантаження деталей');
    } finally {
      setLoadingDetailsId(null);
    }
  };

  if (restoringSession) {
    return <div className="min-h-screen" style={{ background: '#F7F8FA' }} />;
  }

  // ==================== ЕКРАН ВХОДУ ====================
  if (!loggedInPhone) {
    return (
      <div className="min-h-screen flex items-center justify-center px-5" style={{ background: '#F7F8FA', color: '#14181F' }}>
        <div className="w-full max-w-sm p-7 rounded-2xl" style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}>
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base mb-5"
            style={{ background: '#EA580C', color: '#FFFFFF' }}
          >
            A
          </div>
          <h1 className="text-xl font-bold mb-1.5">Особистий кабінет</h1>
          <p className="text-sm mb-6" style={{ color: '#5B6472' }}>
            Введіть номер телефону, який вказували при оформленні замовлення — покажемо всю
            історію ваших покупок.
          </p>

          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <div>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(formatPhoneMask(e.target.value))}
                placeholder="+380 XX XXX XX XX"
                className="w-full px-4 py-3 text-base rounded-lg outline-none font-mono tracking-wide"
                style={{ border: `1px solid ${loginError ? '#DC2626' : '#E2E5EA'}`, background: '#F7F8FA' }}
                autoFocus
              />
              {loginError && (
                <p className="text-xs mt-1.5" style={{ color: '#DC2626' }}>
                  {loginError}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loggingIn || !isCompletePhone(phoneInput)}
              className="w-full py-3 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ background: '#EA580C', color: '#FFFFFF' }}
            >
              {loggingIn ? 'Перевіряємо...' : 'Увійти'}
            </button>
          </form>

          <p className="text-xs mt-5" style={{ color: '#8A93A2' }}>
            Підтвердження кодом із СМС тут не потрібне — це спрощена демо-версія входу.
          </p>
        </div>
      </div>
    );
  }

  // ==================== КАБІНЕТ ====================
  const inProgressCount = orders.filter((order) => IN_PROGRESS_STATUSES.includes(order.status)).length;

  return (
    <div className="min-h-screen" style={{ background: '#F7F8FA', color: '#14181F' }}>
      <header style={{ background: '#0F172A' }}>
        <div className="max-w-4xl mx-auto px-5 md:px-8 py-5 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold text-lg">Особистий кабінет</p>
            <p className="text-xs font-mono mt-0.5" style={{ color: '#94A3B8' }}>
              {loggedInPhone}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs px-3 py-2 rounded-md font-medium"
            style={{ background: '#1E293B', color: '#CBD5E1' }}
          >
            Вийти
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 md:px-8 py-8">
        {/* ---- зведена статистика ---- */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="p-5 rounded-xl" style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}>
            <p className="text-2xl font-bold">{orders.length}</p>
            <p className="text-xs mt-1" style={{ color: '#8A93A2' }}>
              Всього замовлень
            </p>
          </div>
          <div className="p-5 rounded-xl" style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}>
            <p className="text-2xl font-bold" style={{ color: inProgressCount > 0 ? '#EA580C' : undefined }}>
              {inProgressCount}
            </p>
            <p className="text-xs mt-1" style={{ color: '#8A93A2' }}>
              В роботі
            </p>
          </div>
        </div>

        {/* ---- список замовлень ---- */}
        <h2 className="text-base font-semibold mb-3">Історія замовлень</h2>

        {loadingOrders && (
          <p className="text-sm" style={{ color: '#8A93A2' }}>
            Завантаження...
          </p>
        )}

        {ordersError && (
          <p className="text-sm p-4 rounded-lg" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {ordersError}
          </p>
        )}

        {!loadingOrders && !ordersError && orders.length === 0 && (
          <p className="text-sm" style={{ color: '#8A93A2' }}>
            Замовлень поки немає.
          </p>
        )}

        <div className="flex flex-col gap-3">
          {orders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const details = orderDetails[order.id];
            const statusMeta = STATUS_META[order.status];

            return (
              <div
                key={order.id}
                className="rounded-xl overflow-hidden"
                style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}
              >
                <button
                  type="button"
                  onClick={() => toggleOrder(order.id)}
                  className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="font-mono text-sm" style={{ color: '#8A93A2' }}>
                      {shortId(order.id)}
                    </span>
                    <span className="text-sm" style={{ color: '#5B6472' }}>
                      {formatDate(order.createdAt)}
                    </span>
                    <span className="text-sm hidden sm:inline" style={{ color: '#5B6472' }}>
                      {order.itemsCount} {order.itemsCount === 1 ? 'товар' : 'товарів'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className="text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
                      style={{ background: statusMeta.bg, color: statusMeta.fg }}
                    >
                      {statusMeta.label}
                    </span>
                    <span className="text-sm font-semibold whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatMoney(order.totalAmount)} грн
                    </span>
                    <span style={{ color: '#8A93A2', transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▾</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-5 pb-5" style={{ borderTop: '1px solid #F0F1F3' }}>
                    {loadingDetailsId === order.id && (
                      <p className="text-xs pt-4" style={{ color: '#8A93A2' }}>
                        Завантаження складу замовлення...
                      </p>
                    )}

                    {detailsError && loadingDetailsId !== order.id && !details && (
                      <p className="text-xs pt-4" style={{ color: '#DC2626' }}>
                        {detailsError}
                      </p>
                    )}

                    {details && (
                      <div className="pt-4">
                        <div className="flex flex-col gap-2 mb-4 text-xs" style={{ color: '#5B6472' }}>
                          <p>
                            Доставка: {details.city}, {details.novaPoshtaAddress}
                          </p>
                          {details.comment && <p>Коментар: {details.comment}</p>}
                        </div>

                        <div className="flex flex-col gap-2">
                          {details.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 py-2"
                              style={{ borderTop: '1px solid #F0F1F3' }}
                            >
                              <div className="min-w-0">
                                <p className="text-sm">{item.name || 'Без назви'}</p>
                                <p className="text-xs font-mono mt-0.5" style={{ color: '#8A93A2' }}>
                                  {item.article}
                                  {item.brand ? ` · ${item.brand}` : ''}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-mono" style={{ color: '#8A93A2' }}>
                                  {item.quantity} × {formatMoney(item.price)} грн
                                </p>
                                <p className="text-sm font-mono font-semibold">
                                  {formatMoney(item.price * item.quantity)} грн
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
