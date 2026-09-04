// ============================================================
// ФАЗА 1 імпорту: один прохід по дампу, який будує в пам'яті ЛИШЕ
// те, що потрібно для фази 2 (scripts/tecdoc/import-dump.ts) — і
// НІКОЛИ не тримає в пам'яті повні таблиці articles (5 млн рядків):
//
//   brandsById         — id -> назва бренду запчастини (таблиця
//                         `brands`, 3068 рядків, тримаємо ВСЮ — крихітна)
//   manufacturersById  — id -> назва виробника/марки авто (таблиця
//                         `manufacturers`, 657 рядків, тримаємо ВСЮ)
//   modelsById         — id -> {manufacturerId, yearFrom, yearTo}
//                         (таблиця `models`, 12 500 рядків, тримаємо ВСЮ)
//   modelDesTextId     — models.id -> des_texts.id з людською назвою
//                         моделі (напр. 4755 -> 564249, де des_texts.id
//                         564249 = "LAND CRUISER (_J4_)"). Сам текст
//                         резолвиться ОКРЕМИМ проходом у modelNames.ts —
//                         тут лише id, бо на момент цього рядка таблиця
//                         des_texts (1,25 млн рядків) ще могла не
//                         зустрітись у файлі
//   matchedArticles    — tecdoc article_id -> {brand, article}, і ЛИШЕ
//                         для тих рядків `articles`, чий очищений
//                         артикул реально є у ВАШІЙ products.article.
//                         Це і є те звуження "тільки перетин з нашим
//                         каталогом", яке ви попросили — замість усіх
//                         4 981 555 рядків articles у пам'яті лишається
//                         щонайбільше стільки записів, скільки різних
//                         артикулів у вашому власному каталозі
//   articleTypeIds     — articleId -> Set<TYP_ID> — до яких конкретних
//                         модифікацій авто (двигун+кузов+роки, не просто
//                         "модель") підходить кожен наш артикул. Будується
//                         у ДВА кроки нижче (link_art -> link_la_typ)
//   typesById          — TYP_ID -> {modelId, ccm, litres, yearFrom,
//                         yearTo}, ЛИШЕ для TYP_ID з articleTypeIds
//
// Структура реального дампу з'ясована ЕМПІРИЧНО за зразками реальних
// рядків — АЛЕ, на відміну від попередньої версії цього коментаря,
// цей КОНКРЕТНИЙ дамп (tecdoc2016q1.sql) виявився не "HeidiSQL-експортом
// без жодних назв колонок": кожен INSERT INTO в ньому МІСТИТЬ повний
// список назв колонок (`INSERT INTO \`models\` (\`MOD_ID\`, \`MOD_MFA_ID\`,
// ...) VALUES ...`), просто без окремих CREATE TABLE. Тобто колонки
// нижче — не здогадки "по 4 зразках рядків", а прочитані буквально
// з самого файлу (грепом по `INSERT INTO \`таблиця\``):
//
//   brands(BRA_ID, BRA_MFC_CODE, BRA_BRAND, BRA_MF_NR)
//   manufacturers(MFA_ID, MFA_PC_MFC, MFA_CV_MFC, MFA_AXL_MFC,
//                 MFA_ENG_MFC, MFA_ENG_TYP, MFA_MFC_CODE, MFA_BRAND, MFA_MF_NR)
//   articles(ART_ID, ART_ARTICLE_NR, ART_SUP_ID, ART_DES_ID, ...)
//   models(MOD_ID, MOD_MFA_ID, MOD_CDS_ID, MOD_PCON_START, MOD_PCON_END, ...)
//   country_designations(CDS_ID, CDS_LNG_ID, CDS_TEX_ID)
//   des_texts(TEX_ID, TEX_TEXT)
//   link_art(LA_ID, LA_ART_ID, LA_GA_ID, LA_SORT)              — !! НЕ
//            містить посилання на модель авто взагалі (LA_SORT — це
//            просто порядковий номер сортування, а не model_id — саме
//            цю колонку попередня версія коду ПОМИЛКОВО читала як
//            model_id, через що вже завантажені 192 тис. рядків
//            tecdoc_compatibility мали випадкову/неправильну марку
//            й модель для більшості товарів)
//   link_la_typ(LAT_TYP_ID, LAT_LA_ID, LAT_GA_ID, LAT_SUP_ID, LAT_SORT)
//   types(TYP_ID, TYP_CDS_ID, TYP_MMT_CDS_ID, TYP_MOD_ID, TYP_SORT,
//         TYP_PCON_START, TYP_PCON_END, ..., TYP_CCM, ..., TYP_LITRES, ...)
//
// РЕАЛЬНИЙ ланцюжок "деталь -> конкретна модифікація авто" (перевірено
// на реальних рядках дампу):
//   articles.ART_ID (= наш matchedArticles)
//     -> link_art: LA_ART_ID = article.id, беремо LA_ID
//       -> link_la_typ: LAT_LA_ID = LA_ID, беремо LAT_TYP_ID
//         -> types: TYP_ID = LAT_TYP_ID, дає TYP_MOD_ID (=models.id),
//            TYP_CCM/TYP_LITRES (об'єм двигуна!) і TYP_PCON_START/END
//            (точніший рік випуску САМЕ цієї модифікації, а не всієї моделі)
//           -> models: id = TYP_MOD_ID, дає manufacturer_id
//             -> manufacturers: id = manufacturer_id, дає марку
//
// НАЗВА МОДЕЛІ (напр. "Avensis") — окремий ланцюжок, знайдений
// емпірично (перебором конкретних значень по всьому дампу, див. чат):
// models.id НЕ дорівнює tecdoc_code, який реально зустрічається в
// country_designations — але зв'язок ДЕТЕРМІНОВАНИЙ і підтверджений
// на 30/30 різних виробників: tecdoc_code = 110 000 000 + models.id.
// Тобто щоб знайти назву моделі з id=4755: рахуємо
// tecdoc_code=110004755, шукаємо рядок country_designations із таким
// col0, беремо його des_text_id (col2), а сам текст — окремим
// проходом по des_texts (див. scripts/tecdoc/modelNames.ts — це
// ОКРЕМИЙ від цього файлу прохід, бо на момент зустрічі
// country_designations у файлі des_texts (1,25 млн рядків) міг ще не
// траплятися, і навпаки)
//
// Колонки поза цим списком (є в реальних рядках, але не потрібні для
// кросів/застосовності) свідомо ігноруються
// ============================================================

import { readDump } from './dumpReader';
import { cleanArticle } from './cleanArticle';

// tecdoc_code = TECDOC_CODE_OFFSET + models.id (див. пояснення вище)
export const TECDOC_CODE_OFFSET = 110_000_000;

// Точні кількості рядків у ЦЬОМУ КОНКРЕТНОМУ файлі
// (tecdoc2016q1.sql), отримані одноразовим повним `npm run
// tecdoc:inspect`. Використовуються ЛИШЕ як необов'язкова оптимізація
// раннього виходу зі сканування (щоб не читати весь 12,7-гігабайтний
// файл до кінця, якщо потрібні таблиці вже повністю зібрані) — якщо
// ви імпортуєте ІНШИЙ дамп TecDoc, ці числа не збігатимуться: нічого
// не зламається, скрипт просто прочитає файл повністю, а не зупиниться
// раніше (early exit — це прискорення, не умова коректності)
const KNOWN_ROW_COUNTS = {
  articles: 4_981_555,
  brands: 3_068,
  manufacturers: 657,
  models: 12_500,
};

export interface ModelInfo {
  manufacturerId: number;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface MatchedArticle {
  brand: string;
  article: string;
}

// Дані однієї конкретної модифікації авто (types.TYP_ID) — двигун
// (ccm/litres) і рік випуску тут ТОЧНІШІ за рівень models, бо
// стосуються саме цієї модифікації, а не всієї моделі загалом
export interface TypeInfo {
  modelId: number;
  ccm: number | null;
  litres: number | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface ReferenceData {
  brandsById: Map<number, string>;
  manufacturersById: Map<number, string>;
  modelsById: Map<number, ModelInfo>;
  matchedArticles: Map<number, MatchedArticle>;
  // models.id -> des_texts.id з назвою моделі (ще НЕ сам текст — його
  // резолвить scripts/tecdoc/modelNames.ts окремим проходом)
  modelDesTextId: Map<number, number>;
  // articleId -> Set<TYP_ID> — до яких конкретних модифікацій авто
  // підходить кожен наш артикул (ланцюжок link_art -> link_la_typ)
  articleTypeIds: Map<number, Set<number>>;
  // TYP_ID -> дані модифікації, ЛИШЕ для TYP_ID з articleTypeIds
  typesById: Map<number, TypeInfo>;
}

// YYYYMM (напр. 199109) -> рік (1991). null для порожніх/нульових значень
function yearFromYyyymm(value: unknown): number | null {
  const num = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  const year = Math.floor(num / 100);
  return year > 1900 && year < 2100 ? year : null;
}

class EarlyExit extends Error {}

export async function loadReferenceData(
  dumpPath: string,
  ourArticles: ReadonlySet<string>,
  onProgress?: (linesRead: number, elapsedMs: number) => void
): Promise<ReferenceData> {
  const brandsById = new Map<number, string>();
  const manufacturersById = new Map<number, string>();
  const modelsById = new Map<number, ModelInfo>();
  const matchedArticles = new Map<number, MatchedArticle>();
  const modelDesTextId = new Map<number, number>();
  const articleTypeIds = new Map<number, Set<number>>();
  const typesById = new Map<number, TypeInfo>();

  // link_art.LA_ID -> наш articleId, ЛИШЕ для рядків link_art, чий
  // LA_ART_ID є серед matchedArticles. Проміжна мапа: потрібна лише
  // щоб на наступному кроці (link_la_typ) впізнати "цей LAT_LA_ID —
  // це один з НАШИХ товарів", у фінальний ReferenceData не йде
  const laIdToArticleId = new Map<number, number>();

  // Усі TYP_ID, зустрінуті через link_art -> link_la_typ для наших
  // артикулів — саме ці TYP_ID і потрібно "виловити" в таблиці types
  // (яка в файлі йде значно пізніше за link_la_typ), решту мільйони
  // рядків types в пам'яті тримати не потрібно
  const neededTypeIds = new Set<number>();

  // Окремий лічильник — скільки рядків articles РЕАЛЬНО побачили
  // (а не скільки з них збіглося з нашим каталогом): matchedArticles.size
  // для цього не годиться, бо майже завжди набагато МЕНШИЙ за повну
  // кількість рядків articles у дампі
  let articlesSeen = 0;

  // articleId -> brandId для зматчених артикулів. Заповнюється під час
  // читання файлу (коли brandsById може ще бути неповним — порядок
  // таблиць у дампі наперед невідомий), а резолвиться у справжню назву
  // бренду вже ПІСЛЯ читання, коли brandsById гарантовано повний
  const matchedArticleBrandIds = new Map<number, number>();

  try {
    await readDump(dumpPath, {
      onInsertRows(table, rows) {
        if (table === 'brands') {
          for (const row of rows) {
            const id = Number(row[0]);
            const name = String(row[2] ?? row[1] ?? '').trim();
            if (Number.isFinite(id) && name) brandsById.set(id, name);
          }
        } else if (table === 'manufacturers') {
          for (const row of rows) {
            const id = Number(row[0]);
            const name = String(row[7] ?? row[6] ?? '').trim();
            if (Number.isFinite(id) && name) manufacturersById.set(id, name);
          }
        } else if (table === 'models') {
          for (const row of rows) {
            const id = Number(row[0]);
            if (!Number.isFinite(id)) continue;
            modelsById.set(id, {
              manufacturerId: Number(row[1]),
              yearFrom: yearFromYyyymm(row[3]),
              yearTo: yearFromYyyymm(row[4]),
            });
          }
        } else if (table === 'country_designations') {
          // col0 — tecdoc_code (= TECDOC_CODE_OFFSET + models.id, див.
          // пояснення на початку файлу), АЛЕ ця сама таблиця
          // використовується TecDoc і для інших сутностей теж (у
          // перших знайдених зразках траплялось col0=99988318, що НЕ
          // влучає в діапазон моделей) — фільтр по діапазону відсіює
          // все, крім реальних моделей. Верхня межа 200 000 — із
          // великим запасом понад відомі 12 500 рядків models
          for (const row of rows) {
            const tecdocCode = Number(row[0]);
            if (
              !Number.isFinite(tecdocCode) ||
              tecdocCode < TECDOC_CODE_OFFSET ||
              tecdocCode > TECDOC_CODE_OFFSET + 200_000
            ) {
              continue;
            }
            const modelId = tecdocCode - TECDOC_CODE_OFFSET;
            // Лишаємо ПЕРШИЙ знайдений варіант назви для моделі — у
            // моделей з кількома країнами/мовами (напр. 8 рядків для
            // однієї моделі в наших зразках) назва зазвичай однакова
            // в усіх, тож немає сенсу перебирати їх усі
            if (modelDesTextId.has(modelId)) continue;
            const desTextId = Number(row[2]);
            if (Number.isFinite(desTextId)) modelDesTextId.set(modelId, desTextId);
          }
        } else if (table === 'articles') {
          articlesSeen += rows.length;
          for (const row of rows) {
            const clean = cleanArticle(row[1]);
            if (clean && ourArticles.has(clean)) {
              matchedArticles.set(Number(row[0]), { brand: '', article: clean });
              // brand заповнюємо пізніше, ОДНИМ проходом по matchedArticles
              // вже ПІСЛЯ повного читання файлу — на момент цього рядка
              // маппінг brandsById може ще не бути повним (порядок таблиць
              // у дампі наперед невідомий), тому зберігаємо тут id бренду
              // окремо і резолвимо назву вже потім
              matchedArticleBrandIds.set(Number(row[0]), Number(row[2]));
            }
          }
        } else if (table === 'link_art') {
          // LA_ID(0), LA_ART_ID(1), LA_GA_ID(2), LA_SORT(3) — посилання
          // на модель авто тут НЕМАЄ (LA_SORT — це порядок сортування,
          // а не model_id). Тут лише запам'ятовуємо LA_ID для НАШИХ
          // артикулів, щоб на кроці link_la_typ впізнати "це наш товар"
          for (const row of rows) {
            const articleId = Number(row[1]);
            if (!matchedArticles.has(articleId)) continue;
            laIdToArticleId.set(Number(row[0]), articleId);
          }
        } else if (table === 'link_la_typ') {
          // LAT_TYP_ID(0), LAT_LA_ID(1), ... — ось де насправді
          // з'являється модифікація авто (TYP_ID), до якої підходить деталь
          for (const row of rows) {
            const articleId = laIdToArticleId.get(Number(row[1]));
            if (articleId === undefined) continue;

            const typId = Number(row[0]);
            let typeIds = articleTypeIds.get(articleId);
            if (!typeIds) {
              typeIds = new Set();
              articleTypeIds.set(articleId, typeIds);
            }
            typeIds.add(typId);
            neededTypeIds.add(typId);
          }
        } else if (table === 'types') {
          // TYP_ID(0), TYP_CDS_ID(1), TYP_MMT_CDS_ID(2), TYP_MOD_ID(3),
          // TYP_SORT(4), TYP_PCON_START(5), TYP_PCON_END(6), ..., TYP_CCM(11),
          // ..., TYP_LITRES(30), ... — тримаємо ЛИШЕ потрібні TYP_ID
          // (з neededTypeIds), а не всю таблицю
          for (const row of rows) {
            const typId = Number(row[0]);
            if (!neededTypeIds.has(typId)) continue;

            const ccm = row[11];
            const litres = row[30];
            typesById.set(typId, {
              modelId: Number(row[3]),
              yearFrom: yearFromYyyymm(row[5]),
              yearTo: yearFromYyyymm(row[6]),
              ccm: typeof ccm === 'number' ? ccm : null,
              litres: typeof litres === 'number' ? litres : null,
            });
          }
        }

        // Довідники (brands/manufacturers/models/articles) готові десь
        // біля позиції models у файлі — а це ще ДО того, як у файлі
        // взагалі починається таблиця types (вона йде останньою з
        // потрібних нам). Тому до чотирьох умов знизу додається п'ята:
        // усі TYP_ID, зібрані через link_art -> link_la_typ, вже мають
        // знайтись у typesById. Оскільки link_la_typ у файлі йде значно
        // РАНІШЕ за models/manufacturers, на момент, коли перші чотири
        // умови стають істинними, neededTypeIds вже остаточний — можна
        // безпечно порівнювати розміри
        if (
          brandsById.size >= KNOWN_ROW_COUNTS.brands &&
          manufacturersById.size >= KNOWN_ROW_COUNTS.manufacturers &&
          modelsById.size >= KNOWN_ROW_COUNTS.models &&
          articlesSeen >= KNOWN_ROW_COUNTS.articles &&
          typesById.size >= neededTypeIds.size
        ) {
          throw new EarlyExit();
        }
      },
      progressEveryLines: 5_000_000,
      onProgress: onProgress ? (stats) => onProgress(stats.linesRead, stats.elapsedMs) : undefined,
    });
  } catch (error) {
    if (!(error instanceof EarlyExit)) throw error;
  }

  // Резолвимо назву бренду для кожного зматченого артикула тепер, коли
  // brandsById гарантовано повний (файл дочитано повністю або раннього
  // виходу досягнуто ЛИШЕ після того, як brands теж повністю зібрано)
  for (const [articleId, match] of matchedArticles) {
    const brandId = matchedArticleBrandIds.get(articleId);
    match.brand = (brandId !== undefined ? brandsById.get(brandId) : undefined) || 'TECDOC';
  }

  return {
    brandsById,
    manufacturersById,
    modelsById,
    matchedArticles,
    modelDesTextId,
    articleTypeIds,
    typesById,
  };
}
