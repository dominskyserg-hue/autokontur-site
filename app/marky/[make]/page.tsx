// ============================================================
// SEO-сторінка марки авто — /marky/[make]
//
// Дзеркальна структура до app/category/[slug]/page.tsx (той же
// Server Component, той же трюк з cache() для дедуплікації запиту
// між generateMetadata і самою сторінкою), але фільтр — по реальному
// полю products.car_make замість пошуку слів у назві. Курований
// список марок і те, як саме кожна записана в базі, — у
// lib/carMakes.ts
// ============================================================

import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { CAR_MAKES, getCarMakeBySlug, buildMakeWhereClause } from '@/lib/carMakes';

export const runtime = 'nodejs';
// Захист від спроби зібрати сторінку заздалегідь під час білда на
// Vercel (де немає доступу до бази) — див. app/marky/page.tsx
export const dynamic = 'force-dynamic';

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

globalThis.pgPool = pool;

const PAGE_SIZE = 24;

interface MakeProduct {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  retailPrice: number;
  stock: number;
  deliveryTime: string | null;
}

const loadMakeProducts = cache(async function loadMakeProducts(
  slug: string,
  page: number
): Promise<{ products: MakeProduct[]; total: number }> {
  const make = getCarMakeBySlug(slug);
  if (!make) return { products: [], total: 0 };

  const { clause, param } = buildMakeWhereClause(make, 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [productsResult, countResult] = await Promise.all([
    pool.query(
      `
      SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.stock, s.delivery_time
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE ${clause}
      ORDER BY (p.stock > 0) DESC, p.name ASC NULLS LAST
      LIMIT $2 OFFSET $3
      `,
      [param, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE ${clause}`, [param]),
  ]);

  const products: MakeProduct[] = productsResult.rows.map((row) => ({
    id: row.id,
    article: row.article,
    brand: row.brand,
    name: row.name,
    retailPrice: parseFloat(row.retail_price),
    stock: row.stock,
    deliveryTime: row.delivery_time,
  }));

  return { products, total: countResult.rows[0]?.total ?? 0 };
});

type PageParams = { make: string };
type PageSearchParams = { page?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { make: slug } = await params;
  const make = getCarMakeBySlug(slug);
  if (!make) return {};

  const { total } = await loadMakeProducts(slug, 1);

  return {
    title: `Запчастини ${make.name} купити з доставкою — DominatorParts`,
    description: `Автозапчастини ${make.name} в наявності: оригінал та перевірені аналоги. Пошук за артикулом, швидка доставка по всій Україні.`,
    robots: total === 0 ? { index: false, follow: true } : undefined,
  };
}

// Світла палітра "Workshop" — узгоджена з components/StorefrontHome.tsx
const BG = '#F5F6F9';
const PANEL_SOFT = '#EAEDF2';
const BORDER_SOFT = '#DDE2EA';
const RED = '#1D5FD6';
const YELLOW = '#1D5FD6';
const PAPER = '#12192A';
const SUCCESS_TEXT = '#15803D';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

// Копійки покупцю не показуємо — тільки цілі гривні, округлені ВГОРУ
function formatMoney(value: number): string {
  return Math.ceil(value).toLocaleString('uk-UA', { maximumFractionDigits: 0 });
}

export default async function CarMakePage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { make: slug } = await params;
  const { page: pageParam } = await searchParams;

  const make = getCarMakeBySlug(slug);
  if (!make) notFound();

  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const { products, total } = await loadMakeProducts(slug, page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          /{' '}
          <Link href="/marky" className="underline">
            Марки авто
          </Link>{' '}
          / <span>{make.name}</span>
        </nav>

        <header className="mb-6">
          <h1
            className="text-3xl md:text-4xl mb-3"
            style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
          >
            Запчастини {make.name} — купити з доставкою по Україні
          </h1>
          <p className="text-sm max-w-2xl" style={{ color: PAPER, opacity: 0.85 }}>
            {total > 0
              ? `У каталозі понад ${total.toLocaleString('uk-UA')} запчастин для ${make.name}: оригінал та перевірені аналоги. Знайдіть потрібну деталь за артикулом або підберіть за моделлю й роком авто.`
              : `Зараз у каталозі немає в наявності запчастин ${make.name} — скористайтесь підбором за VIN на Головній, і ми підберемо деталь під замовлення.`}
          </p>
          <Link
            href={`/marky/${slug}/to`}
            className="inline-block mt-4 px-4 py-2 text-xs font-bold uppercase tracking-wide"
            style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', background: RED, color: '#FFFFFF' }}
          >
            Що потрібно на ТО для {make.name} →
          </Link>
        </header>

        {products.length === 0 ? (
          <div
            className="p-6 rounded-md text-sm"
            style={{ background: PANEL_SOFT, border: `1px dashed ${RED}` }}
          >
            Немає товарів {make.name} у наявності просто зараз. Скористайтесь{' '}
            <Link href="/" className="underline" style={{ color: YELLOW }}>
              підбором за VIN на Головній
            </Link>{' '}
            — ми підберемо деталь під замовлення.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {products.map((product) => (
                <Link
                  key={product.id}
                  href={`/?article=${encodeURIComponent(product.article)}`}
                  className="block p-4 rounded-md transition-colors hover:opacity-90 hover:shadow-sm"
                  style={{ background: '#FFFFFF', border: `1px solid ${BORDER_SOFT}` }}
                >
                  <div className="text-xs uppercase mb-1" style={{ color: YELLOW, opacity: 0.9 }}>
                    {product.brand || 'Без бренду'} · {product.article}
                  </div>
                  <div className="text-sm mb-2" style={{ color: PAPER }}>
                    {product.name || `Деталь для ${make.name}`}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold" style={{ fontFamily: DISPLAY_FONT, color: PAPER }}>
                      {formatMoney(product.retailPrice)} грн
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        background: product.stock > 0 ? '#DCFCE7' : PANEL_SOFT,
                        color: product.stock > 0 ? SUCCESS_TEXT : PAPER,
                      }}
                    >
                      {product.stock > 0 ? 'В наявності' : 'Під замовлення'}
                    </span>
                  </div>
                  {product.stock <= 0 && product.deliveryTime && (
                    <div className="text-xs mt-1.5" style={{ color: PAPER, opacity: 0.7 }}>
                      Термін поставки: {product.deliveryTime}
                    </div>
                  )}
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-3 text-sm mb-8">
                {page > 1 && (
                  <Link href={`/marky/${slug}?page=${page - 1}`} className="underline" style={{ color: YELLOW }}>
                    ← Попередня
                  </Link>
                )}
                <span style={{ opacity: 0.7 }}>
                  Сторінка {page} з {totalPages}
                </span>
                {page < totalPages && (
                  <Link href={`/marky/${slug}?page=${page + 1}`} className="underline" style={{ color: YELLOW }}>
                    Наступна →
                  </Link>
                )}
              </div>
            )}
          </>
        )}

        <div className="pt-6" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: PAPER }}>
            Інші марки
          </h2>
          <div className="flex flex-wrap gap-2">
            {CAR_MAKES.filter((m) => m.slug !== slug).map((m) => (
              <Link
                key={m.slug}
                href={`/marky/${m.slug}`}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{ border: `1px solid ${RED}`, color: PAPER }}
              >
                {m.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
