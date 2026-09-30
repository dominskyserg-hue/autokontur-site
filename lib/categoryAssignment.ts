// ============================================================
// ПЕРЕСЧЁТ КАТЕГОРИЙ ТОВАРОВ → таблица product_categories
// ============================================================
// Правила категорий (lib/categories.ts, buildCategoryRuleClause) —
// поиск слов в названии товара. Раньше они выполнялись при КАЖДОМ
// открытии страницы категории; теперь — один раз здесь, результат
// хранится в product_categories, а страницы читают готовую таблицу.
//
// Когда пересчитывается:
//   - после импорта прайса — только товары этого поставщика
//     (lib/priceListImport.ts): названия меняются только при импорте;
//   - ежедневный cron — товары, изменённые за последние 2 дня
//     (страховка, если пересчёт после импорта не успел);
//   - полностью — npm run categories:rebuild (scripts/rebuild-categories.ts),
//     после изменения самих правил.
//
// Всё в одной транзакции: пока идёт пересчёт, страницы видят старый
// набор, после COMMIT — сразу новый (без "пустых" категорий посередине)
// ============================================================

import type { Pool, PoolClient } from 'pg';
import { CATEGORIES, CATEGORIES_STAGE5_ACTIVE, buildCategoryRuleClause } from '@/lib/categories';
import { EXTRA_CATEGORY_RULES, buildExtraRuleCondition } from '@/lib/categoryRulesExtra';
import { twinIsSamePart } from '@/lib/twinMatch';
import { PRODUCT_GROUPS_ACTIVE } from '@/lib/productGroups';

// Дополнительные правила этапа 2 (lib/categoryRulesExtra.ts). Включены после
// проверки владельцем отчёта scripts/category-review/stage2.md.
// После изменения правил — npm run categories:rebuild
const EXTRA_RULES_ENABLED = true;

// Разделы, которые содержат все товары своих подкатегорий (см. шаг 4 пересчёта)
const PARENTS_INCLUDE_CHILDREN = ['remeni-rolyky-grm'];

export type CategoryRecomputeScope =
  | { kind: 'all' }
  | { kind: 'supplier'; supplierId: string }
  | { kind: 'updated_since_days'; days: number };

// Условие "какие товары пересчитываем" + его параметры (нумерация с startIndex)
function scopeFilter(scope: CategoryRecomputeScope, startIndex: number): { sql: string; params: unknown[] } {
  if (scope.kind === 'supplier') return { sql: ` AND p.supplier_id = $${startIndex}`, params: [scope.supplierId] };
  if (scope.kind === 'updated_since_days') {
    return { sql: ` AND p.updated_at > now() - make_interval(days => $${startIndex})`, params: [scope.days] };
  }
  return { sql: '', params: [] };
}

export interface CategoryRecomputeResult {
  products: number;
  assignments: number;
  ms: number;
}

// options.extraRules — включить доп. правила (по умолчанию — флаг EXTRA_RULES_ENABLED).
// Экспортируется для отчёта scripts/category-review/build-stage2.mts: он
// прогоняет пересчёт в транзакции с ROLLBACK, чтобы увидеть результат, не записывая
export async function recomputeInTransaction(
  client: PoolClient,
  scope: CategoryRecomputeScope,
  options: { extraRules?: boolean } = {}
): Promise<CategoryRecomputeResult> {
  const started = Date.now();
  const useExtraRules = options.extraRules ?? EXTRA_RULES_ENABLED;

  // 1. Удаляем старые назначения товаров из области пересчёта
  const del = scopeFilter(scope, 1);
  if (scope.kind === 'all') {
    await client.query('DELETE FROM product_categories');
  } else {
    await client.query(
      `DELETE FROM product_categories pc USING products p WHERE pc.product_id = p.id${del.sql}`,
      del.params
    );
  }

  // 2. Основные правила каждой категории (те же, что были на страницах).
  // Все категории — ОДНИМ запросом (UNION ALL): база далеко от функций
  // Vercel, и 134 отдельных запроса — это 134 поездки туда-обратно
  const selects: string[] = [];
  const params: unknown[] = [];
  for (const category of CATEGORIES) {
    params.push(category.slug);
    const slugIdx = params.length;
    const { clause, params: ruleParams } = buildCategoryRuleClause(category, params.length + 1);
    params.push(...ruleParams);
    const filter = scopeFilter(scope, params.length + 1);
    params.push(...filter.params);
    selects.push(`SELECT p.id, $${slugIdx}::text AS category_id FROM products p WHERE ${clause}${filter.sql}`);
  }
  const inserted = await client.query(
    `INSERT INTO product_categories (product_id, category_id, rule_id)
     SELECT id, category_id, 'base' FROM (${selects.join('\n     UNION ALL\n     ')}) AS matched
     ON CONFLICT (product_id, category_id) DO NOTHING`,
    params
  );
  let assignments = inserted.rowCount ?? 0;

  // 2а. Подкатегории с onlyWithinParent ("Гальмівні колодки передні/задні"):
  // оставляем только товары, которые есть и в родительской категории.
  // До шага 3 — чтобы убранные товары (датчики, тросы) без категории могли
  // получить её по доп. правилам
  const within = CATEGORIES.filter((c) => c.onlyWithinParent && c.parentCategorySlug);
  if (within.length > 0) {
    const withinParams: unknown[] = within.flatMap((c) => [c.slug, c.parentCategorySlug as string]);
    const values = within.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(', ');
    const removed = await client.query(
      `DELETE FROM product_categories pc
       USING (VALUES ${values}) AS v(child, parent)
       WHERE pc.category_id = v.child
         AND NOT EXISTS (SELECT 1 FROM product_categories pp WHERE pp.product_id = pc.product_id AND pp.category_id = v.parent)`,
      withinParams
    );
    assignments -= removed.rowCount ?? 0;
  }

  // 3. Дополнительные правила (lib/categoryRulesExtra.ts) — ТОЛЬКО для
  // товаров, которые после шага 2 остались без категории. Одна категория
  // на товар: CASE берёт первое подходящее правило по порядку списка
  // (порядок = приоритет, см. комментарий в lib/categoryRulesExtra.ts)
  if (useExtraRules) {
    // Один CASE (номер правила), категорию берём из списка по номеру —
    // иначе все регулярки проверялись бы дважды (полный пересчёт шёл ~70 с)
    const extraParams: unknown[] = [];
    const whenRule: string[] = [];
    const ruleValues: string[] = [];
    EXTRA_CATEGORY_RULES.forEach((rule, i) => {
      const { sql, params: ruleParams } = buildExtraRuleCondition(rule, extraParams.length + 1);
      extraParams.push(...ruleParams);
      whenRule.push(`WHEN ${sql} THEN ${i}`);
      ruleValues.push(`(${i}, '${rule.category}', '${rule.id}')`);
    });
    const filter = scopeFilter(scope, extraParams.length + 1);
    extraParams.push(...filter.params);
    const extra = await client.query(
      `INSERT INTO product_categories (product_id, category_id, rule_id)
       SELECT matched.id, r.category_id, r.rule_id FROM (
         SELECT p.id, CASE ${whenRule.join(' ')} END AS rule_no
         FROM products p
         WHERE NOT EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id)${filter.sql}
       ) AS matched
       JOIN (VALUES ${ruleValues.join(', ')}) AS r(rule_no, category_id, rule_id) ON r.rule_no = matched.rule_no
       ON CONFLICT (product_id, category_id) DO NOTHING`,
      extraParams
    );
    assignments += extra.rowCount ?? 0;
  }

  // 3б. Этап 5: категория "по двойнику". Товар, которому не подошло ни одно
  // правило ("A1/САЛЬНИК"), получает категории товара с тем же брендом и
  // артикулом у другого поставщика, у которого название нормальное
  // ("Сальник заднего редуктора"). Строгий вариант (решение владельца):
  // двойник должен описывать ту же деталь (lib/twinMatch.ts); кроссы
  // не используются. Берутся только категории, найденные ПРАВИЛАМИ (не
  // другими двойниками), без узких "по модели авто". Если двойники дают
  // больше 2 разных широких категорий — не угадываем, товар пропускаем
  if (CATEGORIES_STAGE5_ACTIVE) {
    assignments += await assignByTwins(client, scope);
  }

  // 4. Товар подкатегории — и в родительском разделе, но ТОЛЬКО для разделов
  // из PARENTS_INCLUDE_CHILDREN ("Ремені та ролики" ← "Ремені та ролики ГРМ" и
  // "Поліклинові ремені та ролики"). Для остальных (например "Гальмівні
  // колодки задні") это не нужно: их правила шире и затянули бы в основную
  // категорию лишнее (датчики износа, тросы ручника)
  const pairs = CATEGORIES.filter((c) => c.parentCategorySlug && PARENTS_INCLUDE_CHILDREN.includes(c.parentCategorySlug)).map((c) => [c.slug, c.parentCategorySlug as string]);
  if (pairs.length > 0) {
    const pairParams: unknown[] = pairs.flat();
    const values = pairs.map((_, i) => `($${i * 2 + 1}::text, $${i * 2 + 2}::text)`).join(', ');
    const filter = scopeFilter(scope, pairParams.length + 1);
    pairParams.push(...filter.params);
    const parents = await client.query(
      `INSERT INTO product_categories (product_id, category_id, rule_id)
       SELECT pc.product_id, v.parent, 'subcategory'
       FROM product_categories pc
       JOIN (VALUES ${values}) AS v(child, parent) ON v.child = pc.category_id
       JOIN products p ON p.id = pc.product_id
       WHERE true${filter.sql}
       ON CONFLICT (product_id, category_id) DO NOTHING`,
      pairParams
    );
    assignments += parents.rowCount ?? 0;
  }

  // 5. Группы бренд+артикул (lib/productGroups.ts): в списках показывается
  // только ГЛАВНАЯ страница группы, поэтому она получает категории всех
  // участников группы — иначе группа пропала бы из категории, куда попал
  // лишь двойник ("Сальник тяги моста" при главной "Сальник коробки
  // передач"). Узкие категории "по модели авто" не переносятся
  if (PRODUCT_GROUPS_ACTIVE) {
    const filter = scopeFilter(scope, 2);
    const grouped = await client.query(
      `INSERT INTO product_categories (product_id, category_id, rule_id)
       SELECT DISTINCT m.group_primary_id, pc.category_id, 'group'
       FROM products m
       JOIN product_categories pc ON pc.product_id = m.id
       WHERE m.group_primary_id IS NOT NULL AND m.id <> m.group_primary_id AND m.is_active
         AND pc.category_id = ANY($1::text[])${filter.sql.replace(/\bp\./g, 'm.')}
       ON CONFLICT (product_id, category_id) DO NOTHING`,
      [TWIN_CATEGORY_SLUGS, ...filter.params]
    );
    assignments += grouped.rowCount ?? 0;
  }

  const count = scopeFilter(scope, 1);
  const products = (
    await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM products p WHERE true${count.sql}`, count.params)
  ).rows[0].n;

  return { products, assignments, ms: Date.now() - started };
}

// Категории, которые можно переносить с двойника: все, кроме узких "по модели авто"
const TWIN_CATEGORY_SLUGS = CATEGORIES.filter((c) => !c.modelGroup && !c.tecdocVehicle).map((c) => c.slug);
const TOP_LEVEL_SLUGS = new Set(CATEGORIES.filter((c) => !c.parentCategorySlug).map((c) => c.slug));

async function assignByTwins(client: PoolClient, scope: CategoryRecomputeScope): Promise<number> {
  // Кандидаты: товар без категории × двойник (тот же бренд + артикул) × категория двойника
  const filter = scopeFilter(scope, 2);
  const candidates = await client.query<{ id: string; own: string; twin: string; category_id: string }>(
    `SELECT l.id, l.name_search AS own, q.name_search AS twin, pc.category_id
     FROM products l
     JOIN products q ON q.article = l.article AND upper(q.brand) = upper(l.brand) AND q.id <> l.id
     JOIN product_categories pc ON pc.product_id = q.id AND pc.rule_id <> 'twin'
     WHERE NOT EXISTS (SELECT 1 FROM product_categories x WHERE x.product_id = l.id)
       AND l.brand IS NOT NULL AND l.brand <> '' AND l.article <> ''
       AND pc.category_id = ANY($1::text[])${filter.sql.replace(/\bp\./g, 'l.')}`,
    [TWIN_CATEGORY_SLUGS, ...filter.params]
  );

  // Оставляем категории только от двойников, описывающих ту же деталь (lib/twinMatch.ts)
  const byProduct = new Map<string, Set<string>>();
  for (const row of candidates.rows) {
    if (!twinIsSamePart(row.own, row.twin)) continue;
    if (!byProduct.has(row.id)) byProduct.set(row.id, new Set());
    byProduct.get(row.id)!.add(row.category_id);
  }

  // Больше 2 разных широких категорий — двойники противоречат друг другу, не угадываем
  const ids: string[] = [];
  const slugs: string[] = [];
  for (const [id, categories] of byProduct) {
    if ([...categories].filter((slug) => TOP_LEVEL_SLUGS.has(slug)).length > 2) continue;
    for (const slug of categories) {
      ids.push(id);
      slugs.push(slug);
    }
  }
  if (ids.length === 0) return 0;
  const inserted = await client.query(
    `INSERT INTO product_categories (product_id, category_id, rule_id)
     SELECT unnest($1::uuid[]), unnest($2::text[]), 'twin'
     ON CONFLICT (product_id, category_id) DO NOTHING`,
    [ids, slugs]
  );
  return inserted.rowCount ?? 0;
}

export async function recomputeProductCategories(pool: Pool, scope: CategoryRecomputeScope): Promise<CategoryRecomputeResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recomputeInTransaction(client, scope);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Для фоновых вызовов (после импорта, cron): ошибка не должна ронять
// импорт прайса — только пишем в логи Vercel
export async function recomputeProductCategoriesSafely(pool: Pool, scope: CategoryRecomputeScope): Promise<void> {
  try {
    const r = await recomputeProductCategories(pool, scope);
    console.log(`Категории пересчитаны (${scope.kind}): товаров ${r.products}, назначений ${r.assignments}, ${r.ms} мс`);
  } catch (error) {
    console.error('Ошибка пересчёта категорий товаров:', error);
  }
}
