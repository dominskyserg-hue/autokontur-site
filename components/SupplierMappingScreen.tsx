'use client';

// ============================================================
// Экран "Поставщики и маппинг Excel" — подключённый к настоящему
// бэкенду (без localStorage).
//
// Использует эндпоинты:
//   GET  /api/stats                  — цифры для карточек статистики
//   GET  /api/suppliers              — список поставщиков + маппинг
//   POST /api/suppliers              — создать поставщика (без id
//                                       в теле запроса) ИЛИ обновить
//                                       существующего (с id в теле) —
//                                       используется и для сохранения
//                                       формы, и для переключателя
//                                       "Активен / На паузе" в списке
//   POST /api/suppliers/parse-excel  — загрузить и разобрать
//                                       Excel-файл выбранного поставщика
//
// Форма слева объединяет контакты, маппинг колонок Excel и наценку
// в одном месте: пока поставщик не выбран из списка справа — это
// форма создания нового; как только выбрали существующего — та же
// форма превращается в форму редактирования (заголовок и кнопка
// меняются, снизу появляется блок загрузки прайс-листа).
//
// 'use client' в самом верху обязателен: компонент использует
// хуки (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import AdminLayout from './AdminLayout';

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface MappingData {
  article: string;
  brand: string | null;
  name: string | null;
  price: string;
  stock: string | null;
  carMake: string | null;
  carModel: string | null;
  carYear: string | null;
  engineVolume: string | null;
  startRow: number;
  markup: number;
  updatedAt: string;
}

interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
  lastSyncedAt: string | null;
  mapping: MappingData | null;
}

interface Stats {
  suppliersCount: number;
  activeSuppliersCount: number;
  mappedSuppliersCount: number;
  averageMarkup: number;
  productsCount: number;
}

const LOCAL_CURRENCY = 'UAH';
const CURRENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: LOCAL_CURRENCY, label: 'Местная (UAH)' },
  { value: 'USD', label: 'USD — доллар США' },
  { value: 'EUR', label: 'EUR — евро' },
];

// Форма создания/редактирования поставщика — всё одной структурой,
// значения строками, пока форма редактируется (числа переводим только
// перед отправкой на сервер)
interface FormState {
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  article: string;
  brand: string;
  partName: string;
  price: string;
  stock: string;
  // Колонки марки/модели/года/объёма двигателя авто — необязательный
  // SEO-раздел формы (см. ниже секцию "SEO"), нужны, чтобы карточку
  // товара можно было найти по запросу вида "втулка стабилизатора на
  // тойоту", а год/объём — ещё и для поиска "Підбір за автомобілем"
  // на витрине (components/StorefrontHome.tsx)
  carMake: string;
  carModel: string;
  carYear: string;
  engineVolume: string;
  startRow: string;
  markup: string;
  currency: string;
}

const EMPTY_FORM: FormState = {
  companyName: '',
  contactName: '',
  phone: '',
  email: '',
  article: '',
  brand: '',
  partName: '',
  price: '',
  stock: '',
  carMake: '',
  carModel: '',
  carYear: '',
  engineVolume: '',
  startRow: '1',
  markup: '0',
  currency: LOCAL_CURRENCY,
};

// ------------------------------------------------------------
// МЕЛКИЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ОФОРМЛЕНИЯ
// ------------------------------------------------------------

// Инициалы для аватарки в списке поставщиков — первые буквы первых
// двух "слов" названия компании, без кавычек и прочих символов
function getInitials(name: string): string {
  const words = name
    .replace(/[«»"'.,]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
}

// Палитра цветов аватарок — цвет выбирается детерминированно по id
// поставщика, поэтому у одного и того же поставщика цвет не "прыгает"
// между перезагрузками страницы
const AVATAR_PALETTE = [
  { bg: '#22305A', fg: '#8FA8FF' },
  { bg: '#332157', fg: '#B79CFF' },
  { bg: '#4A3018', fg: '#F2A65A' },
  { bg: '#153A30', fg: '#4FD1A5' },
  { bg: '#442231', fg: '#F27FA0' },
];

function pickAvatarColor(id: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

// "сегодня, 14:05" / "вчера, 14:05" / "03.02.2026" — коротко и понятно,
// без лишней точности до секунд
function formatDateTimeLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) {
    return `сегодня, ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `вчера, ${time}`;
  }

  return date.toLocaleDateString('ru-RU');
}

export default function SupplierMappingScreen() {
  // ---- статистика для карточек наверху (GET /api/stats) ----
  const [stats, setStats] = useState<Stats | null>(null);

  // ---- список поставщиков (GET /api/suppliers) ----
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- какой поставщик сейчас выбран в списке справа. Пустая строка
  // означает "никто не выбран" — форма слева работает как форма
  // создания нового поставщика ----
  const [selectedId, setSelectedId] = useState<string>('');

  // ---- переключатели "Активен/На паузе", которые сейчас сохраняются —
  // чтобы показать спиннер именно у той карточки, которую нажали, а
  // не блокировать весь список ----
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // ---- объединённая форма: контакты + маппинг + наценка ----
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaved, setFormSaved] = useState(false);

  // ---- загрузка Excel-файла (доступна только для уже созданного
  // поставщика, то есть когда selectedId не пустой) ----
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ addedCount: number; updatedCount: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // ЗАГРУЗКА СПИСКА ПОСТАВЩИКОВ И СТАТИСТИКИ
  // ------------------------------------------------------------
  const fetchSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/suppliers');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить список поставщиков');
      }
      setSuppliers(data.suppliers as Supplier[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке поставщиков');
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/stats');
      const data = await response.json();
      if (response.ok) {
        setStats(data as Stats);
      }
    } catch {
      // Карточки статистики не критичны для работы экрана — если не
      // получилось их загрузить, просто оставляем прочерки, без
      // отдельного сообщения об ошибке поверх всего интерфейса
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
    fetchStats();
  }, [fetchSuppliers, fetchStats]);

  const selectedSupplier = suppliers.find((s) => s.id === selectedId) || null;
  const isCreateMode = selectedId === '';

  // Заполняем форму данными выбранного поставщика (или очищаем её,
  // если выбор сброшен на "Новый поставщик"). Зависимость именно от
  // selectedId (строки), а не от объекта selectedSupplier — иначе
  // эффект срабатывал бы повторно на каждое обновление списка
  // (например, сразу после сохранения), сбрасывая formSaved обратно
  // в false до того, как пользователь успеет увидеть сообщение
  useEffect(() => {
    if (!selectedSupplier) {
      setForm(EMPTY_FORM);
    } else {
      const m = selectedSupplier.mapping;
      setForm({
        companyName: selectedSupplier.name,
        contactName: selectedSupplier.contactName || '',
        phone: selectedSupplier.phone || '',
        email: selectedSupplier.email || '',
        article: m?.article || '',
        brand: m?.brand || '',
        partName: m?.name || '',
        price: m?.price || '',
        stock: m?.stock || '',
        carMake: m?.carMake || '',
        carModel: m?.carModel || '',
        carYear: m?.carYear || '',
        engineVolume: m?.engineVolume || '',
        startRow: m ? String(m.startRow) : '1',
        markup: m ? String(m.markup) : '0',
        currency: selectedSupplier.currency,
      });
    }
    setSelectedFile(null);
    setUploadResult(null);
    setUploadError(null);
    setFormSaved(false);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ------------------------------------------------------------
  // СОХРАНЕНИЕ ФОРМЫ — POST /api/suppliers (создание или обновление)
  // ------------------------------------------------------------
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormSaved(false);

    if (!form.companyName.trim()) {
      setFormError('Укажите название поставщика');
      return;
    }
    if (!form.phone.trim() && !form.email.trim()) {
      setFormError('Укажите телефон или email');
      return;
    }

    // Маппинг колонок — необязателен целиком, но если заполнили хотя
    // бы "Артикул" или "Цену поставщика", то нужны оба поля сразу
    const hasAnyMappingField = Boolean(form.article.trim() || form.price.trim());
    if (hasAnyMappingField && (!form.article.trim() || !form.price.trim())) {
      setFormError('В маппинге укажите обе колонки — и "Артикул", и "Цена поставщика" (или обе оставьте пустыми)');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: isCreateMode ? undefined : selectedId,
          name: form.companyName,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
          email: form.email || undefined,
          currency: form.currency,
          mapping: hasAnyMappingField
            ? {
                article: form.article,
                brand: form.brand || undefined,
                name: form.partName || undefined,
                price: form.price,
                stock: form.stock || undefined,
                carMake: form.carMake || undefined,
                carModel: form.carModel || undefined,
                carYear: form.carYear || undefined,
                engineVolume: form.engineVolume || undefined,
                startRow: parseInt(form.startRow, 10) || 1,
                markup: parseFloat(form.markup) || 0,
              }
            : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить поставщика');
      }

      await Promise.all([fetchSuppliers(), fetchStats()]);
      // После создания нового поставщика сразу переключаемся в режим
      // редактирования — так сразу становится доступна загрузка прайса
      setSelectedId(data.supplier.id as string);
      setFormSaved(true);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Ошибка сети при сохранении поставщика');
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------------------------------
  // ПЕРЕКЛЮЧЕНИЕ "АКТИВЕН / НА ПАУЗЕ" — клик по бейджу в списке
  // ------------------------------------------------------------
  const handleToggleActive = async (supplier: Supplier) => {
    setTogglingIds((prev) => new Set(prev).add(supplier.id));
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: supplier.id,
          name: supplier.name,
          contactName: supplier.contactName || undefined,
          phone: supplier.phone || undefined,
          email: supplier.email || undefined,
          currency: supplier.currency,
          isActive: !supplier.isActive,
          // mapping не передаём — существующие настройки маппинга
          // остаются нетронутыми (см. app/api/suppliers/route.ts)
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось изменить статус поставщика');
      }
      // Статус учитывается в карточке "Поставщиков" (счётчик активных/на
      // паузе), поэтому обновляем и список, и статистику разом
      await Promise.all([fetchSuppliers(), fetchStats()]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при изменении статуса поставщика');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(supplier.id);
        return next;
      });
    }
  };

  // ------------------------------------------------------------
  // ЗАГРУЗКА EXCEL-ФАЙЛА — POST FormData /api/suppliers/parse-excel
  // ------------------------------------------------------------
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] || null);
    setUploadResult(null);
    setUploadError(null);
  };

  const handleUploadExcel = async () => {
    setUploadError(null);
    setUploadResult(null);

    if (!selectedSupplier) {
      setUploadError('Сначала сохраните поставщика');
      return;
    }
    if (!selectedFile) {
      setUploadError('Сначала выберите файл Excel');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('supplierId', selectedSupplier.id);
      formData.append(
        'mapping',
        JSON.stringify({
          article: form.article,
          brand: form.brand,
          name: form.partName,
          price: form.price,
          stock: form.stock,
          carMake: form.carMake,
          carModel: form.carModel,
          carYear: form.carYear,
          engineVolume: form.engineVolume,
          startRow: parseInt(form.startRow, 10) || 1,
          markup: parseFloat(form.markup) || 0,
        })
      );

      // Заголовок Content-Type специально НЕ проставляем вручную —
      // браузер сам добавит "multipart/form-data" с правильным boundary
      const response = await fetch('/api/suppliers/parse-excel', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось обработать файл');
      }

      setUploadResult({ addedCount: data.addedCount, updatedCount: data.updatedCount });
      setSelectedFile(null);
      await Promise.all([fetchSuppliers(), fetchStats()]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке файла');
    } finally {
      setUploading(false);
    }
  };

  const canUpload = Boolean(selectedSupplier) && Boolean(selectedFile) && !uploading;
  const totalProcessed = uploadResult ? uploadResult.addedCount + uploadResult.updatedCount : 0;

  // Время самого свежего импорта среди ВСЕХ поставщиков — для подписи
  // под карточкой "Позиций загружено"
  const lastImportOverall = useMemo(() => {
    const dates = suppliers.map((s) => s.lastSyncedAt).filter((d): d is string => Boolean(d));
    if (dates.length === 0) return null;
    return dates.reduce((latest, current) => (new Date(current) > new Date(latest) ? current : latest));
  }, [suppliers]);

  const pausedCount = stats ? stats.suppliersCount - stats.activeSuppliersCount : 0;
  const allMapped = stats ? stats.suppliersCount > 0 && stats.mappedSuppliersCount === stats.suppliersCount : false;

  return (
    <AdminLayout active="suppliers">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Поставщики
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Поставщики и маппинг Excel</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Экран подключён к настоящему API: поставщики хранятся в PostgreSQL, а не в localStorage браузера.
        </p>
      </header>

      {/* ==================== КАРТОЧКИ СТАТИСТИКИ ==================== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Поставщиков</p>
          <p className="text-2xl font-semibold">{stats ? stats.suppliersCount : '—'}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
            {stats ? `${stats.activeSuppliersCount} активных, ${pausedCount} на паузе` : ''}
          </p>
        </div>

        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Маппинг настроен</p>
          <p className="text-2xl font-semibold">
            {stats ? `${stats.mappedSuppliersCount} / ${stats.suppliersCount}` : '—'}
          </p>
          <p className="text-[11px] mt-1" style={{ color: allMapped ? 'var(--good)' : 'var(--ink-faint)' }}>
            {stats
              ? allMapped
                ? 'Все прайсы читаются корректно'
                : 'Есть поставщики без маппинга'
              : ''}
          </p>
        </div>

        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Средняя наценка</p>
          <p className="text-2xl font-semibold">{stats ? `${stats.averageMarkup}%` : '—'}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>по всем поставщикам</p>
        </div>

        <div className="p-4 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--ink-muted)' }}>Позиций загружено</p>
          <p className="text-2xl font-semibold">{stats ? stats.productsCount.toLocaleString('ru-RU') : '—'}</p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
            {lastImportOverall ? `последний импорт — ${formatDateTimeLabel(lastImportOverall)}` : 'загрузок ещё не было'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-6 items-start">
        {/* ==================== ФОРМА СОЗДАНИЯ / РЕДАКТИРОВАНИЯ ==================== */}
        <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-base font-semibold">
              {isCreateMode ? 'Новый поставщик' : `Поставщик: ${selectedSupplier?.name}`}
            </h2>
            {!isCreateMode && (
              <button
                type="button"
                onClick={() => setSelectedId('')}
                className="text-xs px-3 py-1.5 rounded-md shrink-0"
                style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
              >
                + Новый поставщик
              </button>
            )}
          </div>
          <p className="text-xs mb-5" style={{ color: 'var(--ink-muted)' }}>
            Контакты, настройки маппинга Excel-прайса и наценка — одной формой.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* ---- 1. Контактные данные ---- */}
            <div>
              <p className="text-[11px] font-semibold tracking-wider mb-3" style={{ color: 'var(--ink-faint)' }}>
                1&nbsp;&nbsp;КОНТАКТНЫЕ ДАННЫЕ
              </p>
              <div className="flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Название поставщика *
                  </label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder='ООО «АвтоЗапчасть Плюс»'
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      Контактное лицо
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-sm rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      placeholder="Иван Петров"
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      Телефон
                    </label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      placeholder="+380 50 000-00-00"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    className="w-full px-3 py-2 text-sm rounded-md font-mono"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder="opt@postavshik.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* ---- 2. Маппинг колонок Excel ---- */}
            <div className="pt-5" style={{ borderTop: '1px dashed var(--line)' }}>
              <p className="text-[11px] font-semibold tracking-wider mb-3" style={{ color: 'var(--ink-faint)' }}>
                2&nbsp;&nbsp;МАППИНГ КОЛОНОК EXCEL
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-2">
                {(
                  [
                    ['article', 'Артикул *'],
                    ['brand', 'Бренд'],
                    ['partName', 'Название'],
                    ['price', 'Цена *'],
                    ['stock', 'Остаток'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      {label}
                    </label>
                    <input
                      type="text"
                      maxLength={3}
                      className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      value={form[field]}
                      onChange={(e) => setForm({ ...form, [field]: e.target.value.toUpperCase() })}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Укажите букву колонки (A, B, C...) или её номер (1, 2, 3...) в файле поставщика.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-3.5">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Начинать со строки
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    value={form.startRow}
                    onChange={(e) => setForm({ ...form, startRow: e.target.value })}
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                    Строки выше пропускаются — обычно это заголовки таблицы.
                  </p>
                </div>
              </div>
            </div>

            {/* ---- 3. Данные авто: марка/модель/год/объём (необязательно) ---- */}
            <div className="pt-5" style={{ borderTop: '1px dashed var(--line)' }}>
              <p className="text-[11px] font-semibold tracking-wider mb-1" style={{ color: 'var(--ink-faint)' }}>
                3&nbsp;&nbsp;ДЛЯ КАКОГО АВТО ДЕТАЛЬ
              </p>
              <p className="text-[11px] mb-3" style={{ color: 'var(--ink-faint)' }}>
                Необязательно. Если в прайсе есть такие колонки — укажите их здесь:
                тогда карточку товара можно будет найти по запросу вида «втулка
                стабилизатора на тойоту», а на витрине заработает «Підбір за
                автомобілем» (пошук за маркою, роком і об'ємом двигуна).
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Марка авто
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder="напр. H"
                    value={form.carMake}
                    onChange={(e) => setForm({ ...form, carMake: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Модель авто
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder="напр. I"
                    value={form.carModel}
                    onChange={(e) => setForm({ ...form, carModel: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Год авто
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder="напр. J"
                    value={form.carYear}
                    onChange={(e) => setForm({ ...form, carYear: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Объём двигателя
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase text-center"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    placeholder="напр. K"
                    value={form.engineVolume}
                    onChange={(e) => setForm({ ...form, engineVolume: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
            </div>

            {/* ---- 4. Наценка и валюта ---- */}
            <div className="pt-5" style={{ borderTop: '1px dashed var(--line)' }}>
              <p className="text-[11px] font-semibold tracking-wider mb-3" style={{ color: 'var(--ink-faint)' }}>
                4&nbsp;&nbsp;НАЦЕНКА И ВАЛЮТА
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Наценка, %
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="w-full px-3 py-2 text-sm rounded-md font-mono"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    value={form.markup}
                    onChange={(e) => setForm({ ...form, markup: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Валюта прайса
                  </label>
                  <select
                    className="w-full px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  >
                    {CURRENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[11px] mt-2" style={{ color: 'var(--ink-faint)' }}>
                Розничная цена считается так: (цена из Excel × глобальный курс валюты) × (1 + наценка / 100).
                Курс иностранной валюты задаётся один раз в Настройках.
              </p>
            </div>

            {formError && (
              <p className="text-xs" style={{ color: 'var(--bad)' }}>
                {formError}
              </p>
            )}
            {formSaved && !formError && (
              <p className="text-xs" style={{ color: 'var(--good)' }}>
                Сохранено
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              {saving ? 'Сохранение...' : isCreateMode ? 'Создать поставщика' : 'Сохранить изменения'}
            </button>
          </form>

          {/* ---- 4. Загрузка прайс-листа — только для уже созданного поставщика ---- */}
          {!isCreateMode && (
            <div className="mt-6 pt-5" style={{ borderTop: '1px dashed var(--line)' }}>
              <p className="text-[11px] font-semibold tracking-wider mb-3" style={{ color: 'var(--ink-faint)' }}>
                5&nbsp;&nbsp;ЗАГРУЗКА ПРАЙСА
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <label
                  className="text-sm px-3.5 py-2 rounded-md cursor-pointer"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                >
                  Выбрать файл
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                </label>
                <span className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                  {selectedFile ? selectedFile.name : 'файл не выбран'}
                </span>

                <button
                  type="button"
                  disabled={!canUpload}
                  onClick={handleUploadExcel}
                  className="text-sm px-4 py-2 rounded-md disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {uploading ? 'Загрузка...' : 'Загрузить прайс'}
                </button>
              </div>

              {uploadError && (
                <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                  {uploadError}
                </p>
              )}

              {uploadResult && (
                <p
                  className="text-sm mt-3 p-3 rounded-md"
                  style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
                >
                  Успешно обработано товаров: {totalProcessed} (Добавлено: {uploadResult.addedCount}, Обновлено:{' '}
                  {uploadResult.updatedCount})
                </p>
              )}
            </div>
          )}
        </section>

        {/* ==================== СПИСОК ПОСТАВЩИКОВ ==================== */}
        <section className="p-5 rounded-lg" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          <h2 className="text-base font-semibold mb-1">Действующие поставщики</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
            Статус синхронизации и наценка. Клик по карточке — открыть в редакторе слева.
          </p>

          {loadError && (
            <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
              {loadError}{' '}
              <button type="button" onClick={fetchSuppliers} className="underline">
                Повторить
              </button>
            </p>
          )}

          {loadingSuppliers ? (
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Загрузка списка...
            </p>
          ) : suppliers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Пока нет ни одного поставщика — создайте первого в форме слева.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {suppliers.map((supplier) => {
                const avatarColor = pickAvatarColor(supplier.id);
                const isSelected = supplier.id === selectedId;
                const isToggling = togglingIds.has(supplier.id);

                return (
                  <li key={supplier.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(supplier.id)}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedId(supplier.id)}
                      className="w-full text-left p-3 rounded-md cursor-pointer flex items-start gap-3"
                      style={{
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--line)'}`,
                        background: isSelected ? 'var(--accent-soft)' : 'var(--surface-2)',
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                        style={{ background: avatarColor.bg, color: avatarColor.fg }}
                      >
                        {getInitials(supplier.name)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate">{supplier.name}</p>
                          <button
                            type="button"
                            disabled={isToggling}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive(supplier);
                            }}
                            className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 disabled:opacity-50"
                            style={{
                              background: supplier.isActive ? 'var(--good-soft)' : 'var(--warn-soft)',
                              color: supplier.isActive ? 'var(--good)' : 'var(--warn)',
                            }}
                            title="Нажмите, чтобы переключить статус"
                          >
                            {isToggling ? '...' : supplier.isActive ? 'Активен' : 'На паузе'}
                          </button>
                        </div>
                        {supplier.contactName && (
                          <p className="text-xs truncate" style={{ color: 'var(--ink-muted)' }}>
                            {supplier.contactName}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-[11px] px-1.5 py-0.5 rounded font-mono"
                            style={{ background: 'var(--surface)', color: 'var(--ink-faint)' }}
                          >
                            {supplier.mapping ? `+${supplier.mapping.markup}%` : 'маппинг не настроен'}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                            {supplier.lastSyncedAt
                              ? `синхр. ${formatDateTimeLabel(supplier.lastSyncedAt)}`
                              : 'прайс ещё не загружали'}
                          </span>
                        </div>
                        <a
                          href={`/admin/suppliers/${supplier.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] underline mt-1 inline-block"
                          style={{ color: 'var(--accent)' }}
                        >
                          Товары поставщика →
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
