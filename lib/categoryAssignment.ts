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
import { CATEGORIES, buildCategoryRuleClause } from '@/lib/categories';
import { EXTRA_CATEGORY_RULES, buildExtraRuleCondition } from '@/lib/categoryRulesExtra';

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

  const count = scopeFilter(scope, 1);
  const products = (
    await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM products p WHERE true${count.sql}`, count.params)
  ).rows[0].n;

  return { products, assignments, ms: Date.now() - started };
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
