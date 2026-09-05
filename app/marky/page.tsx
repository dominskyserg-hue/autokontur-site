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
import { TECH_BG, TECH_SURFACE_2, TECH_BORDER, TECH_INK, TECH_MUTED, TECH_FAINT, TECH_DISPLAY_FONT, TECH_BODY_FONT } from '@/lib/techTheme';

export const runtime = 'nodejs';

// Без параметрів в адресі ця сторінка за замовчуванням намагалась би
// зібратись ЗАЗДАЛЕГІДЬ під час білда на Vercel (Static Generation) —
// а білд-середовище не має доступу до бази (саме це й зламало прод:
// "Error occurred prerendering page /marky", getaddrinfo ENOTFOUND).
// force-dynamic змушує рендерити сторінку на кожен запит з робочого
// сервера (де підключення до бази є), а не під час збірки
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

export const metadata: Metadata = {
  title: 'Запчастини за маркою авто — DominatorParts',
  description:
    'Автозапчастини для Toyota, Nissan, Mitsubishi, Hyundai, Mazda, Honda та інших марок. Оригінал та аналоги, доставка по всій Україні.',
};

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
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          / <span>Марки авто</span>
        </nav>

        <h1
          className="mb-6 text-3xl md:text-4xl"
          style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff' }}
        >
          Запчастини за маркою авто
        </h1>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {CAR_MAKES.map((m) => (
            <Link
              key={m.slug}
              href={`/marky/${m.slug}`}
              className="block rounded-xl p-4 transition-colors hover:bg-[rgba(59,130,246,0.07)]"
              style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}
            >
              <div className="text-base font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                {m.name}
              </div>
              <div className="text-xs" style={{ color: TECH_FAINT }}>
                {(counts[m.slug] || 0).toLocaleString('uk-UA')} товарів
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
