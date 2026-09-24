// Главная страница витрины интернет-магазина — то, что видит
// покупатель. Админ-панель переехала под /admin (см. app/admin/page.tsx)
import type { Metadata } from 'next';
import { Pool } from 'pg';
import StorefrontHome from '@/components/StorefrontHome';
import { FAQ_ITEMS } from '@/lib/faq';
import { SITE_URL } from '@/lib/siteConfig';
import { buildOrganizationJsonLd, buildWebSiteJsonLd, jsonLdScript } from '@/lib/structuredData';

// Захист від спроби зібрати сторінку заздалегідь під час білда на
// Vercel (де немає доступу до бази) — той самий прийом, що й у
// app/category/[slug]/page.tsx
export const dynamic = 'force-dynamic';

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

// ------------------------------------------------------------
// НАЛАШТУВАННЯ САЙТУ (телефон/назва/години) — ЗАВАНТАЖУЄМО НА СЕРВЕРІ
// ------------------------------------------------------------
// Раніше StorefrontHome (клієнтський компонент) сам ходив за ними в
// /api/site-settings ПІСЛЯ монтування — перший же кадр на екрані
// покупця завжди показував телефон-заглушку DEFAULT_PHONE ("+38 (050)
// 123-45-67", ніколи не існуючий номер), а вже за мить, коли
// відповідав fetch, номер "стрибав" на справжній. Локальний кеш у
// StorefrontHome (SITE_SETTINGS_CACHE_KEY) прибирав стрибок ТІЛЬКИ
// коли він відбувався в client-side переходах — на звичайному
// оновленні сторінки браузер завжди спершу малює ту саму
// server-rendered розмітку, а вона однаково містила заглушку,
// незалежно від кешу.
//
// Тепер справжні значення читаються тут, на сервері, ПРИ КОЖНОМУ
// запиті (dynamic = 'force-dynamic' вище) — і одразу йдуть у перший
// же HTML, який бачить браузер. StorefrontHome і далі підвантажує їх
// самостійно в useEffect (лишили як є) — це вже просто фонове
// оновлення про всяк випадок (наприклад, якщо адмін змінив телефон
// саме в ту секунду), а не боротьба з видимим стрибком
interface InitialSiteSettings {
  shopName: string | null;
  phone: string | null;
  workingHours: string | null;
  telegramGroupUrl: string | null;
}

async function getInitialSiteSettings(): Promise<InitialSiteSettings> {
  try {
    const result = await pool.query(
      'SELECT shop_name, phone, working_hours, telegram_group_url FROM site_settings WHERE id = 1'
    );
    const row = result.rows[0];
    return {
      shopName: row?.shop_name ?? null,
      phone: row?.phone ?? null,
      workingHours: row?.working_hours ?? null,
      telegramGroupUrl: row?.telegram_group_url ?? null,
    };
  } catch (error) {
    // Збій підключення до бази НЕ повинен валити всю Головну — просто
    // повертаємось до старої поведінки (заглушки, які StorefrontHome
    // підмінить сам у useEffect)
    console.error('Ошибка при получении настроек сайта для SSR Головной:', error);
    return { shopName: null, phone: null, workingHours: null, telegramGroupUrl: null };
  }
}

// Власний metadata на рівні сторінки (а не тільки загальний з
// app/layout.tsx) — свідомо під головні високочастотні запити
// ("автозапчастини", "магазин автозапчастин"), а не під бренд:
// за Google Ads Keyword Planner ці фрази дають на порядки більший
// обсяг показів, ніж будь-яка з вузьких SEO-сторінок моделей.
export const metadata: Metadata = {
  title: 'Автозапчастини купити в Україні — інтернет-магазин DominatorParts',
  description:
    'Понад 20 000 автозапчастин для іномарок в наявності. Оригінальні деталі та перевірені аналоги, підбір за VIN-кодом, доставка по всій Україні Новою поштою.',
  alternates: { canonical: SITE_URL },
};

// Розмітка FAQPage (schema.org) для Google — за тими самими
// питаннями/відповідями, що показує видимий акордеон FAQ у
// components/StorefrontHome.tsx. Дозволяє Google показати
// розгортання питань прямо в результатах пошуку (rich snippet)
function FaqStructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function Home() {
  const initialSettings = await getInitialSiteSettings();

  return (
    <>
      <FaqStructuredData />
      {/* Organization + WebSite — лише на Головній (не на кожній
          сторінці), як і рекомендує Google: одна сторінка з розміткою
          власника сайту й пошуку достатня для всього домену */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildOrganizationJsonLd(initialSettings.phone)) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildWebSiteJsonLd()) }}
      />
      <StorefrontHome initialSettings={initialSettings} />
    </>
  );
}
