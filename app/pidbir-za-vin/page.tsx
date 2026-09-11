// ============================================================
// /pidbir-za-vin — окрема індексована сторінка під кластер запитів
// "підбір запчастин за VIN-кодом", "пошук запчастин за VIN", "запчастини
// по він коду". До цього на сайті існувала лише JS-модалка (форма без
// власного URL і тексту) — Google не мав що індексувати під ці фрази.
//
// Форма нижче (components/VinLandingForm.tsx) б'є в ТОЙ САМИЙ
// /api/vin-requests, що і плаваюча кнопка (VinRequestButton.tsx) і
// модалка на Головній — нова, паралельна система заявок НЕ створюється.
// ============================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import VinLandingForm from '@/components/VinLandingForm';
import { TECH_BG, TECH_SURFACE_2, TECH_BORDER, TECH_INK, TECH_MUTED, TECH_FAINT, TECH_ACCENT_BRIGHT, TECH_DISPLAY_FONT, TECH_BODY_FONT } from '@/lib/techTheme';

export const metadata: Metadata = {
  title: 'Підбір запчастин за VIN-кодом — DominatorParts',
  description:
    'Пошук запчастин за VIN-кодом автомобіля: вкажіть VIN і потрібну деталь — наш менеджер підбере точний варіант для вашого авто і зв\'яжеться з вами. Доставка по всій Україні.',
};

const STEPS = [
  {
    title: '1. Вкажіть VIN-код',
    text: 'VIN написаний у техпаспорті авто або на маркуванні кузова — 17 символів, літери та цифри.',
  },
  {
    title: '2. Опишіть деталь',
    text: 'Напишіть, яку запчастину шукаєте — навіть якщо не знаєте точного артикула.',
  },
  {
    title: '3. Ми підберемо і зв\'яжемось',
    text: 'Менеджер перевірить деталь саме під ваше покоління, комплектацію і двигун, і зателефонує з варіантами.',
  },
];

export default function VinPickupPage() {
  return (
    <div className="min-h-screen" style={{ background: TECH_BG, color: TECH_INK, fontFamily: TECH_BODY_FONT }}>
      <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
        <nav className="mb-5 text-xs" aria-label="Хлібні крихти" style={{ color: TECH_FAINT }}>
          <Link href="/" className="transition-colors hover:text-[#60A5FA]" style={{ color: TECH_MUTED }}>
            Головна
          </Link>{' '}
          / <span>Підбір за VIN</span>
        </nav>

        <h1
          className="mb-4 text-3xl md:text-4xl"
          style={{ fontFamily: TECH_DISPLAY_FONT, fontWeight: 600, letterSpacing: '-0.01em', color: '#fff' }}
        >
          Пошук запчастин за VIN-кодом вашого авто
        </h1>

        <p className="mb-8 max-w-2xl text-sm leading-relaxed md:text-base" style={{ color: TECH_MUTED }}>
          Не знаєте точний артикул або сумніваєтесь, чи підійде деталь саме до вашої комплектації? Залиште
          VIN-код автомобіля — і ми підберемо запчастину точно під ваше авто, без ризику помилки з
          поколінням чи модифікацією двигуна.
        </p>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {STEPS.map((step) => (
                <div key={step.title} className="rounded-xl p-4" style={{ background: TECH_SURFACE_2, border: `1px solid ${TECH_BORDER}` }}>
                  <div className="mb-1 text-sm font-semibold" style={{ fontFamily: TECH_DISPLAY_FONT, color: '#fff' }}>
                    {step.title}
                  </div>
                  <div className="text-xs leading-relaxed" style={{ color: TECH_MUTED }}>
                    {step.text}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-xs leading-relaxed" style={{ color: TECH_FAINT }}>
              Підбір за VIN-кодом — безкоштовна послуга. Ви нічим не ризикуєте: менеджер зв&apos;яжеться з
              вами лише щоб уточнити деталі та назвати ціну, оформлення замовлення — за вашим підтвердженням.
              Також можна знайти запчастину самостійно — переглянути{' '}
              <Link href="/category" style={{ color: TECH_ACCENT_BRIGHT }} className="underline-offset-2 hover:underline">
                категорії автозапчастин
              </Link>{' '}
              або скористатись пошуком за артикулом на{' '}
              <Link href="/" style={{ color: TECH_ACCENT_BRIGHT }} className="underline-offset-2 hover:underline">
                головній сторінці
              </Link>
              .
            </p>
          </div>

          <VinLandingForm />
        </div>
      </div>
    </div>
  );
}
