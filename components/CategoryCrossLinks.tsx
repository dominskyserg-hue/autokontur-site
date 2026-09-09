// ============================================================
// Крос-лінки між сторінками категорій (app/category/[slug]/page.tsx).
//
// Два незалежні блоки — простий серверний компонент без клієнтського
// JS, лише посилання. Дані беруться з уже завантаженого в пам'ять
// масиву CATEGORIES (lib/categories.ts) — жодного додаткового запиту
// до бази.
//
//   kind="model"    — на ВУЗЬКІЙ сторінці ("Кульові опори Pajero II")
//                      показує сусідні вузькі сторінки під ТУ Ж машину
//                      ("Амортизатори Pajero II") — getRelatedByModel()
//   kind="variants" — на ШИРОКІЙ сторінці ("Гальмівні колодки")
//                      показує вузькі варіанти під конкретні моделі —
//                      getNarrowVariants()
//
// Компонент сам вирішує, чи є що показувати, і повертає null, якщо
// список порожній — викликати можна безумовно з боку сторінки
// ============================================================

import Link from 'next/link';
import { getNarrowVariants, getRelatedByModel, type CategoryDef } from '@/lib/categories';
import { TECH_BORDER, TECH_FAINT, TECH_MUTED } from '@/lib/techTheme';

interface CategoryCrossLinksProps {
  category: CategoryDef;
  kind: 'model' | 'variants';
}

export default function CategoryCrossLinks({ category, kind }: CategoryCrossLinksProps) {
  const items = kind === 'model' ? getRelatedByModel(category) : getNarrowVariants(category.slug);
  if (items.length === 0) return null;

  const title = kind === 'model' ? `Інші запчастини для ${category.modelLabel}` : 'Популярні моделі для цієї категорії';

  return (
    <div className="pt-6" style={{ borderTop: `1px solid ${TECH_BORDER}` }}>
      <h2 className="mb-3 text-sm font-semibold" style={{ color: TECH_FAINT }}>
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((c) => (
          <Link
            key={c.slug}
            href={`/category/${c.slug}`}
            className="rounded-full px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[rgba(59,130,246,0.08)]"
            style={{ border: `1px solid ${TECH_BORDER}`, color: TECH_MUTED }}
          >
            {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
