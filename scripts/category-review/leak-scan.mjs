// ============================================================
// Проверка утечек служебных полей на ПРОДЕ без входа в админку: публичные
// API, страницы (HTML вместе со встроенными данными RSC — self.__next_f),
// sitemap. Ищем cost / purchase / supplier / закуп и поля группы
// (group_best_*, groupBest*). Должно быть 0 совпадений.
//
//   node scripts/category-review/leak-scan.mjs [https://www.dominatorparts.com.ua]
// ============================================================

const B = process.argv[2] ?? 'https://www.dominatorparts.com.ua';
const PATTERN = /cost|purchase|supplier|закуп|group_?best|group_?min|group_?max|group_?in_?stock/gi;

// Товары для проверки: главная группы, двойник, одиночка
const primary = '9f98f7a3-44b0-48b7-a874-2ec50c054aa4';
const twin = '6955ccbd-0e64-4048-9aad-14114ccc8ec4';
const single = '302ca756-0d8c-4a40-9e2d-76d70a84005b';

const targets = [
  // API
  `/api/products?search=55226EN10B&pageSize=10`,
  `/api/products?search=${encodeURIComponent('колодки гальмівні')}&pageSize=24`,
  `/api/products?featured=true&pageSize=8`,
  `/api/products?pageSize=24`,
  `/api/products/images?ids=${primary},${twin},${single}`,
  `/api/products/cross-lookup?article=55226EN10B&brand=NISSAN`,
  `/api/products/cross-lookup?article=P56046&brand=BREMBO`,
  `/api/products/car-options?field=make`,
  `/api/products/${primary}`,
  `/api/products/${primary}/images`,
  `/api/products/${primary}/cross-references`,
  // Страницы (HTML + RSC внутри)
  `/`,
  `/p/${primary}/x`,
  `/p/${twin}/x`,
  `/p/${single}/x`,
  `/category/halmivni-kolodky`,
  `/category/prokladky-dvyhuna?page=2`,
  `/category/datchyky?sort=price_asc`,
  `/marky/toyota`,
  `/marky/toyota/to`,
  `/marky/nissan/qashqai-j10`,
  `/rozdil/hodova`,
  // Sitemap
  `/sitemap.xml`,
  `/sitemap-static.xml`,
  `/sitemap-products-1.xml`,
];

let total = 0;
for (const path of targets) {
  const r = await fetch(`${B}${path}`, { redirect: 'follow' });
  const body = await r.text();
  // Чистим безобидные совпадения: имена файлов чанков и т.п. не ожидаются, но покажем контекст всего найденного
  const hits = [...body.matchAll(PATTERN)].map((m) => body.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
  total += hits.length;
  console.log(`${hits.length === 0 ? 'OK   ' : 'НАШЛОСЬ'} ${String(r.status).padEnd(4)} ${String(body.length).padStart(8)} байт  ${path}`);
  for (const h of hits.slice(0, 5)) console.log(`        …${h}…`);
}
console.log(`\nВсего совпадений: ${total}`);
