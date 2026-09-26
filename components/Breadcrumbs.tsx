// ============================================================
// Хлебные крошки — ОДИН компонент на весь сайт.
//
// Из одного и того же массива items он выводит СРАЗУ две вещи:
//   1. видимую цепочку <nav aria-label="Навігаційний ланцюжок"><ol>…;
//   2. JSON-LD BreadcrumbList для Google (lib/structuredData.ts).
// Поэтому названия и ссылки в разметке и на экране совпадают 1 в 1, и
// на странице ровно один BreadcrumbList — отдельно JSON-LD крошек
// больше нигде не выводится.
//
// items — { name, url } с полными адресами (SITE_URL + путь), как и
// требует schema.org. В видимых ссылках адрес сайта отрезается, чтобы
// переход был внутри сайта. Последний пункт — текущая страница: не
// ссылка, а текст с aria-current="page".
//
// Стиль: 13 px, приглушённый серый, разделитель "›", ссылки
// подсвечиваются при наведении. На мобильном — одна строка с
// горизонтальной прокруткой, без переноса.
// ============================================================

import Link from 'next/link';
import { SITE_URL } from '@/lib/siteConfig';
import { buildBreadcrumbJsonLd, jsonLdScript, type BreadcrumbItem } from '@/lib/structuredData';
import { TECH_FAINT, TECH_MUTED, TECH_BODY_FONT } from '@/lib/techTheme';

// Полный адрес → путь внутри сайта для <Link>
function toSitePath(url: string): string {
  if (url.startsWith(SITE_URL)) return url.slice(SITE_URL.length) || '/';
  return url;
}

export default function Breadcrumbs({ items, className = 'mb-5' }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdScript(buildBreadcrumbJsonLd(items)) }}
      />
      <nav
        aria-label="Навігаційний ланцюжок"
        className={`${className} overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
        style={{ fontFamily: TECH_BODY_FONT }}
      >
        <ol className="flex items-center gap-1.5 whitespace-nowrap text-[13px]" style={{ color: TECH_FAINT }}>
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={`${index}-${item.url}`} className="flex shrink-0 items-center gap-1.5">
                {index > 0 && <span aria-hidden="true">›</span>}
                {isLast ? (
                  <span aria-current="page" style={{ color: TECH_MUTED }}>
                    {item.name}
                  </span>
                ) : (
                  <Link
                    href={toSitePath(item.url)}
                    className="transition-colors hover:text-[#60A5FA] hover:underline"
                    style={{ color: TECH_MUTED }}
                  >
                    {item.name}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
