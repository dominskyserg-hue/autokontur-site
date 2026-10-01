// ============================================================
// /robots.txt — файлова конвенція Next.js App Router.
//
// /admin — адмін-панель (і так захищена паролем через middleware.ts,
// але явна заборона в robots.txt — стандартна практика: не давати
// пошуковику причин навіть намагатись туди зайти).
// /api — службові маршрути, не сторінки для людей.
// /account — особистий кабінет покупця (історія ЙОГО замовлень) —
// приватні дані, індексувати нема чого й не можна.
//
// ?_rsc= — службові дані Next.js для переходів усередині сайту (не
// сторінки). За Search Console це було 38% запитів Googlebot — він
// витрачав на них бюджет обходу замість справжніх сторінок. Правила
// з "*" і "?"/"&" закривають ЛИШЕ адреси з цим параметром: /p/..., /category/...,
// /marky/..., картинки та /_next/static (CSS, JS) лишаються відкритими
// ============================================================

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteConfig';

// Роботы, которые не приводят покупателей, а только создают нагрузку
// (по статистике Vercel — ~60% всех запросов). Им закрыт весь сайт.
// Тем, кто robots.txt не слушается, middleware.ts отвечает 403
const BLOCKED_BOTS = ['meta-externalagent', 'Amazonbot', 'AhrefsBot', 'SERankingBacklinksBot', 'SERanking'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/account', '/*?_rsc=', '/*&_rsc='],
      },
      {
        userAgent: BLOCKED_BOTS,
        disallow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
