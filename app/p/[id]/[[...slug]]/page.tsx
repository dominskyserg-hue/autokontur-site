// ============================================================
// Сторінка ОДНОГО товару — /p/[id]/[[...slug]]
//
// [id] — UUID товару (products.id) — ЄДИНЕ джерело правди для
// пошуку в базі. [[...slug]] — необов'язковий "хвіст" з ключовими
// словами (бренд+назва+артикул, lib/slug.ts) ЛИШЕ для краси URL і
// ключових слів у ньому — сторінка відкриється однаково і зовсім без
// нього, і зі старим/стороннім текстом там.
//
// ЧОМУ НЕ /product/[article] і НЕ /p/[brand]-[article]: перевірено
// прямим запитом до бойової бази — 7 709 різних article зустрічаються
// у товарів 2+ РІЗНИХ постачальників, а 4 745 пар (brand, article)
// теж дублюються. Тобто ні article, ні навіть (brand, article) не
// гарантують унікальність — тільки products.id.
//
// Якщо slug у адресному рядку не збігається з "правильним" (застарів
// після зміни назви товару, або його взагалі не було) — сторінка
// РОБИТЬ ПОСТІЙНИЙ РЕДИРЕКТ (308) на канонічну адресу. Так у Google
// завжди рівно ОДИН URL на товар, а не купа майже-дублів.
//
// Ця сторінка рендериться напряму лише при прямому переході за
// посиланням (пошук Google, "Поділитись", перезавантаження сторінки).
// При кліку по картці товару в каталозі (components/StorefrontHome.tsx
// та сторінках категорій/марок) той самий вміст показується у
// модальному вікні поверх каталогу — див.
// app/@modal/(...)p/[id]/[[...slug]]/page.tsx. Обидва місця рендерять
// ОДИН І ТОЙ САМИЙ ProductDetailContent з ОДНИХ І ТИХ САМИХ даних
// (lib/productDetail.ts) — це не дві різні версії сторінки товару
// ============================================================

import type { Metadata } from 'next';
import { SITE_URL } from '@/lib/siteConfig';
import { buildProductPath } from '@/lib/slug';
import { UUID_PATTERN, buildSeoMetaTitle, buildSeoProductDescription, loadProduct, loadProductPageData } from '@/lib/productDetail';
import ProductDetailContent, { BG, BODY_FONT, PAPER } from '@/components/ProductDetailContent';
import { Pool } from 'pg';
import SiteHeaderFull from '@/components/SiteHeaderFull';
import SiteFooter from '@/components/SiteFooter';
import { getSiteContactSettings } from '@/lib/siteSettings';

export const runtime = 'nodejs';
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

type PageParams = { id: string; slug?: string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return {};

  const product = await loadProduct(id);
  if (!product) return {};

  const canonicalUrl = `${SITE_URL}${buildProductPath(id, product)}`;
  // title/description — обидва враховують ручний SEO-оверрайд товару
  // (data/seo-overrides.ts) з найвищим пріоритетом, інакше будуються
  // з того самого шаблону, що й видимий H1 на сторінці
  // (components/ProductDetailContent.tsx, buildSeoProductName у
  // lib/productDetail.ts) — title і опис мають збігатись із видимим
  // контентом, а не показувати щось інше. "для Марка Модель" і ціна
  // в описі — ЛИШЕ реальні дані товару, сумісність тут не вигадується
  const title = buildSeoMetaTitle(product);
  const description = buildSeoProductDescription(product);

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      images: product.imageUrl ? [{ url: product.imageUrl }] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<PageParams> }) {
  const { id, slug } = await params;
  const [data, settings] = await Promise.all([loadProductPageData(id, slug), getSiteContactSettings(pool)]);

  // Повна шапка (пошук, кошик, телефон, Telegram, меню) і підвал — як на
  // Головній: сторінка товару часто ПЕРША, яку бачить покупець з Google
  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <SiteHeaderFull shopName={settings.shopName} phone={settings.phone} workingHours={settings.workingHours} />
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-8">
        <ProductDetailContent {...data} />
      </div>
      <SiteFooter shopName={settings.shopName} phone={settings.phone} workingHours={settings.workingHours} />
    </div>
  );
}
