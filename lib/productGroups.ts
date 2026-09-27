// ============================================================
// ГРУППЫ "ОДИН БРЕНД + АРТИКУЛ — НЕСКОЛЬКО ПОСТАВЩИКОВ"
// ============================================================
// Один и тот же артикул (напр. MITSUBISHI MR377487) приходит от 2–8
// поставщиков, и у каждого была своя страница /p/… с почти одинаковым
// текстом (96–99% общих слов). Google считал их копиями (Search Console:
// "Страница является копией"), а всего таких лишних адресов ~44 тыс.
//
// Решение (шаг 1, без 301): у группы одна ГЛАВНАЯ страница — самый
// старый активный товар (created_at, затем id). Выбор устойчивый: главная
// не меняется вместе с ценой и наличием, иначе Google "прыгал" бы между
// адресами. Остальные страницы группы — с canonical на главную; в sitemap,
// списках, хабах и "схожих" — только главная, с лучшим предложением группы.
//
// Данные групп считаются заранее (recomputeProductGroups) и лежат в
// колонках products (schema.sql, блок "ГРУППЫ БРЕНД + АРТИКУЛ"):
//   group_primary_id    — id главной (у главной — свой id; у одиночек NULL);
//   is_group_primary    — false у двойников (их нет в списках и sitemap);
//   group_offer_count   — сколько активных предложений в группе (у главной);
//   group_best_offer_id — лучшее предложение: в наличии и дешевле всех;
//   group_image_url     — фото главной или любого из двойников;
//   group_display_name  — самое подробное название группы (для H1);
//   group_other_names   — остальные уникальные названия (до 5), для строки
//                         "Також відомий як" на главной.
// Пересчёт: после импорта прайса (lib/priceListImport.ts), cron
// /api/cron/rebuild-categories, вручную npm run groups:rebuild.
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { buildCleanProductName } from '@/lib/productNameCleanup';
import { buildDisplayProductNameDetailed } from '@/lib/productNameTranslation';
import { ensureUkrainianCorpusFresh } from '@/lib/ukrainianCorpus';

// Включено после подтверждения владельцем отчёта scripts/category-review/groups.md.
// Пока было выключено, отчёты включали группы переменной окружения PRODUCT_GROUPS=1
const PRODUCT_GROUPS_ENABLED = true;
export const PRODUCT_GROUPS_ACTIVE =
  PRODUCT_GROUPS_ENABLED || (typeof process !== 'undefined' && process.env.PRODUCT_GROUPS === '1');

// Сколько других названий показывать в "Також відомий як"
const MAX_OTHER_NAMES = 5;

// Слова, которые не говорят, что это за деталь
const NOISE_WORDS = new Set(['original', 'оригінал', 'оригинал', 'univ', 'акція', 'акция', 'новий', 'новый', 'шт', 'комплект', 'к-кт', 'кт']);

// "Подробность" названия. Главное — сколько разных слов НА КИРИЛЛИЦЕ (что
// это за деталь: "Гвинт розвалу задній" подробнее, чем "Болт крепления");
// латинские слова (модели авто, коды) — лишь добавка: иначе "Рухома опора
// GARRETT GT4294" обгоняла правильное "Кільця турбіни". Бренд, артикул и
// служебные слова не считаются. При равенстве — длиннее
export function nameDetailScore(name: string, brand: string | null, article: string): number {
  const clean = (buildCleanProductName(name) ?? name).toLowerCase();
  const skip = new Set([...(brand ?? '').toLowerCase().split(/\s+/), article.toLowerCase()]);
  const words = new Set(
    clean.split(/[^a-zа-яіїєґё0-9]+/).filter((w) => w.length >= 3 && !skip.has(w) && !NOISE_WORDS.has(w) && !/^\d+$/.test(w))
  );
  const cyrillic = [...words].filter((w) => /[а-яіїєґё]/.test(w)).length;
  return cyrillic * 1000 + (words.size - cyrillic) * 100 + Math.min(clean.length, 99);
}

export interface GroupMember {
  id: string;
  name: string | null;
  brand: string | null;
  article: string;
  stock: number;
  retailPrice: number;
  imageUrl: string | null;
  createdAt: Date;
}

export interface GroupResult {
  primaryId: string;
  bestOfferId: string;
  imageUrl: string | null;
  displayName: string;
  otherNames: string[];
}

// Одна группа → главная, лучшее предложение, название для H1 и "Також відомий як"
export function resolveGroup(members: GroupMember[]): GroupResult {
  const byAge = [...members].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const primary = byAge[0];
  const inStock = members.filter((m) => m.stock > 0);
  const best = [...(inStock.length > 0 ? inStock : members)].sort((a, b) => a.retailPrice - b.retailPrice || a.id.localeCompare(b.id))[0];

  // Уникальные названия (без учёта регистра и лишних пробелов), в порядке "подробности"
  const unique = new Map<string, string>();
  for (const m of members) {
    const name = (buildCleanProductName(m.name) ?? m.name ?? '').replace(/\s+/g, ' ').trim();
    if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), m.name ?? name);
  }
  // Сначала — названия, которые НАДЁЖНО переводятся на украинский (тот же
  // перевод, что строит H1, lib/productNameTranslation.ts): иначе H1 главной
  // остался бы русским, как "Сальник штока муфты ... (original)". Среди них —
  // самое подробное; если не переводится ни одно — просто самое подробное
  const translatable = (name: string) => Boolean(buildDisplayProductNameDetailed(name)?.safe);
  const ranked = [...unique.values()].sort(
    (a, b) =>
      Number(translatable(b)) - Number(translatable(a)) ||
      nameDetailScore(b, primary.brand, primary.article) - nameDetailScore(a, primary.brand, primary.article)
  );
  const displayName = ranked[0] ?? primary.name ?? '';
  const otherNames = ranked.slice(1, 1 + MAX_OTHER_NAMES).map((n) => (buildCleanProductName(n) ?? n).replace(/\s+/g, ' ').trim());

  return {
    primaryId: primary.id,
    bestOfferId: best.id,
    imageUrl: primary.imageUrl ?? members.find((m) => m.imageUrl)?.imageUrl ?? null,
    displayName,
    otherNames,
  };
}

// Все группы (2+ активных предложения с одним брендом и артикулом) — из базы
export async function loadProductGroups(db: Pool | PoolClient): Promise<Map<string, GroupMember[]>> {
  // Словарь украинских слов для проверки перевода названий (resolveGroup)
  await ensureUkrainianCorpusFresh(db as Pool);
  const result = await db.query(`
    SELECT id, name, brand, article, stock, retail_price, image_url, created_at, upper(brand) || '|' || article AS key
    FROM (
      SELECT p.*, count(*) OVER (PARTITION BY upper(p.brand), p.article) AS n
      FROM products p
      WHERE p.is_active = true AND p.brand IS NOT NULL AND p.brand <> '' AND p.article <> ''
    ) t
    WHERE n > 1`);
  const groups = new Map<string, GroupMember[]>();
  for (const row of result.rows) {
    if (!groups.has(row.key)) groups.set(row.key, []);
    groups.get(row.key)!.push({
      id: row.id,
      name: row.name,
      brand: row.brand,
      article: row.article,
      stock: row.stock,
      retailPrice: parseFloat(row.retail_price),
      imageUrl: row.image_url,
      createdAt: new Date(row.created_at),
    });
  }
  return groups;
}

// Пересчёт колонок групп для всего каталога. Пишет только изменившиеся строки
export async function recomputeProductGroups(pool: Pool): Promise<{ groups: number; members: number; changed: number; ms: number }> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const groups = await loadProductGroups(client);

    const ids: string[] = [];
    const primaryIds: string[] = [];
    const isPrimary: boolean[] = [];
    const offerCounts: number[] = [];
    const bestIds: (string | null)[] = [];
    const images: (string | null)[] = [];
    const displayNames: (string | null)[] = [];
    const otherNames: (string | null)[] = [];
    for (const members of groups.values()) {
      const g = resolveGroup(members);
      for (const m of members) {
        const primary = m.id === g.primaryId;
        ids.push(m.id);
        primaryIds.push(g.primaryId);
        isPrimary.push(primary);
        offerCounts.push(primary ? members.length : 1);
        bestIds.push(primary ? g.bestOfferId : null);
        images.push(primary ? g.imageUrl : null);
        displayNames.push(primary ? g.displayName : null);
        // Массив в JSON: в unnest() нельзя передать массив массивов разной длины
        otherNames.push(primary ? JSON.stringify(g.otherNames) : null);
      }
    }

    await client.query(`CREATE TEMP TABLE tmp_groups ON COMMIT DROP AS
      SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::boolean[], $4::int[], $5::uuid[], $6::text[], $7::text[], $8::text[])
        AS t(id, primary_id, is_primary, offer_count, best_id, image_url, display_name, other_names)`,
      [ids, primaryIds, isPrimary, offerCounts, bestIds, images, displayNames, otherNames]);

    // Участники групп — новые значения (только если что-то изменилось)
    const updated = await client.query(`
      UPDATE products p SET
        group_primary_id = t.primary_id,
        is_group_primary = t.is_primary,
        group_offer_count = t.offer_count,
        group_best_offer_id = t.best_id,
        group_image_url = t.image_url,
        group_display_name = t.display_name,
        group_other_names = CASE WHEN t.other_names IS NULL THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(t.other_names::jsonb)) END
      FROM tmp_groups t
      WHERE p.id = t.id AND (
        p.group_primary_id IS DISTINCT FROM t.primary_id OR p.is_group_primary IS DISTINCT FROM t.is_primary
        OR p.group_offer_count IS DISTINCT FROM t.offer_count OR p.group_best_offer_id IS DISTINCT FROM t.best_id
        OR p.group_image_url IS DISTINCT FROM t.image_url OR p.group_display_name IS DISTINCT FROM t.display_name
        OR p.group_other_names IS DISTINCT FROM (CASE WHEN t.other_names IS NULL THEN NULL
          ELSE ARRAY(SELECT jsonb_array_elements_text(t.other_names::jsonb)) END))`);

    // Товары, которые больше не в группе (двойник ушёл или стал неактивным) — сброс
    const reset = await client.query(`
      UPDATE products p SET group_primary_id = NULL, is_group_primary = true, group_offer_count = 1,
        group_best_offer_id = NULL, group_image_url = NULL, group_display_name = NULL, group_other_names = NULL,
        group_best_price = NULL, group_best_cost = NULL, group_best_discount = NULL, group_best_stock = NULL,
        group_best_supplier_id = NULL, group_min_price = NULL, group_max_price = NULL, group_in_stock = NULL
      WHERE (p.group_primary_id IS NOT NULL OR p.is_group_primary = false)
        AND NOT EXISTS (SELECT 1 FROM tmp_groups t WHERE t.id = p.id)`);

    // Готовые поля лучшего предложения (цена, наличие, мин./макс.) — для всех
    // главных страниц; дальше их поддерживает триггер при каждом изменении цены
    await client.query(`SELECT refresh_product_group_offers(ARRAY(SELECT DISTINCT primary_id FROM tmp_groups))`);

    await client.query('COMMIT');
    return { groups: groups.size, members: ids.length, changed: (updated.rowCount ?? 0) + (reset.rowCount ?? 0), ms: Date.now() - started };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Для фоновых вызовов (после импорта, cron): ошибка не должна ронять импорт
export async function recomputeProductGroupsSafely(pool: Pool): Promise<void> {
  try {
    const r = await recomputeProductGroups(pool);
    console.log(`Группы бренд+артикул пересчитаны: групп ${r.groups}, товаров ${r.members}, изменено ${r.changed}, ${r.ms} мс`);
  } catch (error) {
    console.error('Ошибка пересчёта групп бренд+артикул:', error);
  }
}

// ------------------------------------------------------------
// SQL для списков товаров (категории, марки, ТО, поиск, "схожие")
// ------------------------------------------------------------
// Список строится по ГЛАВНЫМ страницам групп (p), а цена, наличие, срок
// доставки и кнопка "Купити" — по ЛУЧШЕМУ предложению группы (b). Поля
// лучшего предложения хранятся у главной (group_best_*, их обновляет
// триггер в базе при любом изменении цены/наличия, schema.sql), поэтому b —
// это не соединение таблицы с самой собой, а просто те же поля строки p
// (у одиночек — собственные поля товара). Так список не медленнее, чем до групп
export function groupedListSql(): { join: string; where: string; image: string; name: string; offerCount: string } {
  if (!PRODUCT_GROUPS_ACTIVE) {
    return { join: 'JOIN products b ON b.id = p.id', where: 'true', image: 'p.image_url', name: 'p.name', offerCount: '1' };
  }
  return {
    join: `CROSS JOIN LATERAL (SELECT
      COALESCE(p.group_best_offer_id, p.id) AS id,
      COALESCE(p.group_best_cost, p.cost_price) AS cost_price,
      COALESCE(p.group_best_price, p.retail_price) AS retail_price,
      COALESCE(p.group_best_discount, p.discount_percent) AS discount_percent,
      COALESCE(p.group_best_stock, p.stock) AS stock,
      COALESCE(p.group_best_supplier_id, p.supplier_id) AS supplier_id) b`,
    where: 'p.is_group_primary',
    image: 'COALESCE(p.image_url, p.group_image_url)',
    // Самое подробное название группы (то же, что в H1 главной)
    name: 'COALESCE(p.group_display_name, p.name)',
    offerCount: 'p.group_offer_count',
  };
}

// ORDER BY для списков по группам: наличие и цена — лучшего предложения (b),
// фото — главной или любого двойника
export function groupedOrderBy(orderBy: string): string {
  if (!PRODUCT_GROUPS_ACTIVE) return orderBy;
  return orderBy
    .replace(/\(p\.stock > 0\)/g, '(b.stock > 0)')
    .replace(/p\.retail_price/g, 'b.retail_price')
    .replace(/\(p\.image_url IS NOT NULL\)/g, '(COALESCE(p.image_url, p.group_image_url) IS NOT NULL)');
}
