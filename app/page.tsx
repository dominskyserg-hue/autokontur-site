// Главная страница витрины интернет-магазина — то, что видит
// покупатель. Админ-панель переехала под /admin (см. app/admin/page.tsx)
import type { Metadata } from 'next';
import StorefrontHome from '@/components/StorefrontHome';
import { FAQ_ITEMS } from '@/lib/faq';

// Власний metadata на рівні сторінки (а не тільки загальний з
// app/layout.tsx) — свідомо під головні високочастотні запити
// ("автозапчастини", "магазин автозапчастин"), а не під бренд:
// за Google Ads Keyword Planner ці фрази дають на порядки більший
// обсяг показів, ніж будь-яка з вузьких SEO-сторінок моделей.
export const metadata: Metadata = {
  title: 'Автозапчастини купити в Україні — інтернет-магазин DominatorParts',
  description:
    'Понад 20 000 автозапчастин для іномарок в наявності. Оригінальні деталі та перевірені аналоги, підбір за VIN-кодом, доставка по всій Україні Новою поштою.',
};

// Розмітка FAQPage (schema.org) для Google — за тими самими
// питаннями/відповідями, що показує видимий акордеон FAQ у
// components/StorefrontHome.tsx. Дозволяє Google показати
// розгортання питань прямо в результатах пошуку (rich snippet)
function FaqStructuredData() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default function Home() {
  return (
    <>
      <FaqStructuredData />
      <StorefrontHome />
    </>
  );
}
