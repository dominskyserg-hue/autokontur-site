// ============================================================
// "Пустое" название товара — без описания самой детали:
//   "Деталь двигуна TEIKIN 46343100", "Деталі кузова MAZDA GHP950111".
// Такие товары не показываются в хабах моделей (lib/modelHubData.ts):
// покупателю по ним не понять, что это за деталь.
//
// Название пустое, если после удаления общих слов (деталь, двигуна,
// кузова, запчастина...), бренда, артикула, названий марок авто и кодов с
// цифрами в нём не осталось ни одного слова из 3+ букв
// ============================================================

import { CAR_MAKES } from '@/lib/carMakes';

const GENERIC_WORDS = new Set([
  'деталь', 'деталі', 'детали', 'деталей', 'двигуна', 'двигателя', 'двигун', 'двигатель', 'кузова', 'кузов',
  'підвіски', 'подвески', 'салону', 'салона', 'запчастина', 'запчастини', 'запчасть', 'запчасти', 'автозапчастина',
  'автозапчасти', 'автозапчастини', 'оригінал', 'оригинал', 'оригінальна', 'оригинальная', 'original', 'genuine',
  'part', 'parts', 'spare', 'товар', 'виріб', 'изделие', 'елемент', 'элемент', 'комплектуючі', 'для', 'авто',
  'автомобіля', 'автомобиля', 'новий', 'новый', 'шт',
]);

const MAKE_WORDS = new Set(
  CAR_MAKES.flatMap((make) => [make.name, ...make.dbValues].flatMap((value) => value.toLowerCase().split(/[\s-]+/)))
);
const MAKE_STEMS = CAR_MAKES.flatMap((make) => make.cyrillicStems.map((stem) => stem.toLowerCase()));

export function isEmptyPartName(name: string | null, brand: string | null, article: string): boolean {
  const brandWords = new Set((brand ?? '').toLowerCase().split(/[^a-zа-яіїєґё0-9]+/).filter(Boolean));
  const articleKey = article.toLowerCase().replace(/[^a-zа-я0-9]/g, '');
  const words = (name ?? '')
    .toLowerCase()
    .split(/[^a-zа-яіїєґё0-9]+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !/[0-9]/.test(word))
    .filter((word) => word !== articleKey && !brandWords.has(word))
    .filter((word) => !GENERIC_WORDS.has(word))
    .filter((word) => !MAKE_WORDS.has(word) && !MAKE_STEMS.some((stem) => word.startsWith(stem)));
  return words.length === 0;
}
