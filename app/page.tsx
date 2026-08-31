// Главная страница витрины интернет-магазина — то, что видит
// покупатель. Админ-панель переехала под /admin (см. app/admin/page.tsx)
import StorefrontHome from '@/components/StorefrontHome';
import { FAQ_ITEMS } from '@/lib/faq';

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
