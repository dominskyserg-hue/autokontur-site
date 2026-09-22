'use client';

// ============================================================
// Виджет "Реквизиты компании для документов" — юридическое название
// (ФОП/ООО), ІПН/ЄДРПОУ, IBAN, адреса, ФИО руководителя, логотип и
// печать/подпись. Используются в шапке и в блоке подписей всех трёх
// печатных документов заказа (lib/documents/*.ts,
// components/PrintDocumentsPanel.tsx в карточке заказа).
//
// Использует эндпоинты:
//   GET   /api/company-requisites               — текущие реквизиты
//   PATCH /api/company-requisites                — сохранить текстовые поля
//   POST  /api/company-requisites/upload-asset   — загрузить логотип/печать
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

interface Requisites {
  legalName: string;
  taxId: string;
  iban: string;
  bankName: string;
  legalAddress: string;
  warehouseAddress: string;
  directorName: string;
  logoUrl: string | null;
  stampUrl: string | null;
}

const EMPTY: Requisites = {
  legalName: '',
  taxId: '',
  iban: '',
  bankName: '',
  legalAddress: '',
  warehouseAddress: '',
  directorName: '',
  logoUrl: null,
  stampUrl: null,
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function CompanyRequisitesForm() {
  const [form, setForm] = useState<Requisites>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingStamp, setUploadingStamp] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  const fetchRequisites = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/company-requisites');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить реквизиты');
      }
      const r = data.requisites;
      setForm({
        legalName: r.legalName || '',
        taxId: r.taxId || '',
        iban: r.iban || '',
        bankName: r.bankName || '',
        legalAddress: r.legalAddress || '',
        warehouseAddress: r.warehouseAddress || '',
        directorName: r.directorName || '',
        logoUrl: r.logoUrl,
        stampUrl: r.stampUrl,
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке реквизитов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequisites();
  }, [fetchRequisites]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      const response = await fetch('/api/company-requisites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName: form.legalName,
          taxId: form.taxId,
          iban: form.iban,
          bankName: form.bankName,
          legalAddress: form.legalAddress,
          warehouseAddress: form.warehouseAddress,
          directorName: form.directorName,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить реквизиты');
      }
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении реквизитов');
    } finally {
      setSaving(false);
    }
  };

  async function handleAssetUpload(kind: 'logo' | 'stamp', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setUploadError(null);
    const setUploading = kind === 'logo' ? setUploadingLogo : setUploadingStamp;
    setUploading(true);

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const uploadResponse = await fetch('/api/company-requisites/upload-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, imageDataUrl }),
      });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(uploadData.error || 'Не удалось загрузить изображение');
      }

      const patchField = kind === 'logo' ? 'logoUrl' : 'stampUrl';
      const patchResponse = await fetch('/api/company-requisites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [patchField]: uploadData.url }),
      });
      const patchData = await patchResponse.json();
      if (!patchResponse.ok) {
        throw new Error(patchData.error || 'Не удалось сохранить ссылку на изображение');
      }

      setForm((prev) => ({ ...prev, [patchField]: uploadData.url as string }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке изображения');
    } finally {
      setUploading(false);
    }
  }

  const field = (
    key: keyof Requisites,
    label: string,
    placeholder: string,
    mono = false
  ) => (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
        {label}
      </label>
      <input
        type="text"
        disabled={loading}
        className={`w-full px-3 py-2 text-sm rounded-md disabled:opacity-50 ${mono ? 'font-mono' : ''}`}
        style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)' }}
        placeholder={placeholder}
        value={form[key] as string}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <section className="p-5 rounded-lg mb-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <h2 className="text-base font-semibold mb-1">Реквизиты компании для документов</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Показываются в шапке и в блоке подписи на счёте, накладной и акте возврата (кнопка &quot;Печать и
        документы&quot; в карточке заказа).
      </p>

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchRequisites} className="underline">
            Повторить
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {field('legalName', 'Юридическое название (ФОП/ТОВ)', 'ФОП Іванов Іван Іванович')}
          {field('taxId', 'ІПН / ЄДРПОУ', '1234567890', true)}
          {field('iban', 'IBAN', 'UA00 0000 0000 0000 0000 0000 000', true)}
          {field('bankName', 'Банк', 'АТ КБ «ПриватБанк»')}
          {field('legalAddress', 'Юридический адрес', 'м. Київ, вул. Хрещатик, 1')}
          {field('warehouseAddress', 'Адрес склада/магазина', 'м. Київ, вул. Промислова, 5')}
          {field('directorName', 'ФИО руководителя (для подписи)', 'Іванов Іван Іванович')}
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="self-start px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {saving ? 'Сохранение...' : 'Сохранить реквизиты'}
        </button>
      </form>

      {saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {saveError}
        </p>
      )}
      {saved && !saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
          Сохранено
        </p>
      )}

      {/* ---- логотип и печать/подпись ---- */}
      <div className="flex flex-wrap gap-6 mt-5 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
            Логотип (шапка документа)
          </p>
          <div className="flex items-center gap-3">
            <div
              className="w-16 h-16 rounded-md flex items-center justify-center overflow-hidden"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            >
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logoUrl} alt="Логотип" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  нет
                </span>
              )}
            </div>
            <div>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAssetUpload('logo', e)} />
              <button
                type="button"
                disabled={uploadingLogo}
                onClick={() => logoInputRef.current?.click()}
                className="text-sm px-3.5 py-2 rounded-md disabled:opacity-50"
                style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
              >
                {uploadingLogo ? 'Загрузка...' : 'Загрузить'}
              </button>
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: 'var(--ink-muted)' }}>
            Печать / подпись (PNG с прозрачным фоном)
          </p>
          <div className="flex items-center gap-3">
            <div
              className="w-16 h-16 rounded-md flex items-center justify-center overflow-hidden"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            >
              {form.stampUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.stampUrl} alt="Печать" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                  нет
                </span>
              )}
            </div>
            <div>
              <input ref={stampInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAssetUpload('stamp', e)} />
              <button
                type="button"
                disabled={uploadingStamp}
                onClick={() => stampInputRef.current?.click()}
                className="text-sm px-3.5 py-2 rounded-md disabled:opacity-50"
                style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
              >
                {uploadingStamp ? 'Загрузка...' : 'Загрузить'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {uploadError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {uploadError}
        </p>
      )}
    </section>
  );
}
