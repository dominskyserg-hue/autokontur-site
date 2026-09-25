// ============================================================
// Серверна обгортка повної шапки (components/SiteHeaderFull.tsx):
// сама читає контакти магазину (site_settings) і передає їх у клієнтську
// шапку. Потрібна сторінкам категорій, марок і хабів моделей, щоб
// поставити повну шапку (пошук, кошик, телефон, меню) одним рядком
// <SiteHeaderServer /> замість легкої <SiteHeader />
// ============================================================

import { Pool } from 'pg';
import SiteHeaderFull from '@/components/SiteHeaderFull';
import { getSiteContactSettings } from '@/lib/siteSettings';

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

export default async function SiteHeaderServer() {
  const settings = await getSiteContactSettings(pool);
  return <SiteHeaderFull shopName={settings.shopName} phone={settings.phone} workingHours={settings.workingHours} />;
}
