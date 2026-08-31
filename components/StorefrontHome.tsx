'use client';

// ============================================================
// Главная страница витрины интернет-магазина автозапчастей —
// то, что видит обычный покупатель (не путать с админ-панелью,
// она теперь живёт под /admin, см. components/AdminLayout.tsx).
//
// Визуальный стиль — "Wasteland" (индустриальный, по мотивам
// реального логотипа DOMINATOR PARTS): тёмная палитра, красный +
// жовтий акценти, шрифти Bebas Neue/Rajdhani/Barlow (подключены
// через Google Fonts в app/layout.tsx), смуга небезпеки під
// шапкою, зернистість фону, зрізаний кут у карток товару.
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
import { CATEGORIES } from '@/lib/categories';
import { CAR_MAKES } from '@/lib/carMakes';
import { FAQ_ITEMS } from '@/lib/faq';
import { decodeVin } from '@/lib/vinDecode';

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
const DEFAULT_SHOP_NAME = 'DominatorParts';
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

// ------------------------------------------------------------
// ПАЛІТРА "WORKSHOP" — світліший варіант фірмового стилю DOMINATOR
// PARTS (раніше був темний "Wasteland" — теплий кремовий фон замість
// майже чорного, щоб ціни, кнопки й товари було легше сканувати
// оком: для інтернет-магазину це напряму впливає на конверсію.
// Бренд-акценти (червоний, лого) лишились ті самі.
//
// TEXT — новий: основний текст на світлому тлі (раніше цю роль
// виконував PAPER, який водночас був і "світлою поверхнею" — на
// темному тлі обидві ролі співпадали за кольором, на світлому вже
// ні, тому роль розділено на TEXT (текст) і PANEL (поверхня)
// ------------------------------------------------------------
const BG = '#FAF7F2';
const PANEL = '#FFFFFF';
const PANEL_SOFT = '#F1EBE0';
const IMG_PLACEHOLDER_BG = '#EAE2D3';
const BORDER = '#E3DAC9';
const RED = '#E5231C';
const YELLOW = '#B45309';
const TEXT = '#1C1917';
const MUTED = '#6B6560';
const FAINT = '#78716C';
const SUCCESS_BG = '#DCFCE7';
const SUCCESS_TEXT = '#15803D';
const DANGER_BG = '#FEE2E2';
const DANGER_TEXT = '#B91C1C';
const INK = '#15100E';

const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const LABEL_FONT = "'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

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

  // ---- FAQ-акордеон (lib/faq.ts) ----
  // Питання/відповіді ті самі, що й у розмітці FAQPage (JSON-LD) у
  // app/page.tsx — тут лише інтерактивність (розгорнути/згорнути),
  // сам текст спільний
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

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

  // ---- заявка "Підбір за VIN" ----
  const [vinModalOpen, setVinModalOpen] = useState(false);
  const [vinCode, setVinCode] = useState('');
  const [vinPhone, setVinPhone] = useState('');
  const [vinDescription, setVinDescription] = useState('');
  const [vinSubmitting, setVinSubmitting] = useState(false);
  const [vinError, setVinError] = useState<string | null>(null);
  const [vinSubmitted, setVinSubmitted] = useState(false);

  // Розшифровка VIN "на льоту" (lib/vinDecode.ts) — повністю офлайн,
  // без жодного запиту на сервер. Поки покупець ще не ввів усі 17
  // символів, decodeVin() сам поверне { make: null, year: null } —
  // тому окремо перевіряти довжину тут не потрібно
  const vinDecoded = useMemo(() => decodeVin(vinCode), [vinCode]);

  const closeVinModal = () => {
    setVinModalOpen(false);
    // Скидаємо форму й повідомлення про успіх ЗАВЖДИ при закритті —
    // щоб наступного разу, коли покупець відкриє це саме вікно
    // (наприклад, щоб лишити ще одну заявку), воно було чистим
    setVinCode('');
    setVinPhone('');
    setVinDescription('');
    setVinError(null);
    setVinSubmitted(false);
  };

  const handleSubmitVinRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!vinCode.trim() || vinCode.trim().length < 5) {
      setVinError('Вкажіть VIN-код автомобіля');
      return;
    }
    if (!isValidPhone(vinPhone)) {
      setVinError('Введіть коректний номер телефону');
      return;
    }
    if (!vinDescription.trim()) {
      setVinError('Опишіть, яку деталь ви шукаєте');
      return;
    }

    setVinSubmitting(true);
    setVinError(null);
    try {
      const response = await fetch('/api/vin-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vinCode: vinCode.trim(),
          phone: vinPhone.trim(),
          description: vinDescription.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не вдалося надіслати заявку');
      }
      setVinSubmitted(true);
    } catch (error) {
      setVinError(error instanceof Error ? error.message : 'Помилка мережі під час надсилання заявки');
    } finally {
      setVinSubmitting(false);
    }
  };

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

  // ---- перехід із SEO-сторінок категорій (?article=...) ----
  // Сторінки /category/[slug] (app/category/[slug]/page.tsx) ведуть
  // сюди з конкретним артикулом обраного товару — одразу виконуємо
  // пошук за ним, щоб покупець не вводив артикул вручну ще раз.
  // window.location.search замість useSearchParams() — щоб не тягнути
  // Suspense-обгортку заради єдиного разового читання параметра при
  // завантаженні сторінки
  useEffect(() => {
    const articleFromUrl = new URLSearchParams(window.location.search).get('article');
    if (!articleFromUrl) return;
    setSearchMode('article');
    setSearchInput(articleFromUrl);
    runSearch(new URLSearchParams({ search: articleFromUrl, pageSize: '24' }), articleFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="min-h-screen relative" style={{ background: BG, color: TEXT, fontFamily: BODY_FONT }}>
      {/* тонка зернистість по всій сторінці — фірмова текстура "Wasteland" */}
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.05, pointerEvents: 'none', zIndex: 0 }}
      >
        <filter id="dp-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#dp-grain)" />
      </svg>

      <div className="relative" style={{ zIndex: 1 }}>
        {/* ==================== ОБЪЯВЛЕНИЯ ==================== */}
        {/* Настраиваются в админке /admin/settings (см. AnnouncementsManager) —
            показываем только те, что админ явно включил. Если объявлений
            несколько, выводим все подряд узкими полосками */}
        {announcements.map((announcement) => (
          <div
            key={announcement.id}
            className="text-center text-xs md:text-sm py-2 px-4 font-semibold"
            style={{ background: RED, color: INK }}
          >
            {announcement.text}
          </div>
        ))}

        {/* ==================== ШАПКА ==================== */}
        <header style={{ borderBottom: `2px solid ${RED}` }}>
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <DominatorMark />
              <div>
                <div
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 24,
                    lineHeight: 0.9,
                    letterSpacing: '0.01em',
                    transform: 'skewX(-6deg)',
                  }}
                >
                  {shopName.toUpperCase()}
                </div>
                <div
                  className="text-[11px] uppercase tracking-widest font-semibold"
                  style={{ fontFamily: LABEL_FONT, color: YELLOW }}
                >
                  Команда професіоналів
                </div>
              </div>
            </div>

            <div
              className="hidden md:flex items-center gap-2 text-sm uppercase tracking-wide"
              style={{ fontFamily: LABEL_FONT, color: MUTED }}
            >
              <PhoneIcon />
              <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} style={{ color: MUTED }}>
                {phone}
              </a>
              <span style={{ color: BORDER }}>◆</span>
              <span>{workingHours}</span>
            </div>

            <div className="flex items-center gap-2.5">
              {/* ---- Категорії деталей ---- */}
              {/* Внутрішнє посилання на /category — потрібне не тільки
                  покупцю, а й Google: саме через такі посилання з
                  Головної пошуковик знаходить нові SEO-сторінки категорій
                  (див. app/category/[slug]/page.tsx) */}
              <Link
                href="/category"
                className="hidden sm:flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ fontFamily: LABEL_FONT, border: `2px solid ${BORDER}`, color: MUTED }}
              >
                <span>Категорії</span>
              </Link>

              {/* ---- Марки авто ---- */}
              {/* Те саме, що й "Категорії" вище, але для сторінок
                  /marky/[slug] (див. lib/carMakes.ts) — сховано на
                  вужчих екранах поруч із "Категорії", щоб шапка не
                  переповнювалась */}
              <Link
                href="/marky"
                className="hidden lg:flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ fontFamily: LABEL_FONT, border: `2px solid ${BORDER}`, color: MUTED }}
              >
                <span>Марки авто</span>
              </Link>

              {/* ---- Особистий кабінет ---- */}
              <Link
                href="/account"
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ fontFamily: LABEL_FONT, border: `2px solid ${YELLOW}`, color: YELLOW }}
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
                className="relative flex items-center gap-2 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide"
                style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
              >
                <CartIcon />
                <span className="hidden sm:inline">Кошик</span>
                {cartCount > 0 && (
                  <span
                    className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center"
                    style={{ background: YELLOW, color: INK }}
                  >
                    {cartCount}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>

        {/* смуга небезпеки — фірмовий елемент "Wasteland" */}
        <div
          style={{
            height: 8,
            background: `repeating-linear-gradient(-45deg, ${RED}, ${RED} 18px, ${YELLOW} 18px, ${YELLOW} 36px)`,
          }}
        />

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

        {/* ==================== МОДАЛЬНЕ ВІКНО "ПІДБІР ЗА VIN" ==================== */}
        {vinModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0" style={{ background: 'rgba(21, 16, 14, 0.72)' }} onClick={closeVinModal} />

            <div className="relative w-full max-w-md overflow-hidden" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
              <div
                className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                <h2 className="text-lg" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
                  Підбір за VIN
                </h2>
                <button
                  type="button"
                  onClick={closeVinModal}
                  aria-label="Закрити"
                  className="p-1.5"
                  style={{ color: MUTED }}
                >
                  <CloseIcon />
                </button>
              </div>

              {vinSubmitted ? (
                <div className="flex flex-col items-center text-center px-8 py-10">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mb-5"
                    style={{ background: SUCCESS_BG, color: SUCCESS_TEXT }}
                  >
                    <CheckIcon />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Дякуємо за заявку!</h3>
                  <p className="text-sm mb-6" style={{ color: MUTED }}>
                    Ми зв&apos;яжемося з вами найближчим часом і підберемо потрібну деталь за
                    VIN-кодом.
                  </p>
                  <button
                    type="button"
                    onClick={closeVinModal}
                    className="px-6 py-3 text-sm font-bold uppercase tracking-wide"
                    style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                  >
                    Закрити
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmitVinRequest} className="px-5 py-5 flex flex-col gap-3">
                  <p className="text-xs" style={{ color: MUTED }}>
                    Не знайшли деталь за артикулом? Залиште VIN-код автомобіля й опишіть, що
                    шукаєте — наш менеджер підбере деталь вручну і зв&apos;яжеться з вами.
                  </p>

                  <input
                    type="text"
                    value={vinCode}
                    onChange={(e) => setVinCode(e.target.value.toUpperCase())}
                    placeholder="VIN-код, напр. WVWZZZ1JZXW000001"
                    className="w-full px-3.5 py-2.5 text-sm font-mono outline-none placeholder:text-[#8A7F70]"
                    style={{ background: PANEL_SOFT, border: `1px solid ${BORDER}`, color: TEXT }}
                  />

                  {/* Розшифровка VIN "на льоту" — без запиту на сервер
                      (lib/vinDecode.ts). З'являється одразу, як тільки
                      розпізнано марку по перших символах VIN, і дає
                      миттєвий результат замість очікування дзвінка
                      менеджера */}
                  {vinDecoded.make && (
                    <div
                      className="flex items-center justify-between gap-3 p-3 text-sm"
                      style={{ background: SUCCESS_BG, color: SUCCESS_TEXT }}
                    >
                      <span>
                        Схоже, це <strong>{vinDecoded.make}</strong>
                        {vinDecoded.year ? `, прибл. ${vinDecoded.year} р.` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const params = new URLSearchParams({ carMake: vinDecoded.make as string, pageSize: '24' });
                          setSearchMode('car');
                          setCarMake(vinDecoded.make as string);
                          runSearch(params, vinDecoded.make as string);
                          closeVinModal();
                        }}
                        className="shrink-0 px-3 py-1.5 text-xs font-bold uppercase tracking-wide whitespace-nowrap"
                        style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                      >
                        Показати запчастини
                      </button>
                    </div>
                  )}

                  <input
                    type="tel"
                    value={vinPhone}
                    onChange={(e) => setVinPhone(e.target.value)}
                    placeholder="Номер телефону"
                    className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                    style={{ background: PANEL_SOFT, border: `1px solid ${BORDER}`, color: TEXT }}
                  />

                  <textarea
                    value={vinDescription}
                    onChange={(e) => setVinDescription(e.target.value)}
                    placeholder="Що шукаєте? Наприклад: гальмівні колодки передні"
                    rows={3}
                    className="w-full px-3.5 py-2.5 text-sm outline-none resize-none placeholder:text-[#8A7F70]"
                    style={{ background: PANEL_SOFT, border: `1px solid ${BORDER}`, color: TEXT }}
                  />

                  {vinError && (
                    <p className="text-xs p-2.5" style={{ background: DANGER_BG, color: DANGER_TEXT }}>
                      {vinError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={vinSubmitting}
                    className="w-full py-3 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
                    style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                  >
                    {vinSubmitting ? 'Надсилаємо...' : 'Надіслати заявку'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* ==================== HERO + ПОИСК ==================== */}
        <section className="relative overflow-hidden">
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-16 md:py-24 relative text-center">
            <div
              className="text-xs md:text-sm font-semibold uppercase tracking-[0.2em] mb-4"
              style={{ fontFamily: LABEL_FONT, color: YELLOW }}
            >
              ⚠ Понад 20 000 запчастин у наявності ⚠
            </div>
            <h1
              className="text-4xl md:text-6xl lg:text-7xl mb-5 leading-[0.92]"
              style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em', transform: 'skewX(-2deg)', textWrap: 'balance' }}
            >
              ДОРОГА НЕ ПРОБАЧАЄ
              <br />
              СЛАБКИХ ДЕТАЛЕЙ
            </h1>
            <p className="text-sm md:text-base mb-9 max-w-xl mx-auto" style={{ color: MUTED }}>
              {shopName} — деталі, перевірені бездоріжжям. Знайдіть потрібну за артикулом
              або підберіть деталь за вашим автомобілем.
            </p>

            {/* ---- перемикач режиму пошуку ---- */}
            <div className="max-w-2xl mx-auto flex gap-1 p-1 mb-3" style={{ background: PANEL_SOFT }}>
              <button
                type="button"
                onClick={() => setSearchMode('article')}
                className="flex-1 py-2 text-sm font-semibold uppercase tracking-wide transition-colors"
                style={
                  searchMode === 'article'
                    ? { fontFamily: LABEL_FONT, background: PANEL, color: INK }
                    : { fontFamily: LABEL_FONT, background: 'transparent', color: MUTED }
                }
              >
                За артикулом
              </button>
              <button
                type="button"
                onClick={() => setSearchMode('car')}
                className="flex-1 py-2 text-sm font-semibold uppercase tracking-wide transition-colors"
                style={
                  searchMode === 'car'
                    ? { fontFamily: LABEL_FONT, background: PANEL, color: INK }
                    : { fontFamily: LABEL_FONT, background: 'transparent', color: MUTED }
                }
              >
                За автомобілем
              </button>
            </div>

            {searchMode === 'article' ? (
              <form
                onSubmit={handleSearchSubmit}
                className="max-w-2xl mx-auto flex flex-col sm:flex-row"
                style={{ background: PANEL }}
              >
                <div className="flex-1 flex items-center gap-2.5 px-4">
                  <SearchIcon />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Наприклад: 555-66 або AB 12"
                    className="w-full py-4 text-base outline-none bg-transparent placeholder:text-[#8A7F70]"
                    style={{ color: INK }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !searchInput.trim()}
                  className="px-8 py-4 text-sm font-bold uppercase tracking-wide disabled:opacity-50 shrink-0"
                  style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                >
                  {searching ? 'Шукаємо...' : 'Знайти'}
                </button>
              </form>
            ) : (
              <form
                onSubmit={handleCarSearchSubmit}
                className="max-w-2xl mx-auto flex flex-col sm:flex-row gap-2 p-2"
                style={{ background: PANEL }}
              >
                <select
                  value={carMake}
                  onChange={(e) => setCarMake(e.target.value)}
                  className="flex-1 px-3 py-3.5 text-base bg-transparent outline-none"
                  style={{ color: carMake ? INK : '#8A7F70' }}
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
                  className="flex-1 px-3 py-3.5 text-base bg-transparent outline-none disabled:opacity-50"
                  style={{ color: carYear ? INK : '#8A7F70' }}
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
                  className="flex-1 px-3 py-3.5 text-base bg-transparent outline-none disabled:opacity-50"
                  style={{ color: carEngineVolume ? INK : '#8A7F70' }}
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
                  className="px-8 py-3.5 text-sm font-bold uppercase tracking-wide disabled:opacity-50 shrink-0"
                  style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
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
            <h2 className="text-xl md:text-2xl mb-1" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
              Результати пошуку: «{submittedQuery}»
            </h2>
            <div className="flex items-center justify-between mb-6 gap-4">
              <p className="text-sm" style={{ color: MUTED }}>
                {searching ? 'Шукаємо...' : `Знайдено: ${results.length}`}
              </p>

              {/* ---- перемикач вигляду: плиткою або таблицею ---- */}
              {!searching && results.length > 0 && (
                <div className="flex gap-1 p-1 shrink-0" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    onClick={() => changeViewMode('grid')}
                    aria-label="Показати плиткою"
                    title="Плиткою"
                    className="p-1.5"
                    style={viewMode === 'grid' ? { background: RED, color: INK } : { color: MUTED }}
                  >
                    <GridViewIcon />
                  </button>
                  <button
                    type="button"
                    onClick={() => changeViewMode('table')}
                    aria-label="Показати таблицею"
                    title="Таблицею"
                    className="p-1.5"
                    style={viewMode === 'table' ? { background: RED, color: INK } : { color: MUTED }}
                  >
                    <TableViewIcon />
                  </button>
                </div>
              )}
            </div>

            {searchError && (
              <p className="text-sm p-4" style={{ background: DANGER_BG, color: DANGER_TEXT }}>
                {searchError}
              </p>
            )}

            {!searching && !searchError && results.length === 0 && (
              <div
                className="text-center py-14 px-6"
                style={{ background: PANEL, border: `1px solid ${BORDER}` }}
              >
                <div className="text-4xl mb-3">🔍</div>
                <h3 className="text-lg font-semibold mb-2">За вашим запитом нічого не знайдено</h3>
                <p className="text-sm mb-6" style={{ color: MUTED }}>
                  Перевірте правильність артикула або залиште заявку — наші менеджери підберуть деталь вручну.
                </p>
                <button
                  type="button"
                  onClick={() => setVinModalOpen(true)}
                  className="px-6 py-3 text-sm font-bold uppercase tracking-wide"
                  style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                >
                  Залишити заявку на підбір
                </button>
              </div>
            )}

            {!searching && results.length > 0 && viewMode === 'grid' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {results.map((product) => (
                  <div
                    key={product.id}
                    className="p-4 flex flex-col gap-3"
                    style={{
                      background: PANEL,
                      border: `1px solid ${BORDER}`,
                      clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)',
                    }}
                  >
                    <div
                      className="w-full aspect-square flex items-center justify-center overflow-hidden"
                      style={{ background: IMG_PLACEHOLDER_BG }}
                    >
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt={product.name || product.article} className="w-full h-full object-cover" />
                      ) : (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ color: '#5A4C40' }}>
                          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                          <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                          <path d="M21 16l-5-5-4 4-2-2-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-mono uppercase tracking-wide mb-1" style={{ fontFamily: LABEL_FONT, color: YELLOW }}>
                        {product.article}
                        {product.brand ? ` · ${product.brand}` : ''}
                      </p>
                      <p className="text-sm font-medium leading-snug">{product.name || 'Без назви'}</p>
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <span
                        className="text-xs px-2 py-1 font-medium"
                        style={
                          product.stock > 0
                            ? { background: SUCCESS_BG, color: SUCCESS_TEXT }
                            : { background: DANGER_BG, color: DANGER_TEXT }
                        }
                      >
                        {product.stock > 0 ? `В наявності: ${product.stock}` : 'Немає в наявності'}
                      </span>
                      <span style={{ fontFamily: DISPLAY_FONT, fontSize: 22 }}>{formatMoney(product.retailPrice)} ГРН</span>
                    </div>

                    <button
                      type="button"
                      disabled={product.stock <= 0}
                      onClick={() => addToCart(product)}
                      className="w-full py-2.5 text-sm font-bold uppercase tracking-wide disabled:opacity-40"
                      style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
                    >
                      До кошика
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!searching && results.length > 0 && viewMode === 'table' && (
              <div className="overflow-x-auto" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
                <table className="w-full text-sm" style={{ minWidth: '640px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                      {['Товар', 'Артикул', 'Наявність', 'Ціна', ''].map((heading) => (
                        <th
                          key={heading}
                          className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
                          style={{ fontFamily: LABEL_FONT, color: MUTED }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((product) => (
                      <tr key={product.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 min-w-[200px]">
                            <div
                              className="w-11 h-11 shrink-0 flex items-center justify-center overflow-hidden"
                              style={{ background: IMG_PLACEHOLDER_BG }}
                            >
                              {product.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={product.imageUrl}
                                  alt={product.name || product.article}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ color: '#5A4C40' }}>
                                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                                  <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.6" />
                                  <path d="M21 16l-5-5-4 4-2-2-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <span className="text-sm font-medium leading-snug">{product.name || 'Без назви'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs font-mono font-bold whitespace-nowrap" style={{ color: YELLOW }}>
                          {product.article}
                          {product.brand ? ` · ${product.brand}` : ''}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className="text-xs px-2 py-1 font-medium"
                            style={
                              product.stock > 0
                                ? { background: SUCCESS_BG, color: SUCCESS_TEXT }
                                : { background: DANGER_BG, color: DANGER_TEXT }
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
                            className="px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-40"
                            style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
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
              onClick={() => setVinModalOpen(true)}
            />
          </div>
        </section>

        {/* ==================== КАТЕГОРІЇ ДЕТАЛЕЙ ==================== */}
        {/* Список посилань на SEO-сторінки категорій (app/category/[slug]) —
            і зручність для покупця, і сигнал для Google приходити сюди
            за новими сторінками */}
        <section className="max-w-6xl mx-auto px-5 md:px-8 pb-10">
          <h2
            className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ fontFamily: LABEL_FONT, color: MUTED }}
          >
            Популярні категорії
          </h2>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <Link
                key={c.slug}
                href={`/category/${c.slug}`}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{ border: `1px solid ${BORDER}`, color: MUTED }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>

        {/* ==================== МАРКИ АВТО ==================== */}
        {/* Те саме, що й блок категорій вище, але для сторінок
            /marky/[slug] (lib/carMakes.ts) — список складений за
            реальними марками з каталогу, а не довільний */}
        <section className="max-w-6xl mx-auto px-5 md:px-8 pb-10">
          <h2
            className="text-sm font-semibold uppercase tracking-wide mb-3"
            style={{ fontFamily: LABEL_FONT, color: MUTED }}
          >
            Популярні марки авто
          </h2>
          <div className="flex flex-wrap gap-2">
            {CAR_MAKES.map((m) => (
              <Link
                key={m.slug}
                href={`/marky/${m.slug}`}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{ border: `1px solid ${BORDER}`, color: MUTED }}
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>

        {/* ==================== FAQ ==================== */}
        {/* Текст питань/відповідей — з lib/faq.ts, ТОЧНО той самий, що
            й у розмітці FAQPage (JSON-LD) в app/page.tsx: Google звіряє
            видимий текст із структурованими даними, і розбіжність може
            коштувати розширеного сніппета у видачі */}
        <section className="max-w-3xl mx-auto px-5 md:px-8 pb-14">
          <h2
            className="text-2xl md:text-3xl mb-6"
            style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
          >
            Питання, які нам часто задають
          </h2>
          <div className="flex flex-col gap-2">
            {FAQ_ITEMS.map((item, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div key={item.question} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="w-full flex items-center justify-between gap-4 py-4 text-left text-sm font-semibold"
                    style={{ fontFamily: LABEL_FONT, color: TEXT }}
                    aria-expanded={isOpen}
                  >
                    <span>{item.question}</span>
                    <span style={{ color: YELLOW, fontSize: 20, lineHeight: 1 }}>{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && (
                    <p className="pb-4 text-sm" style={{ color: MUTED }}>
                      {item.answer}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <footer className="py-8 text-center text-xs" style={{ color: FAINT }}>
          © {new Date().getFullYear()} {shopName} — автозапчастини з доставкою по Україні
        </footer>
      </div>
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
    background: PANEL_SOFT,
    border: `1px solid ${hasError ? DANGER_TEXT : BORDER}`,
    color: TEXT,
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
      <div className="absolute inset-0" style={{ background: 'rgba(21, 16, 14, 0.72)' }} onClick={onClose} />

      <div className="relative w-full max-w-md h-full flex flex-col" style={{ background: PANEL, borderLeft: `1px solid ${BORDER}` }}>
        {/* Шапка панели */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <h2 className="text-lg" style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.01em' }}>
            Кошик{cartCount > 0 ? ` (${cartCount})` : ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити кошик"
            className="p-1.5"
            style={{ color: MUTED }}
          >
            <CloseIcon />
          </button>
        </div>

        {orderStatus === 'success' ? (
          <OrderSuccessScreen orderId={createdOrderId} onClose={onClose} />
        ) : cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
            <div style={{ color: BORDER }}>
              <CartIcon />
            </div>
            <h3 className="text-base font-semibold mt-4 mb-1.5">Кошик порожній</h3>
            <p className="text-sm" style={{ color: FAINT }}>
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

              <div className="pt-3 mt-1 flex flex-col gap-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ fontFamily: LABEL_FONT }}>
                  Дані для доставки
                </h3>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => onNameChange(e.target.value)}
                      onBlur={onNameBlur}
                      placeholder="Ім'я"
                      className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                      style={fieldStyle(!!nameError)}
                    />
                    {nameError && (
                      <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
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
                      className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                      style={fieldStyle(!!surnameError)}
                    />
                    {surnameError && (
                      <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
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
                    className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                    style={fieldStyle(!!phoneError)}
                  />
                  {phoneError && (
                    <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
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
                    className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                    style={fieldStyle(!!cityError)}
                  />
                  {cityError && (
                    <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
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
                    className="w-full px-3.5 py-2.5 text-sm outline-none placeholder:text-[#8A7F70]"
                    style={fieldStyle(!!addressError)}
                  />
                  {addressError && (
                    <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
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
                    className="w-full px-3.5 py-2.5 text-sm outline-none resize-none placeholder:text-[#8A7F70]"
                    style={fieldStyle(false)}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3 shrink-0" style={{ borderTop: `1px solid ${BORDER}` }}>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="uppercase tracking-wide" style={{ fontFamily: LABEL_FONT }}>
                  Разом
                </span>
                <span style={{ fontFamily: DISPLAY_FONT, fontSize: 20 }}>{formatMoney(cartTotal)} ГРН</span>
              </div>

              {orderError && (
                <p className="text-xs p-2.5" style={{ background: DANGER_BG, color: DANGER_TEXT }}>
                  {orderError}
                </p>
              )}

              <button
                type="submit"
                disabled={orderStatus === 'submitting'}
                className="w-full py-3 text-sm font-bold uppercase tracking-wide disabled:opacity-60"
                style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
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
    <div className="flex items-start gap-3 pb-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{item.name}</p>
        <p className="text-xs mt-0.5 font-mono" style={{ color: YELLOW }}>
          {item.article}
          {item.brand ? ` · ${item.brand}` : ''}
        </p>

        <div className="flex items-center gap-2 mt-2.5">
          <button
            type="button"
            onClick={onDecrement}
            disabled={item.quantity <= 1}
            aria-label="Зменшити кількість"
            className="w-6 h-6 flex items-center justify-center text-sm font-semibold disabled:opacity-30"
            style={{ background: PANEL_SOFT, color: TEXT }}
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
            className="w-6 h-6 flex items-center justify-center text-sm font-semibold disabled:opacity-30"
            style={{ background: PANEL_SOFT, color: TEXT }}
          >
            +
          </button>
          <span className="text-xs ml-1" style={{ color: FAINT }}>
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
          className="p-1"
          style={{ color: DANGER_TEXT }}
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
        style={{ background: SUCCESS_BG, color: SUCCESS_TEXT }}
      >
        <CheckIcon />
      </div>
      <h3 className="text-lg font-semibold mb-2">Дякуємо за замовлення!</h3>
      <p className="text-sm mb-1" style={{ color: MUTED }}>
        Номер вашого замовлення:{' '}
        <span className="font-semibold" style={{ color: TEXT }}>
          №{orderId ? orderId.slice(0, 8) : ''}
        </span>
      </p>
      <p className="text-sm mb-6" style={{ color: MUTED }}>
        Ми зв&apos;яжемося з вами найближчим часом.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="px-6 py-3 text-sm font-bold uppercase tracking-wide"
        style={{ fontFamily: LABEL_FONT, background: RED, color: INK }}
      >
        Продовжити покупки
      </button>
    </div>
  );
}

// ------------------------------------------------------------
// МЕЛКИЕ КОМПОНЕНТЫ ОФОРМЛЕНИЯ
// ------------------------------------------------------------

function BenefitCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div
        className="w-11 h-11 flex items-center justify-center shrink-0"
        style={{ background: 'rgba(229,35,28,0.12)', color: RED }}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-1 uppercase tracking-wide" style={{ fontFamily: LABEL_FONT }}>
          {title}
        </h3>
        <p className="text-xs" style={{ color: MUTED }}>
          {description}
        </p>
      </div>
    </>
  );

  // onClick переданий лише для картки "Підбір за VIN" — вона відкриває
  // форму заявки, тому рендериться як справжня кнопка, а не просто
  // <div>: так картка стає доступною і з клавіатури (Tab + Enter), а
  // не тільки мишкою
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="p-5 flex items-start gap-4 text-left w-full"
        style={{ background: PANEL, border: `1px solid ${BORDER}`, cursor: 'pointer' }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="p-5 flex items-start gap-4" style={{ background: PANEL, border: `1px solid ${BORDER}` }}>
      {content}
    </div>
  );
}

// Логотип-марка DOMINATOR PARTS: шестерня + поршень + пружина —
// намальовано вручну inline SVG (без зовнішніх залежностей чи
// растрового файлу логотипу), впізнавана форма реального лого бренду
function DominatorMark() {
  return (
    <svg viewBox="0 0 120 120" width="42" height="42" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="42" stroke={RED} strokeWidth="7" />
      <g fill={RED}>
        <rect x="54" y="4" width="12" height="18" />
        <rect x="54" y="98" width="12" height="18" />
        <rect x="4" y="54" width="18" height="12" />
        <rect x="98" y="54" width="18" height="12" />
        <rect x="54" y="4" width="12" height="18" transform="rotate(45 60 60)" />
        <rect x="54" y="4" width="12" height="18" transform="rotate(135 60 60)" />
        <rect x="54" y="4" width="12" height="18" transform="rotate(225 60 60)" />
        <rect x="54" y="4" width="12" height="18" transform="rotate(315 60 60)" />
      </g>
      <rect x="50" y="22" width="20" height="16" rx="2" fill={RED} />
      <g stroke={RED} strokeWidth="5" fill="none" strokeLinecap="round">
        <line x1="60" y1="38" x2="60" y2="50" />
        <path d="M52 50 L68 50 L52 58 L68 58 L52 66 L68 66 L52 74 L68 74" />
      </g>
      <circle cx="60" cy="84" r="4" fill={RED} />
    </svg>
  );
}

// Простые инлайн-иконки (без внешних библиотек) — так проект
// не тянет за собой ещё одну зависимость только ради значков
function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: FAINT }}>
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
