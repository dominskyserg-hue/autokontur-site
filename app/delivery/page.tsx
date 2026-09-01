import type { Metadata } from 'next';
import InfoPage from '@/components/InfoPage';
import { loadSitePage } from '@/lib/sitePages';

export const runtime = 'nodejs';
// force-dynamic: без цього сторінка спробувала б зібратись заздалегідь
// під час білда на Vercel, де немає доступу до бази (саме так одного
// разу впав весь сайт — див. app/marky/page.tsx)
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadSitePage('delivery');
  return { title: `${page?.title || 'Доставка та оплата'} — DominatorParts` };
}

export default function DeliveryPage() {
  return <InfoPage slug="delivery" fallbackTitle="Доставка та оплата" />;
}
