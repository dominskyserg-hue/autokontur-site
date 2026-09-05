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
// Стиль — темний Tech Premium, той самий, що і на Головній та картці
// товару (lib/techTheme.ts).
//
// 'use client' в самому верху обов'язковий: компонент використовує
// хуки (useState/useEffect) і працює з браузерним fetch/localStorage
// ============================================================

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
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

// Людський переклад статусу + колір — той самий язик кольорів, що і
// статуси наявності товару (зелене світіння "готово", бурштинове
// "в роботі", нейтральне "новий", червонувате "скасовано")
const STATUS_META: Record<OrderStatus, { label: string; bg: string; fg: string }> = {
  new: { label: 'Новий', bg: 'rgba(255,255,255,0.06)', fg: TECH_MUTED },
  processing: { label: 'В обробці', bg: TECH_HEAT_SOFT, fg: TECH_HEAT },
  awaiting_parts: { label: 'Очікує запчастини', bg: 'rgba(59,130,246,0.14)', fg: TECH_ACCENT_BRIGHT },
  ready: { label: 'Готовий до видачі', bg: TECH_GOOD_SOFT, fg: TECH_GOOD },
  cancelled: { label: 'Скасовано', bg: 'rgba(239,68,68,0.14)', fg: '#FCA5A5' },
};

// Статуси, які вважаються "в роботі" для зведеної статистики кабінету —
// все, що ще не завершилось (готово чи скасовано)
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
    return <div className="min-h-screen" style={{ background: TECH_BG }} />;
  }

  // ==================== ЕКРАН ВХОДУ ====================
  if (!loggedInPhone) {
    return (
      <div className="flex min-h-screen items-center justify-center px-5" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
        <div
          className="w-full max-w-sm rounded-2xl p-7"
          style={{ background: TECH_SURFACE, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${TECH_BORDER_2}` }}
        >
          <div
            className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold"
            style={{ background: `linear-gradient(135deg, ${TECH_ACCENT}, ${TECH_ACCENT_DIM})`, color: '#fff', boxShadow: TECH_GLOW }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="mb-1.5 text-xl font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
            Особистий кабінет
          </h1>
          <p className="mb-6 text-sm leading-relaxed" style={{ color: TECH_MUTED }}>
            Введіть номер телефону, який вказували при оформленні замовлення — покажемо всю історію ваших
            покупок.
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

  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <header className="backdrop-blur-xl" style={{ background: 'rgba(11,15,23,0.82)', borderBottom: `1px solid ${TECH_BORDER}` }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-5 md:px-8">
          <div>
            <p className="text-lg font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
              Особистий кабінет
            </p>
            <p className="mt-0.5 text-xs" style={{ fontFamily: TECH_MONO_FONT, color: TECH_MUTED }}>
              {loggedInPhone}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-white/5"
            style={{ background: 'rgba(255,255,255,0.05)', color: TECH_MUTED }}
          >
            Вийти
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        {/* ---- зведена статистика ---- */}
        <div className="mb-8 grid grid-cols-2 gap-4">
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

        {/* ---- список замовлень ---- */}
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

            return (
              <div
                key={order.id}
                className="overflow-hidden rounded-2xl"
                style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
              >
                <button
                  type="button"
                  onClick={() => toggleOrder(order.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="text-sm" style={{ fontFamily: TECH_MONO_FONT, color: TECH_FAINT }}>
                      {shortId(order.id)}
                    </span>
                    <span className="text-sm" style={{ color: TECH_MUTED }}>
                      {formatDate(order.createdAt)}
                    </span>
                    <span className="hidden text-sm sm:inline" style={{ color: TECH_MUTED }}>
                      {order.itemsCount} {order.itemsCount === 1 ? 'товар' : 'товарів'}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className="whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{ background: statusMeta.bg, color: statusMeta.fg }}
                    >
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
                        </div>

                        <div className="flex flex-col gap-2">
                          {details.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 py-2"
                              style={{ borderTop: `1px solid ${TECH_BORDER}` }}
                            >
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
