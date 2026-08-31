// ============================================================
// Індекс усіх марок авто — /marky
//
// Та сама роль, що й у app/category/page.tsx: внутрішнє посилання
// з Головної на кожну сторінку марки (без нього Google їх просто не
// знайде) + зручна навігація для покупця, який не знає артикул.
//
// Кількість товарів по кожній марці рахуємо тут-таки, одним запитом
// на всі марки разом (GROUP BY), а не по одному запиту на марку —
// щоб відкриття /marky не робило 26 окремих SQL-запитів
// ============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { Pool } from 'pg';
import { CAR_MAKES } from '@/lib/carMakes';

export const runtime = 'nodejs';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

export const metadata: Metadata = {
  title: 'Запчастини за маркою авто — DominatorParts',
  description:
    'Автозапчастини для Toyota, Nissan, Mitsubishi, Hyundai, Mazda, Honda та інших марок. Оригінал та аналоги, доставка по всій Україні.',
};

const BG = '#15100E';
const RED = '#E5231C';
const YELLOW = '#F0B429';
const PAPER = '#EDE6DD';
const DISPLAY_FONT = "'Bebas Neue', 'Rajdhani', sans-serif";
const BODY_FONT = "'Barlow', sans-serif";

async function loadCounts(): Promise<Record<string, number>> {
  const result = await pool.query(
    `SELECT UPPER(car_make) AS make_upper, COUNT(*)::int AS cnt
     FROM products
     WHERE car_make IS NOT NULL AND car_make <> ''
     GROUP BY UPPER(car_make)`
  );

  const countByDbValue: Record<string, number> = {};
  for (const row of result.rows) {
    countByDbValue[row.make_upper] = row.cnt;
  }

  const countByMakeSlug: Record<string, number> = {};
  for (const make of CAR_MAKES) {
    countByMakeSlug[make.slug] = make.dbValues.reduce(
      (sum, v) => sum + (countByDbValue[v.toUpperCase()] || 0),
      0
    );
  }
  return countByMakeSlug;
}

export default async function CarMakesIndexPage() {
  const counts = await loadCounts();

  return (
    <div className="min-h-screen" style={{ background: BG, color: PAPER, fontFamily: BODY_FONT }}>
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-8">
        <nav className="text-xs mb-5 opacity-70" aria-label="Хлібні крихти">
          <Link href="/" className="underline">
            Головна
          </Link>{' '}
          / <span>Марки авто</span>
        </nav>

        <h1
          className="text-3xl md:text-4xl mb-6"
          style={{ fontFamily: DISPLAY_FONT, letterSpacing: '0.02em', color: YELLOW }}
        >
          Запчастини за маркою авто
        </h1>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {CAR_MAKES.map((m) => (
            <Link
              key={m.slug}
              href={`/marky/${m.slug}`}
              className="block p-4 rounded-md hover:opacity-90"
              style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${RED}` }}
            >
              <div className="text-lg" style={{ fontFamily: DISPLAY_FONT, color: PAPER }}>
                {m.name}
              </div>
              <div className="text-xs opacity-70">{(counts[m.slug] || 0).toLocaleString('uk-UA')} товарів</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
