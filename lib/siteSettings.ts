// ============================================================
// Контакти магазину (site_settings, рядок id = 1) для серверних
// сторінок поза Головною — повна шапка і підвал сторінки товару
// (components/SiteHeaderFull.tsx, components/SiteFooter.tsx).
// Головна (app/page.tsx) читає ту саму таблицю сама. Збій бази не
// повинен валити сторінку — тоді повертаємо значення за замовчуванням
// ============================================================

import { cache } from 'react';
import type { Pool } from 'pg';

export interface SiteContactSettings {
  shopName: string;
  phone: string;
  workingHours: string;
  telegramGroupUrl: string | null;
}

// Ті самі запасні значення, що й у components/StorefrontHome.tsx
const DEFAULTS: SiteContactSettings = {
  shopName: 'DominatorParts',
  phone: '+38 (050) 123-45-67',
  workingHours: 'Щодня 9:00–19:00',
  telegramGroupUrl: null,
};

export const getSiteContactSettings = cache(async function getSiteContactSettings(pool: Pool): Promise<SiteContactSettings> {
  try {
    const result = await pool.query('SELECT shop_name, phone, working_hours, telegram_group_url FROM site_settings WHERE id = 1');
    const row = result.rows[0];
    return {
      shopName: row?.shop_name || DEFAULTS.shopName,
      phone: row?.phone || DEFAULTS.phone,
      workingHours: row?.working_hours || DEFAULTS.workingHours,
      telegramGroupUrl: row?.telegram_group_url || null,
    };
  } catch (error) {
    console.error('Не вдалося прочитати контакти магазину (site_settings):', error);
    return DEFAULTS;
  }
});
