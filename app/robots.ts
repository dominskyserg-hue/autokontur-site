// ============================================================
// /robots.txt — файлова конвенція Next.js App Router.
//
// /admin — адмін-панель (і так захищена паролем через middleware.ts,
// але явна заборона в robots.txt — стандартна практика: не давати
// пошуковику причин навіть намагатись туди зайти).
// /api — службові маршрути, не сторінки для людей.
// /account — особистий кабінет покупця (історія ЙОГО замовлень) —
// приватні дані, індексувати нема чого й не можна.
// ============================================================

import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteConfig';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/account'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
