'use client';

// ============================================================
// Главная страница витрины интернет-магазина автозапчастей —
// то, что видит обычный покупатель (не путать с админ-панелью,
// она теперь живёт под /admin, см. components/AdminLayout.tsx).
//
// Экран состоит из:
//   1. Шапка — логотип, контакты, иконка корзины со счётчиком
//   2. Hero-блок — большая строка поиска по артикулу по центру
//   3. Сетка преимуществ — короткие плашки под hero-блоком
//   4. Результаты поиска — появляются вместо/под hero-блоком
//      после того, как покупатель нажал "Найти"
//
// Телефон, часы работы и объявления-баннеры настраиваются в
// админ-панели (/admin/settings, см. components/ContactSettingsForm.tsx
// и components/AnnouncementsManager.tsx) — здесь они просто
// подгружаются через GET /api/site-settings и GET /api/announcements
//
// Поиск использует настоящий бэкенд:
//   GET /api/products?search=...
// Сам бэкенд (см. app/api/products/route.ts) уже приводит поисковый
// запрос через cleanArticle() к тому же виду, в котором артикул
// хранится в базе — поэтому "555-66", "555 66" и "55566" находят
// один и тот же товар. Дополнительно нормализовывать запрос здесь,
// на фронтенде, не нужно — это забота бэкенда.
//
// Корзина — простое состояние на клиенте (React state), сохраняется
// в localStorage браузера, чтобы не пропадать при перезагрузке
// страницы. Оформление заказа (чекаут) в этой версии ещё не сделано —
// это следующий шаг.
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch/localStorage
//
// ВАЖНО: весь текст, который видит покупатель (кнопки, заголовки,
// сообщения) — на УКРАИНСКОМ языке, это витрина для конечного
// клиента. Комментарии в коде при этом остаются на русском — так
// заведено во всём остальном проекте (админ-панель, бэкенд)
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';

// ------------------------------------------------------------
// ТИПЫ
// ------------------------------------------------------------

// Товар в том виде, в котором его отдаёт GET /api/products
// (см. app/api/products/route.ts) — здесь перечислены только те
// поля, которые реально нужны витрине
interface Product {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  // Фото товара — ссылка или data:-URI, задаётся в админке на экране
  // "Товары" (вручную или автопоиском через Google). null, если фото
  // ещё не добавили — тогда показываем заглушку
  imageUrl: string | null;
  retailPrice: number;
  stock: number;
}

// Одна позиция в корзине — "снимок" товара на момент добавления
// (цена, название, бренд), плюс количество. stock — остаток на
// момент добавления, нужен только чтобы не дать покупателю нажатием
// "+" накрутить количество больше, чем реально есть на складе;
// окончательную сверку с актуальным остатком всё равно делает
// бэкенд при оформлении заказа (см. app/api/orders/create/route.ts)
interface CartItem {
  id: string;
  article: string;
  brand: string | null;
  name: string;
  price: number;
  quantity: number;
  stock: number;
}

const CART_STORAGE_KEY = 'autokontur-cart';
const VIEW_MODE_STORAGE_KEY = 'autokontur-view-mode';

// Значения по умолчанию — показываются, пока /api/site-settings ещё
// не ответил (или если админ ни разу не менял их через "Настройки")
const DEFAULT_SHOP_NAME = 'AUTOKONTUR';
const DEFAULT_PHONE = '+38 (050) 123-45-67';
const DEFAULT_WORKING_HOURS = 'Щодня 9:00–19:00';

interface Announcement {
  id: string;
  text: string;
}

function formatMoney(value: number): string {
  return value.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Простая проверка номера телефона: считаем только цифры и требуем,
// чтобы их было от 9 до 13 — этого достаточно, чтобы отсечь явный
// мусор ("123", пустую строку), но не отбраковывать разные способы
// записи украинского номера (с +38, с 0 в начале, с пробелами/дефисами)
function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

export default function StorefrontHome() {
  // ---- магазин, контакты и объявления (настраиваются в админке /admin/settings) ----
  const [shopName, setShopName] = useState(DEFAULT_SHOP_NAME);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [workingHours, setWorkingHours] = useState(DEFAULT_WORKING_HOURS);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    fetch('/api/site-settings')
      .then((response) => response.json())
      .then((data) => {
        if (data.settings) {
          if (data.settings.shopName) {
            setShopName(data.settings.shopName);
            // Обновляем и заголовок вкладки браузера — метаданные в
            // app/layout.tsx статичные и заданы на этапе сборки,
            // а название магазина настраивается уже после, в базе
            document.title = `${data.settings.shopName} — автозапчастини з доставкою по Україні`;
          }
          if (data.settings.phone) setPhone(data.settings.phone);
          if (data.settings.workingHours) setWorkingHours(data.settings.workingHours);
        }
      })
      .catch(() => {
        // Не получилось — просто остаёмся со значениями по умолчанию,
        // это не критично для работы самой витрины
      });

    // activeOnly=1 — на витрине показываем только те объявления,
    // которые админ явно включил (см. components/AnnouncementsManager.tsx)
    fetch('/api/announcements?activeOnly=1')
      .then((response) => response.json())
      .then((data) => {
        if (data.announcements) setAnnouncements(data.announcements);
      })
      .catch(() => {
        // Баннер объявлений необязателен — без него витрина всё
        // равно полностью работает
      });
  }, []);

  // ---- поиск ----
  // Два режима поиска показывают результаты в одну и ту же секцию
  // (results/searching/searchError/submittedQuery общие для обоих) —
  // отличаются только тем, ЧТО именно передаётся в GET /api/products
  const [searchMode, setSearchMode] = useState<'article' | 'car'>('article');

  // searchInput — то, что покупатель печатает; submittedQuery — то,
  // по чему реально искали (обновляется только по кнопке "Найти"/Enter,
  // а не на каждую напечатанную букву — так не долбим сервер зря)
  const [searchInput, setSearchInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Вигляд результатів пошуку — плиткою (картки) або таблицею.
  // Запам'ятовуємо вибір у localStorage, щоб покупець не перемикав
  // його заново при кожному новому пошуку чи візиті на сайт
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'grid' || saved === 'table') setViewMode(saved);
    } catch {
      // localStorage недоступний — просто лишаємось з виглядом за замовчуванням
    }
  }, []);

  const changeViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // не критично — вибір просто не запам'ятається до наступного разу
    }
  };

  // ---- підбір за автомобілем (марка/рік/об'єм двигуна) ----
  // Значення у випадаючих списках — не довільний текст, а реальні
  // значення з бази (див. app/api/products/car-options/route.ts):
  // так неможливо шукати неіснуючу марку чи помилитись у написанні.
  // Списки каскадні: рік звужується вибраною маркою, об'єм двигуна —
  // маркою і роком разом
  const [carMake, setCarMake] = useState('');
  const [carYear, setCarYear] = useState('');
  const [carEngineVolume, setCarEngineVolume] = useState('');
  const [carMakeOptions, setCarMakeOptions] = useState<string[]>([]);
  const [carYearOptions, setCarYearOptions] = useState<string[]>([]);
  const [carEngineOptions, setCarEngineOptions] = useState<string[]>([]);

  // Марки загружаются один раз при открытии страницы — список брендов
  // в каталоге меняется редко, перезапрашивать его на каждое действие
  // покупателя незачем
  useEffect(() => {
    fetch('/api/products/car-options?field=make')
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setCarMakeOptions(data.options as string[]);
      })
      .catch(() => {
        // Список марок необязателен для работы всей витрины в целом —
        // просто вкладка "За автомобілем" временно окажется без опцій
      });
  }, []);

  // Смена марки — сбрасываем уже выбранные год/объём (они могли не
  // существовать у новой марки) и подгружаем года именно этой марки
  useEffect(() => {
    setCarYear('');
    setCarEngineVolume('');
    setCarEngineOptions([]);

    if (!carMake) {
      setCarYearOptions([]);
      return;
    }

    const params = new URLSearchParams({ field: 'year', make: carMake });
    fetch(`/api/products/car-options?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setCarYearOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [carMake]);

  // Смена года — сбрасываем объём двигателя и подгружаем варианты
  // объёма именно для этой связки марка+год
  useEffect(() => {
    setCarEngineVolume('');

    if (!carMake || !carYear) {
      setCarEngineOptions([]);
      return;
    }

    const params = new URLSearchParams({ field: 'engineVolume', make: carMake, year: carYear });
    fetch(`/api/products/car-options?${params.toString()}`)
      .then((response) => response.json())
      .then((data) => {
        if (data.options) setCarEngineOptions(data.options as string[]);
      })
      .catch(() => {});
  }, [carMake, carYear]);

  // ---- корзина ----
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  // Флаг "корзина уже загружена из localStorage" — нужен, чтобы НЕ
  // перезаписать localStorage пустым массивом на самом первом рендере,
  // до того как реальные данные оттуда успели подгрузиться
  const [cartLoaded, setCartLoaded] = useState(false);

  // ---- форма оформления заказа (внутри панели корзины) ----
  // Имя, фамилия, телефон, город и адрес відділення Нової Пошти —
  // обов'язкові (потрібні для доставки), коментар — необов'язковий
  const [customerName, setCustomerName] = useState('');
  const [customerSurname, setCustomerSurname] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [city, setCity] = useState('');
  const [novaPoshtaAddress, setNovaPoshtaAddress] = useState('');
  const [comment, setComment] = useState('');
  // touched-флаги — чтобы не показывать "Введіть ім'я" сразу при
  // открытии корзины, а только после первой попытки отправить форму
  // или после того, как покупатель уже начал и затем стёр поле
  const [nameTouched, setNameTouched] = useState(false);
  const [surnameTouched, setSurnameTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [cityTouched, setCityTouched] = useState(false);
  const [addressTouched, setAddressTouched] = useState(false);

  // orderStatus управляет тем, что показано внутри панели корзины:
  // 'idle' — обычный список товаров и форма, 'submitting' — форма
  // отправляется (кнопка заблокирована и показывает "Відправка..."),
  // 'success' — вместо списка товаров показывается экран "Дякуємо..."
  const [orderStatus, setOrderStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [orderError, setOrderError] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  // ------------------------------------------------------------
  // КОРЗИНА: загрузка из localStorage при открытии страницы
  // ------------------------------------------------------------
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        setCart(JSON.parse(raw) as CartItem[]);
      }
    } catch {
      // Повреждённые данные в localStorage — не критично, просто
      // начинаем с пустой корзины
    } finally {
      setCartLoaded(true);
    }
  }, []);

  // КОРЗИНА: сохранение в localStorage при любом изменении
  // (но не раньше, чем она сама загрузилась — см. cartLoaded выше)
  useEffect(() => {
    if (!cartLoaded) return;
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, cartLoaded]);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        // Товар уже в корзине — просто увеличиваем количество
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: product.id,
          article: product.article,
          brand: product.brand,
          name: product.name || product.article,
          price: product.retailPrice,
          quantity: 1,
          stock: product.stock,
        },
      ];
    });
    setCartOpen(true);
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  // Изменение количества кнопками "+"/"-" в панели корзины. delta —
  // +1 или -1. Снизу ограничиваем единицей (убрать товар полностью —
  // это отдельная кнопка removeFromCart, а не количество 0), сверху —
  // остатком на складе, каким он был на момент добавления в корзину
  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextQuantity = item.quantity + delta;
        if (nextQuantity < 1 || nextQuantity > item.stock) return item;
        return { ...item, quantity: nextQuantity };
      })
    );
  };

  // Закрытие панели корзины — и по клику на затемнение фона, и по
  // крестику. Если корзина закрывается уже ПОСЛЕ успешного заказа —
  // сбрасываем экран "Дякуємо...", чтобы при следующем открытии
  // (например, для нового заказа) панель снова показывала обычный вид
  const closeCart = () => {
    setCartOpen(false);
    if (orderStatus === 'success') {
      setOrderStatus('idle');
      setCreatedOrderId(null);
    }
  };

  const nameError = customerName.trim().length === 0 ? "Введіть ваше ім'я" : null;
  const surnameError = customerSurname.trim().length === 0 ? 'Введіть ваше прізвище' : null;
  const phoneError = !isValidPhone(customerPhone) ? 'Введіть коректний номер телефону' : null;
  const cityError = city.trim().length === 0 ? 'Введіть місто доставки' : null;
  const addressError = novaPoshtaAddress.trim().length === 0 ? 'Введіть адресу відділення Нової Пошти' : null;

  // ------------------------------------------------------------
  // ОФОРМЛЕНИЕ ЗАКАЗА — POST /api/orders/create
  // ------------------------------------------------------------
  const handleSubmitOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Помечаем все обязательные поля "тронутыми" — теперь ошибки
    // валидации (если они есть) покажутся под полями, даже если
    // покупатель ещё ни разу не кликал в них до попытки отправить форму
    setNameTouched(true);
    setSurnameTouched(true);
    setPhoneTouched(true);
    setCityTouched(true);
    setAddressTouched(true);

    if (nameError || surnameError || phoneError || cityError || addressError || cart.length === 0) return;

    setOrderStatus('submitting');
    setOrderError(null);

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
          comment: comment.trim(),
          // Артикул/бренд/название/цену бэкенд перечитывает из базы
          // сам по id товара (см. комментарий в app/api/orders/create/
          // route.ts) — но всё равно передаём их и здесь, на случай
          // если в будущем понадобится показать это в ответе сразу,
          // не запрашивая товары заново
          items: cart.map((item) => ({
            id: item.id,
            count: item.quantity,
            retailPrice: item.price,
            name: item.name,
            article: item.article,
            brand: item.brand,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося оформити замовлення');
      }

      // Успех: показываем экран "Дякуємо..." и полностью очищаем
      // корзину — и React-state (setCart), и localStorage (это уже
      // делает эффект выше, который сохраняет cart в localStorage
      // при каждом изменении — запись [] означает "очистить")
      setCreatedOrderId(data.orderId);
      setOrderStatus('success');
      setCart([]);
      setCustomerName('');
      setCustomerSurname('');
      setCustomerPhone('');
      setCity('');
      setNovaPoshtaAddress('');
      setComment('');
      setNameTouched(false);
      setSurnameTouched(false);
      setPhoneTouched(false);
      setCityTouched(false);
      setAddressTouched(false);
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : 'Помилка мережі під час оформлення замовлення');
      setOrderStatus('idle');
    }
  };

  // ------------------------------------------------------------
  // ПОИСК — GET /api/products?...  Общая функция для обоих режимов
  // (по артикулу и за автомобілем): отличаются только параметрами
  // запроса (params) и подписью, которая показывается над результатами
  // (label, например "555-66" или "Toyota, 2008, 2.0")
  // ------------------------------------------------------------
  const runSearch = useCallback(async (params: URLSearchParams, label: string) => {
    setSearching(true);
    setSearchError(null);
    setSubmittedQuery(label);
    try {
      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не вдалося виконати пошук');
      }
      setResults(data.products as Product[]);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Помилка мережі під час пошуку');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) return;
    runSearch(new URLSearchParams({ search: query, pageSize: '24' }), query);
  };

  // Підбір за автомобілем — марка обов'язкова (без неї запит повернув
  // би взагалі весь каталог), рік і об'єм двигуна — необов'язкові
  // уточнення поверх марки
  const handleCarSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!carMake) return;

    const params = new URLSearchParams({ carMake, pageSize: '24' });
    if (carYear) params.set('carYear', carYear);
    if (carEngineVolume) params.set('engineVolume', carEngineVolume);

    const label = [carMake, carYear, carEngineVolume].filter(Boolean).join(', ');
    runSearch(params, label);
  };

  // Показываем результаты поиска, только если поиск реально
  // выполнялся (submittedQuery !== null) — до первого поиска на
  // экране просто hero-блок и преимущества, без пустой таблицы
  const hasSearched = submittedQuery !== null;

  return (
    <div className="min-h-screen" style={{ background: '#F7F8FA', color: '#14181F' }}>
      {/* ==================== ОБЪЯВЛЕНИЯ ==================== */}
      {/* Настраиваются в админке /admin/settings (см. AnnouncementsManager) —
          показываем только те, что админ явно включил. Если объявлений
          несколько, выводим все подряд узкими полосками */}
      {announcements.map((announcement) => (
        <div
          key={announcement.id}
          className="text-center text-xs md:text-sm py-2 px-4 font-medium"
          style={{ background: '#EA580C', color: '#FFFFFF' }}
        >
          {announcement.text}
        </div>
      ))}

      {/* ==================== ШАПКА ==================== */}
      <header style={{ background: '#0F172A' }}>
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-md flex items-center justify-center font-bold text-sm"
              style={{ background: '#EA580C', color: '#FFFFFF' }}
            >
              {shopName.charAt(0).toUpperCase()}
            </div>
            <span className="text-white font-semibold text-lg tracking-wide">{shopName}</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-sm" style={{ color: '#CBD5E1' }}>
            <PhoneIcon />
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="hover:text-white">
              {phone}
            </a>
            <span className="mx-2" style={{ color: '#475569' }}>
              ·
            </span>
            <span>{workingHours}</span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* ---- Особистий кабінет ---- */}
            <Link
              href="/account"
              className="flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium"
              style={{ background: '#1E293B', color: '#FFFFFF' }}
            >
              <UserIcon />
              <span className="hidden sm:inline">Кабінет</span>
            </Link>

            {/* ---- Корзина ---- */}
            {/* Кнопка только відкриває панель (не toggle) — закрывается
                панель отдельно, кликом по крестику или по затемнению
                фона (см. компонент CartDrawer ниже) */}
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium"
              style={{ background: '#1E293B', color: '#FFFFFF' }}
            >
              <CartIcon />
              <span className="hidden sm:inline">Кошик</span>
            {cartCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                style={{ background: '#EA580C', color: '#FFFFFF' }}
              >
                {cartCount}
              </span>
            )}
            </button>
          </div>
        </div>
      </header>

      {/* ==================== ПАНЕЛЬ КОРЗИНИ (Sidebar) ==================== */}
      {/* Выезжает справа поверх всей страницы. Что показывать внутри —
          решает CartDrawer сам, по переданным пропсам: пустая корзина /
          список товаров + форма оформления / экран "Дякуємо..." */}
      {cartOpen && (
        <CartDrawer
          cart={cart}
          cartTotal={cartTotal}
          cartCount={cartCount}
          orderStatus={orderStatus}
          orderError={orderError}
          createdOrderId={createdOrderId}
          customerName={customerName}
          customerSurname={customerSurname}
          customerPhone={customerPhone}
          city={city}
          novaPoshtaAddress={novaPoshtaAddress}
          comment={comment}
          nameError={nameTouched ? nameError : null}
          surnameError={surnameTouched ? surnameError : null}
          phoneError={phoneTouched ? phoneError : null}
          cityError={cityTouched ? cityError : null}
          addressError={addressTouched ? addressError : null}
          onNameChange={setCustomerName}
          onSurnameChange={setCustomerSurname}
          onPhoneChange={setCustomerPhone}
          onCityChange={setCity}
          onAddressChange={setNovaPoshtaAddress}
          onCommentChange={setComment}
          onNameBlur={() => setNameTouched(true)}
          onSurnameBlur={() => setSurnameTouched(true)}
          onPhoneBlur={() => setPhoneTouched(true)}
          onCityBlur={() => setCityTouched(true)}
          onAddressBlur={() => setAddressTouched(true)}
          onIncrement={(id) => updateQuantity(id, 1)}
          onDecrement={(id) => updateQuantity(id, -1)}
          onRemove={removeFromCart}
          onSubmit={handleSubmitOrder}
          onClose={closeCart}
        />
      )}

      {/* ==================== HERO + ПОИСК ==================== */}
      <section
        className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #334155 100%)',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 md:px-8 py-16 md:py-24 relative text-center">
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 leading-tight">
            Знайдіть потрібну запчастину
            <br />
            за секунди
          </h1>
          <p className="text-sm md:text-base mb-9 max-w-xl mx-auto" style={{ color: '#CBD5E1' }}>
            Понад 20 000 оригінальних та аналогових запчастин в наявності. Шукайте за
            артикулом деталі або підберіть деталь за вашим автомобілем.
          </p>

          {/* ---- перемикач режиму пошуку ---- */}
          <div className="max-w-2xl mx-auto flex gap-1 p-1 rounded-lg mb-3" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <button
              type="button"
              onClick={() => setSearchMode('article')}
              className="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
              style={
                searchMode === 'article'
                  ? { background: '#FFFFFF', color: '#14181F' }
                  : { background: 'transparent', color: '#CBD5E1' }
              }
            >
              За артикулом
            </button>
            <button
              type="button"
              onClick={() => setSearchMode('car')}
              className="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
              style={
                searchMode === 'car'
                  ? { background: '#FFFFFF', color: '#14181F' }
                  : { background: 'transparent', color: '#CBD5E1' }
              }
            >
              За автомобілем
            </button>
          </div>

          {searchMode === 'article' ? (
            <form
              onSubmit={handleSearchSubmit}
              className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3 p-2 rounded-xl"
              style={{ background: '#FFFFFF' }}
            >
              <div className="flex-1 flex items-center gap-2.5 px-3">
                <SearchIcon />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Наприклад: 555-66 або AB 12"
                  className="w-full py-3.5 text-base outline-none"
                  style={{ color: '#14181F' }}
                />
              </div>
              <button
                type="submit"
                disabled={searching || !searchInput.trim()}
                className="px-8 py-3.5 rounded-lg text-base font-semibold disabled:opacity-50 shrink-0"
                style={{ background: '#EA580C', color: '#FFFFFF' }}
              >
                {searching ? 'Шукаємо...' : 'Знайти'}
              </button>
            </form>
          ) : (
            <form
              onSubmit={handleCarSearchSubmit}
              className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-3 p-3 rounded-xl"
              style={{ background: '#FFFFFF' }}
            >
              <select
                value={carMake}
                onChange={(e) => setCarMake(e.target.value)}
                className="flex-1 px-3 py-3.5 text-base rounded-lg outline-none"
                style={{ color: carMake ? '#14181F' : '#8A93A2', background: '#F7F8FA' }}
              >
                <option value="">Марка авто</option>
                {carMakeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <select
                value={carYear}
                onChange={(e) => setCarYear(e.target.value)}
                disabled={!carMake}
                className="flex-1 px-3 py-3.5 text-base rounded-lg outline-none disabled:opacity-50"
                style={{ color: carYear ? '#14181F' : '#8A93A2', background: '#F7F8FA' }}
              >
                <option value="">Рік</option>
                {carYearOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <select
                value={carEngineVolume}
                onChange={(e) => setCarEngineVolume(e.target.value)}
                disabled={!carYear}
                className="flex-1 px-3 py-3.5 text-base rounded-lg outline-none disabled:opacity-50"
                style={{ color: carEngineVolume ? '#14181F' : '#8A93A2', background: '#F7F8FA' }}
              >
                <option value="">Об&apos;єм двигуна</option>
                {carEngineOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                disabled={searching || !carMake}
                className="px-8 py-3.5 rounded-lg text-base font-semibold disabled:opacity-50 shrink-0"
                style={{ background: '#EA580C', color: '#FFFFFF' }}
              >
                {searching ? 'Шукаємо...' : 'Знайти'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ==================== РЕЗУЛЬТАТЫ ПОИСКА ==================== */}
      {hasSearched && (
        <section className="max-w-6xl mx-auto px-5 md:px-8 py-12">
          <h2 className="text-xl font-semibold mb-1">
            Результати пошуку: «{submittedQuery}»
          </h2>
          <div className="flex items-center justify-between mb-6 gap-4">
            <p className="text-sm" style={{ color: '#5B6472' }}>
              {searching ? 'Шукаємо...' : `Знайдено: ${results.length}`}
            </p>

            {/* ---- перемикач вигляду: плиткою або таблицею ---- */}
            {!searching && results.length > 0 && (
              <div className="flex gap-1 p-1 rounded-lg shrink-0" style={{ background: '#EEF0F3' }}>
                <button
                  type="button"
                  onClick={() => changeViewMode('grid')}
                  aria-label="Показати плиткою"
                  title="Плиткою"
                  className="p-1.5 rounded-md"
                  style={viewMode === 'grid' ? { background: '#FFFFFF', color: '#EA580C' } : { color: '#8A93A2' }}
                >
                  <GridViewIcon />
                </button>
                <button
                  type="button"
                  onClick={() => changeViewMode('table')}
                  aria-label="Показати таблицею"
                  title="Таблицею"
                  className="p-1.5 rounded-md"
                  style={viewMode === 'table' ? { background: '#FFFFFF', color: '#EA580C' } : { color: '#8A93A2' }}
                >
                  <TableViewIcon />
                </button>
              </div>
            )}
          </div>

          {searchError && (
            <p className="text-sm p-4 rounded-lg" style={{ background: '#FEE2E2', color: '#DC2626' }}>
              {searchError}
            </p>
          )}

          {!searching && !searchError && results.length === 0 && (
            <div
              className="text-center py-14 px-6 rounded-xl"
              style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}
            >
              <div className="text-4xl mb-3">🔍</div>
              <h3 className="text-lg font-semibold mb-2">За вашим запитом нічого не знайдено</h3>
              <p className="text-sm mb-6" style={{ color: '#5B6472' }}>
                Перевірте правильність артикула або залиште заявку — наші менеджери підберуть деталь вручну.
              </p>
              <button
                type="button"
                className="px-6 py-3 rounded-lg text-sm font-semibold"
                style={{ background: '#EA580C', color: '#FFFFFF' }}
              >
                Залишити заявку на підбір
              </button>
            </div>
          )}

          {!searching && results.length > 0 && viewMode === 'grid' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {results.map((product) => (
                <div
                  key={product.id}
                  className="p-4 rounded-xl flex flex-col gap-3"
                  style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}
                >
                  <div
                    className="w-full aspect-square rounded-lg flex items-center justify-center overflow-hidden"
                    style={{ background: '#F1EAE0' }}
                  >
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name || product.article} className="w-full h-full object-cover" />
                    ) : (
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ color: '#C9BFAF' }}>
                        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                        <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M21 16l-5-5-4 4-2-2-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-mono mb-1" style={{ color: '#8A93A2' }}>
                      {product.article}
                      {product.brand ? ` · ${product.brand}` : ''}
                    </p>
                    <p className="text-sm font-medium leading-snug">{product.name || 'Без назви'}</p>
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span
                      className="text-xs px-2 py-1 rounded-full font-medium"
                      style={
                        product.stock > 0
                          ? { background: '#DCFCE7', color: '#16A34A' }
                          : { background: '#FEE2E2', color: '#DC2626' }
                      }
                    >
                      {product.stock > 0 ? `В наявності: ${product.stock}` : 'Немає в наявності'}
                    </span>
                    <span className="text-base font-semibold">{formatMoney(product.retailPrice)} грн</span>
                  </div>

                  <button
                    type="button"
                    disabled={product.stock <= 0}
                    onClick={() => addToCart(product)}
                    className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-40"
                    style={{ background: '#EA580C', color: '#FFFFFF' }}
                  >
                    До кошика
                  </button>
                </div>
              ))}
            </div>
          )}

          {!searching && results.length > 0 && viewMode === 'table' && (
            <div className="rounded-xl overflow-x-auto" style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}>
              <table className="w-full text-sm" style={{ minWidth: '640px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E5EA' }}>
                    {['Товар', 'Артикул', 'Наявність', 'Ціна', ''].map((heading) => (
                      <th
                        key={heading}
                        className="text-left px-4 py-3 text-xs font-medium whitespace-nowrap"
                        style={{ color: '#8A93A2' }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((product) => (
                    <tr key={product.id} style={{ borderBottom: '1px solid #F0F1F3' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div
                            className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center overflow-hidden"
                            style={{ background: '#F1EAE0' }}
                          >
                            {product.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.imageUrl}
                                alt={product.name || product.article}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: '#C9BFAF' }}>
                                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                                <path d="M21 16l-5-5-4 4-2-2-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span className="text-sm font-medium leading-snug">{product.name || 'Без назви'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono whitespace-nowrap" style={{ color: '#8A93A2' }}>
                        {product.article}
                        {product.brand ? ` · ${product.brand}` : ''}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium"
                          style={
                            product.stock > 0
                              ? { background: '#DCFCE7', color: '#16A34A' }
                              : { background: '#FEE2E2', color: '#DC2626' }
                          }
                        >
                          {product.stock > 0 ? `В наявності: ${product.stock}` : 'Немає в наявності'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatMoney(product.retailPrice)} грн
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={product.stock <= 0}
                          onClick={() => addToCart(product)}
                          className="px-4 py-2 rounded-md text-xs font-medium disabled:opacity-40"
                          style={{ background: '#EA580C', color: '#FFFFFF' }}
                        >
                          До кошика
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ==================== ПРЕИМУЩЕСТВА ==================== */}
      <section className="max-w-6xl mx-auto px-5 md:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <BenefitCard
            icon={<TruckIcon />}
            title="Швидка доставка"
            description="Відправляємо замовлення в день оформлення по всій Україні"
          />
          <BenefitCard
            icon={<CheckIcon />}
            title="Оригінальні запчастини"
            description="Працюємо тільки з перевіреними постачальниками та брендами"
          />
          <BenefitCard
            icon={<CarIcon />}
            title="Підбір за VIN"
            description="Не знайшли за артикулом? Надішліть VIN — підберемо точно"
          />
        </div>
      </section>

      <footer className="py-8 text-center text-xs" style={{ color: '#8A93A2' }}>
        © {new Date().getFullYear()} {shopName} — автозапчастини з доставкою по Україні
      </footer>
    </div>
  );
}

// ------------------------------------------------------------
// ПАНЕЛЬ КОРЗИНЫ (Sidebar) И ФОРМА ОФОРМЛЕНИЯ ЗАКАЗА
// ------------------------------------------------------------

// Пропсы CartDrawer — сознательно все "плоские" (без объекта cart-
// логики целиком), чтобы сама панель оставалась чистым отображением
// состояния, а вся логика (изменение количества, отправка формы)
// оставалась в StorefrontHome
interface CartDrawerProps {
  cart: CartItem[];
  cartTotal: number;
  cartCount: number;
  orderStatus: 'idle' | 'submitting' | 'success';
  orderError: string | null;
  createdOrderId: string | null;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  city: string;
  novaPoshtaAddress: string;
  comment: string;
  nameError: string | null;
  surnameError: string | null;
  phoneError: string | null;
  cityError: string | null;
  addressError: string | null;
  onNameChange: (value: string) => void;
  onSurnameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onNameBlur: () => void;
  onSurnameBlur: () => void;
  onPhoneBlur: () => void;
  onCityBlur: () => void;
  onAddressBlur: () => void;
  onIncrement: (id: string) => void;
  onDecrement: (id: string) => void;
  onRemove: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}

// Общий стиль для полей формы доставки — вынесен в одну функцию,
// чтобы не повторять один и тот же объект стилей пять раз подряд
function fieldStyle(hasError: boolean): React.CSSProperties {
  return {
    background: '#F7F8FA',
    border: `1px solid ${hasError ? '#DC2626' : '#E2E5EA'}`,
  };
}

function CartDrawer({
  cart,
  cartTotal,
  cartCount,
  orderStatus,
  orderError,
  createdOrderId,
  customerName,
  customerSurname,
  customerPhone,
  city,
  novaPoshtaAddress,
  comment,
  nameError,
  surnameError,
  phoneError,
  cityError,
  addressError,
  onNameChange,
  onSurnameChange,
  onPhoneChange,
  onCityChange,
  onAddressChange,
  onCommentChange,
  onNameBlur,
  onSurnameBlur,
  onPhoneBlur,
  onCityBlur,
  onAddressBlur,
  onIncrement,
  onDecrement,
  onRemove,
  onSubmit,
  onClose,
}: CartDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Затемнение фона — клик по нему закрывает панель, так же как и крестик */}
      <div className="absolute inset-0" style={{ background: 'rgba(15, 23, 42, 0.5)' }} onClick={onClose} />

      <div className="relative w-full max-w-md h-full flex flex-col" style={{ background: '#FFFFFF' }}>
        {/* Шапка панели */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid #E2E5EA' }}
        >
          <h2 className="text-lg font-semibold">Кошик{cartCount > 0 ? ` (${cartCount})` : ''}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити кошик"
            className="p-1.5 rounded-md"
            style={{ color: '#5B6472' }}
          >
            <CloseIcon />
          </button>
        </div>

        {orderStatus === 'success' ? (
          <OrderSuccessScreen orderId={createdOrderId} onClose={onClose} />
        ) : cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div style={{ color: '#C9BFAF' }}>
              <CartIcon />
            </div>
            <h3 className="text-base font-semibold mt-4 mb-1.5">Кошик порожній</h3>
            <p className="text-sm" style={{ color: '#8A93A2' }}>
              Знайдіть потрібну деталь за артикулом і додайте її сюди.
            </p>
          </div>
        ) : (
          // Вся форма — список товаров И поля доставки — обёрнута в
          // ОДИН <form>: так нажатие Enter в любом поле или клик по
          // кнопке "Підтвердити замовлення" отправляют ровно один и тот
          // же handleSubmitOrder. Сам <form> растягивается на всю
          // высоту (flex-1) и делится на два блока: прокручиваемое тело
          // (min-h-0 обязателен — иначе flex-контейнер не даст дочернему
          // overflow-y-auto ужаться и скролл не заработает) и прибитый
          // снизу футер с итогом и кнопкой
          <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 min-h-0">
              {cart.map((item) => (
                <CartRow
                  key={item.id}
                  item={item}
                  onIncrement={() => onIncrement(item.id)}
                  onDecrement={() => onDecrement(item.id)}
                  onRemove={() => onRemove(item.id)}
                />
              ))}

              <div className="pt-3 mt-1 flex flex-col gap-3" style={{ borderTop: '1px solid #E2E5EA' }}>
                <h3 className="text-sm font-semibold">Дані для доставки</h3>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => onNameChange(e.target.value)}
                      onBlur={onNameBlur}
                      placeholder="Ім'я"
                      className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none"
                      style={fieldStyle(!!nameError)}
                    />
                    {nameError && (
                      <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                        {nameError}
                      </p>
                    )}
                  </div>

                  <div>
                    <input
                      type="text"
                      value={customerSurname}
                      onChange={(e) => onSurnameChange(e.target.value)}
                      onBlur={onSurnameBlur}
                      placeholder="Прізвище"
                      className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none"
                      style={fieldStyle(!!surnameError)}
                    />
                    {surnameError && (
                      <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                        {surnameError}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => onPhoneChange(e.target.value)}
                    onBlur={onPhoneBlur}
                    placeholder="Номер телефону"
                    className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none"
                    style={fieldStyle(!!phoneError)}
                  />
                  {phoneError && (
                    <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                      {phoneError}
                    </p>
                  )}
                </div>

                <div>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => onCityChange(e.target.value)}
                    onBlur={onCityBlur}
                    placeholder="Місто"
                    className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none"
                    style={fieldStyle(!!cityError)}
                  />
                  {cityError && (
                    <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                      {cityError}
                    </p>
                  )}
                </div>

                <div>
                  <input
                    type="text"
                    value={novaPoshtaAddress}
                    onChange={(e) => onAddressChange(e.target.value)}
                    onBlur={onAddressBlur}
                    placeholder="Адреса відділення Нової Пошти"
                    className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none"
                    style={fieldStyle(!!addressError)}
                  />
                  {addressError && (
                    <p className="text-xs mt-1" style={{ color: '#DC2626' }}>
                      {addressError}
                    </p>
                  )}
                </div>

                <div>
                  {/* Комментарий — единственное необязательное поле,
                      поэтому у него нет ни error-подсветки, ни звёздочки */}
                  <textarea
                    value={comment}
                    onChange={(e) => onCommentChange(e.target.value)}
                    placeholder="Коментар до замовлення (необов'язково)"
                    rows={2}
                    className="w-full px-3.5 py-2.5 rounded-md text-sm outline-none resize-none"
                    style={fieldStyle(false)}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3 shrink-0" style={{ borderTop: '1px solid #E2E5EA' }}>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>Разом</span>
                <span>{formatMoney(cartTotal)} грн</span>
              </div>

              {orderError && (
                <p className="text-xs p-2.5 rounded-md" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                  {orderError}
                </p>
              )}

              <button
                type="submit"
                disabled={orderStatus === 'submitting'}
                className="w-full py-3 rounded-lg text-sm font-semibold disabled:opacity-60"
                style={{ background: '#EA580C', color: '#FFFFFF' }}
              >
                {orderStatus === 'submitting' ? 'Відправка...' : 'Підтвердити замовлення'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// Одна строка товара внутри панели корзины: название/артикул/бренд,
// счётчик количества с кнопками +/-, цена за штуку и сумма по строке
function CartRow({
  item,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  item: CartItem;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}) {
  const atStockLimit = item.quantity >= item.stock;

  return (
    <div className="flex items-start gap-3 pb-3" style={{ borderBottom: '1px solid #F0F1F3' }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{item.name}</p>
        <p className="text-xs mt-0.5" style={{ color: '#8A93A2' }}>
          {item.article}
          {item.brand ? ` · ${item.brand}` : ''}
        </p>

        <div className="flex items-center gap-2 mt-2.5">
          <button
            type="button"
            onClick={onDecrement}
            disabled={item.quantity <= 1}
            aria-label="Зменшити кількість"
            className="w-6 h-6 rounded flex items-center justify-center text-sm font-semibold disabled:opacity-30"
            style={{ background: '#F1F2F4', color: '#14181F' }}
          >
            −
          </button>
          <span className="text-sm w-5 text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={onIncrement}
            disabled={atStockLimit}
            aria-label="Збільшити кількість"
            className="w-6 h-6 rounded flex items-center justify-center text-sm font-semibold disabled:opacity-30"
            style={{ background: '#F1F2F4', color: '#14181F' }}
          >
            +
          </button>
          <span className="text-xs ml-1" style={{ color: '#8A93A2' }}>
            × {formatMoney(item.price)} грн
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-2 shrink-0">
        <span className="text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatMoney(item.price * item.quantity)} грн
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Видалити товар з кошика"
          className="p-1 rounded"
          style={{ color: '#DC2626' }}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// Экран "Дякуємо за замовлення!" — показывается вместо списка товаров
// сразу после того, как заказ успешно создан на бэкенде. orderId — то,
// что вернул POST /api/orders/create; показываем первые 8 символов
// UUID, точно в том же формате (#хххххххх), что и в списке заказов
// админ-панели (см. shortId() в components/OrdersScreen.tsx) — так
// менеджер сможет быстро найти этот заказ по номеру, который назовёт
// клиент
function OrderSuccessScreen({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
        style={{ background: '#DCFCE7', color: '#16A34A' }}
      >
        <CheckIcon />
      </div>
      <h3 className="text-lg font-semibold mb-2">Дякуємо за замовлення!</h3>
      <p className="text-sm mb-1" style={{ color: '#5B6472' }}>
        Номер вашого замовлення:{' '}
        <span className="font-semibold" style={{ color: '#14181F' }}>
          №{orderId ? orderId.slice(0, 8) : ''}
        </span>
      </p>
      <p className="text-sm mb-6" style={{ color: '#5B6472' }}>
        Ми зв&apos;яжемося з вами найближчим часом.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="px-6 py-3 rounded-lg text-sm font-semibold"
        style={{ background: '#EA580C', color: '#FFFFFF' }}
      >
        Продовжити покупки
      </button>
    </div>
  );
}

// ------------------------------------------------------------
// МЕЛКИЕ КОМПОНЕНТЫ ОФОРМЛЕНИЯ
// ------------------------------------------------------------

function BenefitCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-5 rounded-xl flex items-start gap-4" style={{ background: '#FFFFFF', border: '1px solid #E2E5EA' }}>
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: '#FFF1E8', color: '#EA580C' }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1">{title}</h3>
        <p className="text-xs" style={{ color: '#5B6472' }}>
          {description}
        </p>
      </div>
    </div>
  );
}

// Простые инлайн-иконки (без внешних библиотек) — так проект
// не тянет за собой ещё одну зависимость только ради значков
function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: '#8A93A2' }}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L21 8H6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="20" r="1.5" fill="currentColor" />
      <circle cx="17" cy="20" r="1.5" fill="currentColor" />
    </svg>
  );
}

function GridViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function TableViewIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M9 10v10" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.4-3.8 4.2-5.8 7.5-5.8s6.1 2 7.5 5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 7h12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path
        d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.2c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2 2.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M2 6h11v9H2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 10h4l4 3v2h-8z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="18" r="1.8" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 12.5 9.5 18 20 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 16V11l2-5h12l2 5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M2 16h20v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M5 11h14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
