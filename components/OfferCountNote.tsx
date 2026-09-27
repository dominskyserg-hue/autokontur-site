// ============================================================
// Пометка в карточке списка: "3 пропозиції від 1 040 грн" — если один и
// тот же бренд+артикул есть у нескольких поставщиков (lib/productGroups.ts).
// Карточка показывает лучшее предложение, а все остальные — на странице
// товара. Одно предложение — пометки нет
// ============================================================

const MUTED = '#94A3B8';

// "пропозиція" по-украински: 1 пропозиція, 2–4 пропозиції, 5+ пропозицій
function offersWord(n: number): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'пропозицій';
  if (last === 1) return 'пропозиція';
  if (last >= 2 && last <= 4) return 'пропозиції';
  return 'пропозицій';
}

export default function OfferCountNote({ count, fromPrice }: { count: number; fromPrice: string }) {
  if (!count || count < 2) return null;
  return (
    <div className="mb-1.5 text-xs" style={{ color: MUTED }}>
      {count} {offersWord(count)} від {fromPrice} грн
    </div>
  );
}
