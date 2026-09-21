'use client';

// ============================================================
// Экран "Новый заказ" — оформление заказа менеджером из админ-панели
// (клиент позвонил/написал напрямую, а не сам прошёл корзину на сайте).
//
// Использует уже существующие эндпоинты, ничего нового на бэкенде не
// понадобилось:
//   GET  /api/admin/customers?search=...  — подсказка по телефону,
//                                            если клиент уже покупал
//   GET  /api/products?search=...&pageSize=10  — поиск товаров в каталог
//   POST /api/orders/create               — то же самое создание
//                                            заказа, которым пользуется
//                                            витрина (customer_id и
//                                            cost_price-снимок
//                                            проставляются автоматически,
//                                            см. app/api/orders/create/route.ts)
//
// Город/адрес необязательны для заполнения прямо сейчас — если их
// ещё не знают, кнопка "Уточнить по телефону" подставляет ту же
// формулировку, что и у кнопки "Купити в 1 клік" на карточке товара
// (components/QuickOrderModal.tsx), чтобы в базе не плодились разные
// варианты одной и той же по смыслу пометки
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import AdminLayout from './AdminLayout';

const PENDING_NOTE = 'Уточнити при дзвінку менеджера';
const SEARCH_DEBOUNCE_MS = 350;

interface CustomerMatch {
  id: string;
  phone: string;
  name: string;
  surname: string | null;
}

interface ProductSearchResult {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  supplierName: string;
}

interface CartItem {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  quantity: number;
}

function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NewOrderScreen() {
  const router = useRouter();

  // ---- клиент ----
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerSurname, setCustomerSurname] = useState('');
  const [customerMatch, setCustomerMatch] = useState<CustomerMatch | null>(null);
  const [customerMatchApplied, setCustomerMatchApplied] = useState(false);

  // ---- доставка ----
  const [city, setCity] = useState('');
  const [novaPoshtaAddress, setNovaPoshtaAddress] = useState('');
  const [comment, setComment] = useState('');

  // ---- поиск товаров ----
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  // ---- корзина заказа ----
  const [cart, setCart] = useState<CartItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successOrderId, setSuccessOrderId] = useState<string | null>(null);

  // ------------------------------------------------------------
  // ПОДСКАЗКА ПО ТЕЛЕФОНУ — есть ли уже такой клиент
  // ------------------------------------------------------------
  useEffect(() => {
    if (!isValidPhone(customerPhone)) {
      setCustomerMatch(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/customers?search=${encodeURIComponent(customerPhone.trim())}`);
        const data = await response.json();
        if (response.ok && data.success && data.customers.length > 0) {
          setCustomerMatch(data.customers[0] as CustomerMatch);
        } else {
          setCustomerMatch(null);
        }
      } catch {
        // Подсказка необязательна — если поиск не удался, заказ всё
        // равно можно оформить, просто без автоподстановки имени
        setCustomerMatch(null);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [customerPhone]);

  const applyCustomerMatch = () => {
    if (!customerMatch) return;
    setCustomerName(customerMatch.name);
    setCustomerSurname(customerMatch.surname || '');
    setCustomerMatchApplied(true);
  };

  // ------------------------------------------------------------
  // ПОИСК ТОВАРОВ ДЛЯ ДОБАВЛЕНИЯ В КОРЗИНУ
  // ------------------------------------------------------------
  useEffect(() => {
    const term = productSearch.trim();
    if (!term) {
      setProductResults([]);
      return;
    }
    setSearchingProducts(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(term)}&pageSize=10`);
        const data = await response.json();
        setProductResults(response.ok ? (data.products as ProductSearchResult[]) : []);
      } catch {
        setProductResults([]);
      } finally {
        setSearchingProducts(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [productSearch]);

  const addToCart = (product: ProductSearchResult) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock || item.quantity + 1) } : item
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          article: product.article,
          brand: product.brand,
          name: product.name,
          retailPrice: product.retailPrice,
          stock: product.stock,
          quantity: 1,
        },
      ];
    });
    setProductSearch('');
    setProductResults([]);
  };

  const updateQuantity = (id: string, quantity: number) => {
    setCart((prev) => prev.map((item) => (item.id === id ? { ...item, quantity } : item)));
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.retailPrice * item.quantity, 0);

  const applyPendingNote = () => {
    setCity(PENDING_NOTE);
    setNovaPoshtaAddress(PENDING_NOTE);
  };

  // ------------------------------------------------------------
  // ОТПРАВКА ЗАКАЗА
  // ------------------------------------------------------------
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    if (!customerName.trim()) {
      setSubmitError("Укажите имя клиента.");
      return;
    }
    if (!customerSurname.trim()) {
      setSubmitError('Укажите фамилию клиента.');
      return;
    }
    if (!isValidPhone(customerPhone)) {
      setSubmitError('Укажите корректный номер телефона.');
      return;
    }
    if (!city.trim() || !novaPoshtaAddress.trim()) {
      setSubmitError('Укажите город и адрес доставки (или нажмите "Уточнить по телефону").');
      return;
    }
    if (cart.length === 0) {
      setSubmitError('Добавьте хотя бы один товар в заказ.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerSurname: customerSurname.trim(),
          customerPhone: customerPhone.trim(),
          city: city.trim(),
          novaPoshtaAddress: novaPoshtaAddress.trim(),
          comment: comment.trim() || 'Заказ оформлен менеджером из админ-панели.',
          items: cart.map((item) => ({ id: item.id, count: item.quantity })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось оформить заказ');
      }
      setSuccessOrderId(data.orderId as string);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Ошибка сети при оформлении заказа');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setCustomerPhone('');
    setCustomerName('');
    setCustomerSurname('');
    setCustomerMatch(null);
    setCustomerMatchApplied(false);
    setCity('');
    setNovaPoshtaAddress('');
    setComment('');
    setCart([]);
    setSuccessOrderId(null);
    setSubmitError(null);
  };

  if (successOrderId) {
    return (
      <AdminLayout active="orders">
        <div
          className="max-w-md mx-auto mt-10 p-6 rounded-lg text-center"
          style={{ background: 'var(--good-soft)', border: '1px solid var(--line)' }}
        >
          <p className="text-lg font-semibold mb-2" style={{ color: 'var(--good)' }}>
            Заказ оформлен
          </p>
          <p className="text-sm mb-5 font-mono" style={{ color: 'var(--ink-muted)' }}>
            №{successOrderId.slice(0, 8)}
          </p>
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={() => router.push('/admin/orders')}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              К списку заказов
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 rounded-md text-sm"
              style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
            >
              Создать ещё один
            </button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="orders">
      <p className="text-xs mb-1" style={{ color: 'var(--ink-faint)' }}>
        Админ-панель / Заказы / Новый заказ
      </p>
      <h1 className="text-2xl font-semibold mb-1">Новый заказ</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-muted)' }}>
        Для клиента, который позвонил или написал напрямую — заказ появится в общем списке заказов сразу
        после оформления.
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-6 items-start">
        {/* ==================== ДАННЫЕ КЛИЕНТА И ДОСТАВКИ ==================== */}
        <section className="p-5 rounded-lg flex flex-col gap-3.5" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <h2 className="text-base font-semibold">Клиент</h2>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Телефон
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(e.target.value);
                setCustomerMatchApplied(false);
              }}
              placeholder="+380501234567"
              className="w-full px-3 py-2 text-sm rounded-md font-mono"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
            {customerMatch && !customerMatchApplied && (
              <button
                type="button"
                onClick={applyCustomerMatch}
                className="text-[11px] mt-1.5 px-2 py-1 rounded"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                Найден клиент: {customerMatch.name} {customerMatch.surname || ''} — подставить
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                Имя
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
                Фамилия
              </label>
              <input
                type="text"
                value={customerSurname}
                onChange={(e) => setCustomerSurname(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md"
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
              />
            </div>
          </div>

          <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 14 }}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                Город
              </label>
              <button
                type="button"
                onClick={applyPendingNote}
                className="text-[11px] underline"
                style={{ color: 'var(--ink-faint)' }}
              >
                Уточнить по телефону
              </button>
            </div>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md mb-2.5"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Отделение Новой Почты
            </label>
            <input
              type="text"
              value={novaPoshtaAddress}
              onChange={(e) => setNovaPoshtaAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Комментарий
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="напр. звонил сам, просит перезвонить вечером"
              className="w-full px-3 py-2 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />
          </div>

          {submitError && (
            <p className="text-xs" style={{ color: 'var(--bad)' }}>
              {submitError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {submitting ? 'Оформление...' : `Оформить заказ${cart.length ? ` (${formatMoney(cartTotal)} грн)` : ''}`}
          </button>
        </section>

        {/* ==================== ТОВАРЫ ==================== */}
        <section className="flex flex-col gap-4">
          <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-muted)' }}>
              Найти товар по артикулу или названию
            </label>
            <input
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="напр. NIS540092S601 или Торсион"
              className="w-full px-3 py-2 text-sm rounded-md"
              style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            />

            {searchingProducts && (
              <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
                Ищем...
              </p>
            )}

            {productResults.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {productResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-md text-left text-sm"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                  >
                    <div className="min-w-0">
                      <p className="truncate">{p.name || p.article}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                        {p.article} {p.brand ? `· ${p.brand}` : ''} · {p.supplierName} ·{' '}
                        {p.stock > 0 ? `${p.stock} шт` : 'под заказ'}
                      </p>
                    </div>
                    <span className="font-mono shrink-0">{formatMoney(p.retailPrice)} грн</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <h2 className="text-base font-semibold px-4 pt-4 pb-3">Состав заказа</h2>
            {cart.length === 0 ? (
              <p className="text-xs px-4 pb-4" style={{ color: 'var(--ink-faint)' }}>
                Ещё не добавлено ни одного товара — найдите его в поиске выше.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Товар', 'Цена', 'Кол-во', 'Сумма', ''].map((h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2 text-xs font-medium whitespace-nowrap"
                          style={{ color: 'var(--ink-muted)' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td className="px-4 py-2.5">
                          <p className="max-w-[220px] truncate">{item.name || item.article}</p>
                          <p className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                            {item.article}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(item.retailPrice)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.id, Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-16 px-2 py-1 text-xs rounded-md font-mono"
                            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                          {formatMoney(item.retailPrice * item.quantity)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.id)}
                            className="text-xs px-2 py-1 rounded"
                            style={{ color: 'var(--bad)' }}
                          >
                            Убрать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-right">
                        Итого
                      </td>
                      <td colSpan={2} className="px-4 py-3 text-sm font-semibold font-mono">
                        {formatMoney(cartTotal)} грн
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </section>
      </form>
    </AdminLayout>
  );
}
