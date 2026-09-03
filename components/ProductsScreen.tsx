'use client';

// ============================================================
// Экран "Товары" — управление каталогом. Показывает ВСЕ товары,
// загруженные из прайс-листов всех поставщиков разом, с поиском,
// фильтром по поставщику, постраничной навигацией и точечным
// редактированием цены/остатка прямо из таблицы.
//
// Использует эндпоинты:
//   GET   /api/products        — список товаров (пагинация + поиск +
//                                 фильтр по поставщику)
//   PATCH /api/products/[id]   — изменить розничную цену и/или
//                                 остаток одного товара
//   GET   /api/suppliers       — только для выпадающего списка
//                                 фильтра (берём id и название)
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import AdminLayout from './AdminLayout';

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд
// ------------------------------------------------------------
interface Product {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  // Марка/модель авто и SEO-описание — см. app/api/suppliers/parse-excel/route.ts
  // (buildSeoFields): заполняются автоматически при загрузке прайса,
  // если у поставщика в Excel есть колонки марки/модели
  carMake: string | null;
  carModel: string | null;
  metaDescription: string | null;
  // Фото товара — ссылка или data:-URI загруженной картинки (см.
  // app/api/products/[id]/route.ts). null — фото ещё не задано
  imageUrl: string | null;
  costPrice: number;
  retailPrice: number;
  stock: number;
  supplierId: string;
  supplierName: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

// Для выпадающего списка фильтра нужны только id и название —
// остальные поля поставщика здесь не используются
interface SupplierOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 50;

// Сколько миллисекунд ждать после последнего нажатия клавиши в поле
// поиска, прежде чем реально отправить запрос — без этого запрос
// улетал бы на каждую напечатанную букву
const SEARCH_DEBOUNCE_MS = 350;

// Копейки не показываем — только целые гривны, округлённые ВВЕРХ
function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

export default function ProductsScreen() {
  // ---- список поставщиков для фильтра ----
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  // ---- поиск: то, что печатает пользователь, и то, что реально
  // ушло в запрос (с задержкой — см. SEARCH_DEBOUNCE_MS) ----
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ---- фильтр по поставщику ('' — показать все) ----
  const [supplierFilter, setSupplierFilter] = useState('');

  // ---- пагинация ----
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  // ---- сами товары ----
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- редактирование одного товара (мини-форма в модальном окне) ----
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editRetailPrice, setEditRetailPrice] = useState('');
  const [editStock, setEditStock] = useState('');
  // SEO-описание — необязательная ручная правка автосгенерированного
  // текста (см. app/api/suppliers/parse-excel/route.ts). После правки
  // повторная загрузка прайса больше не перезаписывает это поле
  const [editMetaDescription, setEditMetaDescription] = useState('');
  // Фото — либо ссылка (вставлена вручную), либо data:-URI
  // загруженного файла. Одно и то же поле хранит оба варианта —
  // компоненту-получателю (<img src>) неважно, откуда оно
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ---- загрузка файла с компьютера ----
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadFileError, setUploadFileError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // СПИСОК ПОСТАВЩИКОВ ДЛЯ ФИЛЬТРА (загружается один раз)
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
        // Список поставщиков нужен только для фильтра — если он не
        // загрузился, сам каталог товаров всё равно можно смотреть,
        // поэтому отдельную ошибку здесь не показываем
      });
  }, []);

  // ------------------------------------------------------------
  // ЗАДЕРЖКА ПОИСКА (debounce)
  // ------------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Смена поискового запроса или фильтра по поставщику — всегда
  // возвращаемся на первую страницу: иначе легко "зависнуть" на,
  // например, странице 40, где после нового фильтра уже нет товаров
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, supplierFilter]);

  // ------------------------------------------------------------
  // ЗАГРУЗКА СТРАНИЦЫ ТОВАРОВ (GET /api/products)
  // ------------------------------------------------------------
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(PAGE_SIZE));
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (supplierFilter) params.set('supplierId', supplierFilter);

      const response = await fetch(`/api/products?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить список товаров');
      }

      setProducts(data.products as Product[]);
      setPagination(data.pagination as Pagination);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке товаров');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, supplierFilter]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ------------------------------------------------------------
  // РЕДАКТИРОВАНИЕ ТОВАРА — PATCH /api/products/[id]
  // ------------------------------------------------------------
  const openEditModal = (product: Product) => {
    setEditingProduct(product);
    setEditRetailPrice(String(product.retailPrice));
    setEditStock(String(product.stock));
    setEditMetaDescription(product.metaDescription || '');
    setEditImageUrl(product.imageUrl || '');
    setEditError(null);
    setUploadFileError(null);
  };

  const closeEditModal = () => {
    setEditingProduct(null);
    setEditError(null);
  };

  // ------------------------------------------------------------
  // ФОТО: загрузка файла с компьютера — читаем как data:-URI прямо
  // в браузере и просто кладём строку в editImageUrl. Отдельного
  // файлового хранилища в проекте нет, поэтому картинка в итоге
  // сохранится base64-строкой прямо в колонке products.image_url
  // ------------------------------------------------------------
  const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024; // 1.5 МБ — с запасом для TEXT-колонки

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // чтобы повторный выбор того же файла тоже сработал
    if (!file) return;

    setUploadFileError(null);

    if (!file.type.startsWith('image/')) {
      setUploadFileError('Выберите файл изображения (JPG, PNG, WEBP...)');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadFileError('Файл слишком большой — максимум 1.5 МБ');
      return;
    }

    setUploadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      setEditImageUrl(String(reader.result));
      setUploadingFile(false);
    };
    reader.onerror = () => {
      setUploadFileError('Не удалось прочитать файл');
      setUploadingFile(false);
    };
    reader.readAsDataURL(file);
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct) return;

    const retailPrice = parseFloat(editRetailPrice.replace(',', '.'));
    const stock = parseInt(editStock, 10);

    if (!Number.isFinite(retailPrice) || retailPrice < 0) {
      setEditError('Розничная цена должна быть числом не меньше нуля');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setEditError('Остаток должен быть целым числом не меньше нуля');
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      const response = await fetch(`/api/products/${editingProduct.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // metaDescription и imageUrl отправляем всегда (даже пустой
        // строкой) — это осознанная правка админа, а не "поле не менялось"
        body: JSON.stringify({ retailPrice, stock, metaDescription: editMetaDescription, imageUrl: editImageUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить изменения');
      }

      setEditingProduct(null);
      await fetchProducts();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Ошибка сети при сохранении');
    } finally {
      setEditSaving(false);
    }
  };

  const totalPages = pagination?.totalPages ?? 0;

  return (
    <AdminLayout active="products">
      <header className="mb-7">
        <p className="text-xs mb-1.5" style={{ color: 'var(--ink-faint)' }}>
          Админ-панель / Товары
        </p>
        <h1 className="text-2xl font-semibold mb-1.5">Товары</h1>
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          Все товары, загруженные из прайс-листов поставщиков. Найдено: {pagination ? pagination.totalCount : '—'}.
        </p>
      </header>

      {/* ==================== ПОИСК И ФИЛЬТР ==================== */}
      <div
        className="p-4 rounded-lg mb-5 flex flex-wrap gap-3 items-end"
        style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
      >
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Поиск по артикулу, бренду или марке авто
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            placeholder="напр. AB-123, Bosch или Toyota"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>

        <div className="w-64">
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Поставщик
          </label>
          <select
            className="w-full px-3 py-2 text-sm rounded-md"
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="">Все поставщики</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ==================== ТАБЛИЦА ТОВАРОВ ==================== */}
      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        {loadError && (
          <p className="text-xs p-4" style={{ color: 'var(--bad)' }}>
            {loadError}{' '}
            <button type="button" onClick={fetchProducts} className="underline">
              Повторить
            </button>
          </p>
        )}

        {!loadError && loading && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Загрузка...
          </p>
        )}

        {!loadError && !loading && products.length === 0 && (
          <p className="text-xs p-4" style={{ color: 'var(--ink-faint)' }}>
            Ничего не найдено. Попробуйте изменить поиск или фильтр.
          </p>
        )}

        {!loadError && !loading && products.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Фото', 'Артикул', 'Бренд', 'Название', 'Цена поставщика', 'Розничная цена', 'Остаток', 'Поставщик', ''].map(
                    (heading, index, arr) => {
                      // Последняя колонка (кнопка "Редактировать") закреплена
                      // справа (position: sticky) — при горизонтальной прокрутке
                      // широкой таблицы она больше не уезжает за край экрана
                      const isLastColumn = index === arr.length - 1;
                      return (
                        <th
                          key={heading}
                          className="text-left px-4 py-2.5 text-xs font-medium whitespace-nowrap"
                          style={{
                            color: 'var(--ink-muted)',
                            ...(isLastColumn
                              ? { position: 'sticky', right: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)' }
                              : {}),
                          }}
                        >
                          {heading}
                        </th>
                      );
                    }
                  )}
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="px-4 py-2.5">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.imageUrl}
                          alt=""
                          className="w-10 h-10 rounded object-cover"
                          style={{ border: '1px solid var(--line)' }}
                        />
                      ) : (
                        <div
                          className="w-10 h-10 rounded flex items-center justify-center text-[10px]"
                          style={{ background: 'var(--surface-2)', color: 'var(--ink-faint)' }}
                        >
                          —
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{product.article}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {product.brand || '—'}
                    </td>
                    <td className="px-4 py-2.5 max-w-xs" title={product.name || undefined}>
                      <div className="truncate">{product.name || '—'}</div>
                      {(product.carMake || product.carModel) && (
                        <div className="text-[11px] truncate" style={{ color: 'var(--ink-faint)' }}>
                          {[product.carMake, product.carModel].filter(Boolean).join(' ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(product.costPrice)}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{formatMoney(product.retailPrice)}</td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap">{product.stock}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ink-muted)' }}>
                      {product.supplierName}
                    </td>
                    <td
                      className="px-4 py-2.5 whitespace-nowrap text-right"
                      style={{ position: 'sticky', right: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)' }}
                    >
                      <button
                        type="button"
                        onClick={() => openEditModal(product)}
                        className="text-xs px-3 py-1.5 rounded-md"
                        style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)', background: 'var(--surface-2)' }}
                      >
                        Редактировать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ==================== ПАГИНАЦИЯ ==================== */}
      {pagination && pagination.totalCount > 0 && (
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            ← Назад
          </button>

          <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            Страница {pagination.page} из {totalPages}
          </span>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="text-xs px-3 py-1.5 rounded-md disabled:opacity-40"
            style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
          >
            Вперёд →
          </button>
        </div>
      )}

      {/* ==================== МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ==================== */}
      {editingProduct && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={closeEditModal}
        >
          <div
            className="w-full max-w-sm p-5 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            // stopPropagation — чтобы клик ВНУТРИ окна не закрывал его
            // (закрытие навешено на затемнённый фон вокруг, см. выше)
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-1">Редактировать товар</h3>
            <p className="text-xs mb-4 font-mono" style={{ color: 'var(--ink-faint)' }}>
              {editingProduct.article} — {editingProduct.name || 'без названия'}
            </p>

            <form onSubmit={handleEditSubmit} className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Розничная цена
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  value={editRetailPrice}
                  onChange={(e) => setEditRetailPrice(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Остаток
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                />
              </div>

              <div className="pt-2 flex flex-col gap-2.5" style={{ borderTop: '1px dashed var(--line)' }}>
                <label className="block text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
                  Фото товару
                </label>

                <div className="flex items-center gap-3">
                  {editImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={editImageUrl}
                      alt=""
                      className="w-16 h-16 rounded object-cover shrink-0"
                      style={{ border: '1px solid var(--line)' }}
                    />
                  ) : (
                    <div
                      className="w-16 h-16 rounded flex items-center justify-center text-[10px] shrink-0"
                      style={{ background: 'var(--surface-2)', color: 'var(--ink-faint)' }}
                    >
                      немає фото
                    </div>
                  )}

                  <div className="flex-1 flex flex-col gap-1.5">
                    <input
                      type="text"
                      placeholder="Вставте посилання на фото або завантажте файл нижче"
                      className="w-full px-3 py-1.5 text-xs rounded-md"
                      style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                      value={editImageUrl.startsWith('data:') ? '' : editImageUrl}
                      onChange={(e) => setEditImageUrl(e.target.value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <label
                        className="text-[11px] px-2.5 py-1 rounded-md cursor-pointer"
                        style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                      >
                        {uploadingFile ? 'Завантаження...' : 'Завантажити файл'}
                        <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
                      </label>
                      {editImageUrl && (
                        <button
                          type="button"
                          onClick={() => setEditImageUrl('')}
                          className="text-[11px] px-2 py-1 rounded"
                          style={{ color: 'var(--bad)' }}
                        >
                          Прибрати фото
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {uploadFileError && (
                  <p className="text-[11px]" style={{ color: 'var(--bad)' }}>
                    {uploadFileError}
                  </p>
                )}
              </div>

              <div className="pt-2" style={{ borderTop: '1px dashed var(--line)' }}>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  SEO-описание (необязательно)
                </label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-md resize-none"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
                  placeholder="Заполняется автоматически при загрузке прайса — переписывать нужно только для точечной донастройки"
                  value={editMetaDescription}
                  onChange={(e) => setEditMetaDescription(e.target.value)}
                />
                <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                  После ручной правки это описание больше не перезаписывается при повторной загрузке прайса.
                </p>
              </div>

              {editError && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  {editError}
                </p>
              )}

              <div className="flex gap-2 mt-1.5">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {editSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-4 py-2 rounded-md text-sm"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
