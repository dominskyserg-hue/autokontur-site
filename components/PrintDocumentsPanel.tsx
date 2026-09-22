'use client';

// ============================================================
// Блок "Печать и документы" внутри карточки заказа
// (components/OrdersScreen.tsx) — три печатные формы заказа:
//   📄 Рахунок-фактура    — счёт на оплату
//   🧾 Видаткова накладна — товарная накладная / товарный чек
//   ↩️ Акт повернення     — акт возврата товара (требует указать,
//                           какие позиции и в каком количестве
//                           возвращаются, и причину — это НЕ выводится
//                           автоматически из заказа)
//
// По клику открывается предпросмотр (тот же HTML, что уйдёт и в PDF,
// и на печать — см. lib/documents/layout.ts) в модальном окне, откуда
// можно распечатать через обычное окно печати браузера
// (iframe.contentWindow.print()) или скачать готовый PDF.
//
// Использует эндпоинты app/api/orders/[id]/documents/[docType]/*:
//   POST .../preview  — HTML для предпросмотра
//   POST .../download — готовый PDF-файл
//   POST .../save     — сохранить PDF в заказ (Vercel Blob)
// ============================================================

import { useEffect, useRef, useState } from 'react';

type DocType = 'invoice' | 'delivery_note' | 'return_act';

// Настройки того, что показывать в таблице позиций документа
// (кнопка "Редактировать" в модальном окне предпросмотра) —
// запоминаются в localStorage браузера, чтобы не переключать их
// заново при каждом открытии печати
const DISPLAY_OPTIONS_STORAGE_KEY = 'printDocuments.displayOptions';

interface DisplayOptions {
  showArticle: boolean;
  showBrand: boolean;
}

function loadDisplayOptions(): DisplayOptions {
  if (typeof window === 'undefined') return { showArticle: true, showBrand: true };
  try {
    const raw = window.localStorage.getItem(DISPLAY_OPTIONS_STORAGE_KEY);
    if (!raw) return { showArticle: true, showBrand: true };
    const parsed = JSON.parse(raw);
    return {
      showArticle: typeof parsed.showArticle === 'boolean' ? parsed.showArticle : true,
      showBrand: typeof parsed.showBrand === 'boolean' ? parsed.showBrand : true,
    };
  } catch {
    return { showArticle: true, showBrand: true };
  }
}

const DOC_LABELS: Record<DocType, { icon: string; title: string }> = {
  invoice: { icon: '📄', title: 'Рахунок-фактура' },
  delivery_note: { icon: '🧾', title: 'Видаткова накладна' },
  return_act: { icon: '↩️', title: 'Акт повернення' },
};

interface PanelOrderItem {
  article: string;
  brand: string | null;
  name: string | null;
  price: number;
  quantity: number;
  status: string;
}

export default function PrintDocumentsPanel({ orderId, items }: { orderId: string; items: PanelOrderItem[] }) {
  // ---- какая форма сейчас открыта ----
  const [activeDocType, setActiveDocType] = useState<DocType | null>(null);

  // ---- форма выбора позиций для акта повернення ----
  const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');

  // ---- предпросмотр ----
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewNumber, setPreviewNumber] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // ---- "Редактировать" — какие колонки показывать в таблице позиций ----
  const [showEditBar, setShowEditBar] = useState(false);
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({ showArticle: true, showBrand: true });

  useEffect(() => {
    setDisplayOptions(loadDisplayOptions());
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Позиции, которые вообще можно вернуть — уже отменённые в саму
  // возвращать нечего
  const returnableItems = items.filter((item) => item.status !== 'cancelled');

  function buildReturnBody(): { items: Array<{ article: string; quantity: number }>; reason: string } | null {
    const selected = Object.entries(returnQuantities).filter(([, qty]) => qty > 0);
    if (selected.length === 0) return null;
    return {
      items: selected.map(([article, quantity]) => ({ article, quantity })),
      reason: returnReason.trim(),
    };
  }

  // Собирает тело запроса для preview/download/save: позиции возврата
  // (только для акта повернення) + текущие настройки видимости колонок
  // "Артикул"/"Бренд" — они применяются ко всем трём типам документов
  function buildRequestBody(docType: DocType): Record<string, unknown> {
    const returnBody = docType === 'return_act' ? buildReturnBody() : null;
    return { ...(returnBody || {}), ...displayOptions };
  }

  async function openPreview(docType: DocType, body?: unknown) {
    setActiveDocType(docType);
    setPreviewHtml(null);
    setPreviewError(null);
    setSaved(false);
    setLoadingPreview(true);

    try {
      const response = await fetch(`/api/orders/${orderId}/documents/${docType}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? buildRequestBody(docType)),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось построить предпросмотр документа');
      }
      setPreviewHtml(data.html as string);
      setPreviewNumber(data.number as string);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Ошибка сети при построении предпросмотра');
    } finally {
      setLoadingPreview(false);
    }
  }

  function handleButtonClick(docType: DocType) {
    setShowEditBar(false);
    if (docType === 'return_act') {
      // Для акта повернення сначала показываем форму выбора позиций —
      // сама форма отрисовывается ниже, предпросмотр здесь ещё не грузим
      setActiveDocType('return_act');
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }
    openPreview(docType);
  }

  function handleBuildReturnAct() {
    const returnBody = buildReturnBody();
    if (!returnBody) {
      setPreviewError('Отметьте хотя бы одну позицию для возврата и укажите количество');
      return;
    }
    if (!returnBody.reason) {
      setPreviewError('Укажите причину возврата');
      return;
    }
    openPreview('return_act', { ...returnBody, ...displayOptions });
  }

  // Переключатель "Показывать артикулы/бренды" — сразу перестраивает
  // уже открытый предпросмотр тем же набором данных (позиции возврата,
  // если это акт повернення, остаются теми же — buildRequestBody их
  // подставит из уже заполненной формы)
  function toggleDisplayOption(key: keyof DisplayOptions) {
    const next = { ...displayOptions, [key]: !displayOptions[key] };
    setDisplayOptions(next);
    try {
      window.localStorage.setItem(DISPLAY_OPTIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage может быть недоступен (приватный режим) — тогда
      // настройка просто не переживёт перезагрузку страницы, не страшно
    }

    if (activeDocType && previewHtml) {
      const returnBody = activeDocType === 'return_act' ? buildReturnBody() : null;
      openPreview(activeDocType, { ...(returnBody || {}), ...next });
    }
  }

  function closePanel() {
    setActiveDocType(null);
    setPreviewHtml(null);
    setPreviewError(null);
    setShowEditBar(false);
  }

  function handlePrint() {
    iframeRef.current?.contentWindow?.print();
  }

  async function handleDownload() {
    if (!activeDocType) return;
    setDownloading(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/documents/${activeDocType}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(activeDocType)),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Не удалось скачать документ');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${DOC_LABELS[activeDocType].title}_${previewNumber || orderId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Ошибка сети при скачивании документа');
    } finally {
      setDownloading(false);
    }
  }

  async function handleSaveToOrder() {
    if (!activeDocType) return;
    setSaving(true);
    setSaved(false);
    try {
      const response = await fetch(`/api/orders/${orderId}/documents/${activeDocType}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(activeDocType)),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить документ');
      }
      setSaved(true);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Ошибка сети при сохранении документа');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3.5 rounded-md mb-5" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <label className="block text-xs font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
        Печать и документы
      </label>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DOC_LABELS) as DocType[]).map((docType) => (
          <button
            key={docType}
            type="button"
            onClick={() => handleButtonClick(docType)}
            className="px-3 py-2 rounded-md text-sm font-medium"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
          >
            {DOC_LABELS[docType].icon} {DOC_LABELS[docType].title}
          </button>
        ))}
      </div>

      {/* ---- форма выбора позиций для акта повернення ---- */}
      {activeDocType === 'return_act' && !previewHtml && !loadingPreview && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px dashed var(--line)' }}>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
            Что возвращает клиент
          </p>
          <div className="flex flex-col gap-2 mb-3">
            {returnableItems.map((item) => (
              <div key={item.article} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(returnQuantities[item.article] || 0) > 0}
                  onChange={(e) =>
                    setReturnQuantities({
                      ...returnQuantities,
                      [item.article]: e.target.checked ? item.quantity : 0,
                    })
                  }
                />
                <span className="flex-1">
                  {item.article} — {item.name || item.brand || 'без названия'}
                </span>
                <input
                  type="number"
                  min={0}
                  max={item.quantity}
                  disabled={(returnQuantities[item.article] || 0) === 0}
                  className="w-16 px-2 py-1 text-sm rounded-md font-mono disabled:opacity-40"
                  style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
                  value={returnQuantities[item.article] || 0}
                  onChange={(e) =>
                    setReturnQuantities({
                      ...returnQuantities,
                      [item.article]: Math.max(0, Math.min(item.quantity, parseInt(e.target.value, 10) || 0)),
                    })
                  }
                />
                <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                  из {item.quantity}
                </span>
              </div>
            ))}
          </div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
            Причина возврата
          </label>
          <textarea
            className="w-full px-3 py-2 text-sm rounded-md mb-3"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)' }}
            rows={2}
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="Например: не подошла деталь по размеру"
          />
          {previewError && (
            <p className="text-xs mb-2" style={{ color: 'var(--bad)' }}>
              {previewError}
            </p>
          )}
          <button
            type="button"
            onClick={handleBuildReturnAct}
            className="px-4 py-2 rounded-md text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Сформировать акт
          </button>
        </div>
      )}

      {/* ---- модальное окно предпросмотра ---- */}
      {activeDocType && (loadingPreview || previewHtml || (previewError && activeDocType !== 'return_act')) && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={closePanel}
        >
          <div
            className="w-full max-w-3xl h-[88vh] rounded-lg flex flex-col overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <h3 className="text-sm font-semibold">
                {DOC_LABELS[activeDocType].icon} {DOC_LABELS[activeDocType].title}
                {previewNumber ? ` № ${previewNumber}` : ''}
              </h3>
              <div className="flex items-center gap-1">
                {previewHtml && (
                  <button
                    type="button"
                    onClick={() => setShowEditBar((v) => !v)}
                    className="text-sm px-2 py-1 rounded-md"
                    style={{
                      color: showEditBar ? 'var(--accent-ink)' : 'var(--ink-muted)',
                      background: showEditBar ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    ✏️ Редактировать
                  </button>
                )}
                <button type="button" onClick={closePanel} className="text-sm px-2 py-1" style={{ color: 'var(--ink-muted)' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* ---- панель "Редактировать": что показывать в таблице ---- */}
            {showEditBar && previewHtml && (
              <div
                className="flex flex-wrap items-center gap-4 px-4 py-2.5 text-sm"
                style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}
              >
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={displayOptions.showArticle}
                    onChange={() => toggleDisplayOption('showArticle')}
                  />
                  Показывать артикулы
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={displayOptions.showBrand}
                    onChange={() => toggleDisplayOption('showBrand')}
                  />
                  Показывать бренды
                </label>
              </div>
            )}

            <div className="flex-1 overflow-hidden" style={{ background: '#E9EBEF' }}>
              {loadingPreview && (
                <p className="p-4 text-xs" style={{ color: 'var(--ink-faint)' }}>
                  Формирование документа...
                </p>
              )}
              {previewError && (
                <p className="p-4 text-xs" style={{ color: 'var(--bad)' }}>
                  {previewError}
                </p>
              )}
              {previewHtml && (
                <iframe ref={iframeRef} srcDoc={previewHtml} title="Предпросмотр документа" className="w-full h-full border-0" />
              )}
            </div>

            {previewHtml && (
              <div className="flex items-center gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-4 py-2 rounded-md text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  Печать
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                >
                  {downloading ? 'Скачивание...' : 'Скачать PDF'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveToOrder}
                  className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                >
                  {saving ? 'Сохранение...' : 'Сохранить в заказ'}
                </button>
                {saved && (
                  <span className="text-xs" style={{ color: 'var(--good)' }}>
                    Сохранено
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
