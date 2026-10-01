// ============================================================
// Бейдж "На нашому складі · відправка сьогодні" — для деталей, которые
// физически лежат у НАС (lib/ownStock.ts), а не у поставщика. Такие
// детали отправляем в день заказа, поэтому выделяем их ярче обычного
// "В наявності". Используется на карточке товара, в поиске, категориях
// и на страницах марок — одинаковый вид везде.
//
// Без 'use client': компонент без состояния, рендерится и на сервере
// (страницы категорий), и внутри клиентских компонентов (поиск)
// ============================================================

// dispatchText — когда отправим ("сьогодні" / "завтра"), из
// lib/deliveryEstimate.ts: после SAME_DAY_CUTOFF_HOUR уже не "сьогодні"
export default function OwnStockBadge({
  compact = false,
  dispatchText = 'сьогодні',
}: {
  compact?: boolean;
  dispatchText?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: '#10B981', color: '#04110C', boxShadow: '0 0 0 1px rgba(16,185,129,0.45)' }}
      title="Деталь лежить на нашому складі — відправимо найшвидше"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {compact ? 'На нашому складі' : `На нашому складі · відправка ${dispatchText}`}
    </span>
  );
}
