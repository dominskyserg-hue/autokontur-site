// ============================================================
// Спільний завантажувач контенту для трьох статичних сторінок
// (Про нас, Доставка, Контакти) — контент редагується в адмінці
// (components/SitePagesManager.tsx), зберігається в таблиці
// site_pages (schema.sql). Публічні сторінки app/about, app/delivery,
// app/contacts читають цю таблицю НАПРЯМУЮ на сервері, без API-роута
// (той потрібен тільки адмінці) — так само, як app/category/[slug]
// ============================================================

import { cache } from 'react';
import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

export type SitePageSlug = 'about' | 'delivery' | 'contacts';

export interface SitePageContent {
  title: string;
  content: string;
}

// cache() дедуплікує виклик у межах ОДНОГО HTTP-запиту — generateMetadata()
// і сам компонент сторінки викликають loadSitePage з тим самим slug,
// але SQL-запит реально піде в базу лише один раз
export const loadSitePage = cache(async function loadSitePage(
  slug: SitePageSlug
): Promise<SitePageContent | null> {
  const result = await pool.query('SELECT title, content FROM site_pages WHERE slug = $1', [slug]);
  if (result.rows.length === 0) return null;
  return { title: result.rows[0].title, content: result.rows[0].content };
});
