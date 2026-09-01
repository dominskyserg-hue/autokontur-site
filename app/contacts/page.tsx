import type { Metadata } from 'next';
import InfoPage from '@/components/InfoPage';
import { loadSitePage } from '@/lib/sitePages';

export const runtime = 'nodejs';
// force-dynamic: без цього сторінка спробувала б зібратись заздалегідь
// під час білда на Vercel, де немає доступу до бази (саме так одного
// разу впав весь сайт — див. app/marky/page.tsx)
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadSitePage('contacts');
  return { title: `${page?.title || 'Контакти'} — DominatorParts` };
}

export default function ContactsPage() {
  return <InfoPage slug="contacts" fallbackTitle="Контакти" />;
}
