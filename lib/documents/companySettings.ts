// ============================================================
// Реквизиты компании (ФОП/ООО) для печатных документов — читаются
// из той же таблицы-синглтона site_settings (секция 30.1 schema.sql),
// где уже хранятся название магазина, телефон и часы работы
// (app/api/site-settings/route.ts, components/ContactSettingsForm.tsx).
//
// Отдельная таблица под реквизиты не заводилась специально: они
// точно так же существуют "в одном экземпляре на весь магазин" —
// заводить для них ещё один синглтон со своим id = 1 было бы лишней
// сущностью. Управляются через components/CompanyRequisitesForm.tsx
// (экран "Настройки") и app/api/company-requisites/route.ts.
// ============================================================

import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });

globalThis.pgPool = pool;

export interface CompanyRequisites {
  shopName: string;
  legalName: string | null;
  taxId: string | null;
  iban: string | null;
  bankName: string | null;
  legalAddress: string | null;
  warehouseAddress: string | null;
  directorName: string | null;
  phone: string | null;
  logoUrl: string | null;
  stampUrl: string | null;
}

// Пустые реквизиты — используются, если строка в site_settings почему-то
// отсутствует (не должно происходить, schema.sql всегда вставляет её,
// но на этот случай шаблон документа не должен падать, а просто
// показать прочерки вместо реквизитов)
const EMPTY_REQUISITES: CompanyRequisites = {
  shopName: 'AUTOKONTUR',
  legalName: null,
  taxId: null,
  iban: null,
  bankName: null,
  legalAddress: null,
  warehouseAddress: null,
  directorName: null,
  phone: null,
  logoUrl: null,
  stampUrl: null,
};

export async function getCompanyRequisites(): Promise<CompanyRequisites> {
  const result = await pool.query(
    `
    SELECT shop_name, legal_name, tax_id, iban, bank_name, legal_address,
           warehouse_address, director_name, phone, logo_url, stamp_url
    FROM site_settings
    WHERE id = 1
    `
  );

  const row = result.rows[0];
  if (!row) return EMPTY_REQUISITES;

  return {
    shopName: row.shop_name || EMPTY_REQUISITES.shopName,
    legalName: row.legal_name,
    taxId: row.tax_id,
    iban: row.iban,
    bankName: row.bank_name,
    legalAddress: row.legal_address,
    warehouseAddress: row.warehouse_address,
    directorName: row.director_name,
    phone: row.phone,
    logoUrl: row.logo_url,
    stampUrl: row.stamp_url,
  };
}
