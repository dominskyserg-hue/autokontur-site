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
import { UUID_PATTERN, loadProduct, loadProductPageData } from '@/lib/productDetail';
import ProductDetailContent, { BG, BODY_FONT, PAPER } from '@/components/ProductDetailContent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const displayName = product.name?.trim() || [product.brand, product.article].filter(Boolean).join(' ');
  const title = `${[product.brand, product.article].filter(Boolean).join(' ')}${
    product.name ? ' — ' + product.name : ''
  } купити | DominatorParts`;
  const description =
    product.metaDescription?.trim() ||
    `${displayName} — купити з доставкою по Україні. Артикул ${product.article}${
      product.brand ? `, бренд ${product.brand}` : ''
    }. ${product.stock > 0 ? 'В наявності' : `Під замовлення${product.deliveryTime ? ', ' + product.deliveryTime : ''}`}.`;

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
  const data = await loadProductPageData(id, slug);

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8">
        <ProductDetailContent {...data} />
      </div>
    </div>
  );
}
