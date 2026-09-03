// ============================================================
// ТОЧНО ТА САМА функція очищення артикула, що й у решті проєкту
// (app/api/suppliers/parse-excel/route.ts, app/api/products/route.ts,
// app/api/products/cross-references/import/route.ts) — прибирає
// пробіли/дефіси/спецсимволи, приводить до верхнього регістру.
//
// КРИТИЧНО важливо використовувати ІДЕНТИЧНУ функцію тут: значення в
// products.article у нашій базі очищені саме нею. Якщо тут очищення
// відрізнятиметься хоч на символ, зв'язки з дампу TecDoc просто не
// зматчаться з нашими реальними товарами при пошуку на сторінці товару
// ============================================================
export function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}
