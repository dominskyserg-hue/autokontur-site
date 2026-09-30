-- ============================================================
-- ТАБЛИЦА КРОССОВ tecdoc_crosses (кросс- и OEM-номера из прайсов)
--
-- Название таблицы историческое. С 30.09.2026 (тогда же удалены таблицы
-- tecdoc_compatibility, tecdoc_related_categories, product_vehicle_makes)
-- в ней только кроссы из прайсов наших поставщиков и официального
-- справочника TRW:
--   autohelp     — scripts/tecdoc/import-autohelp-crosses.ts
--   price_nippon — scripts/tecdoc/import-nippon-crosses.ts
--   trw_2025     — scripts/tecdoc/import-trw-oe.ts
--
-- Читает сайт: блок "Аналоги" (lib/productDetail.ts), поиск по номеру
-- (lib/productSearch.ts), своя применимость по OEM-номерам
-- (lib/ownVehicles.ts) — везде только строки с is_valid.
--
-- НЕ то же самое, что cross_reference_groups/cross_reference_members
-- (основной schema.sql, раздел "11. КРОСС-НОМЕРА"): там админ вручну
-- подтверждает каждую связь, здесь — массовые данные прайсов.
--
-- Скрипт идемпотентный: можно запускать повторно.
-- ============================================================

-- ------------------------------------------------------------
-- Кроси й OEM-номери: пара "бренд+артикул" A <-> "бренд+артикул" B.
-- Один зв'язок записується ОДРАЗУ ДВОМА рядками (A->B і
-- B->A) — це свідома денормалізація заради швидкості читання: сторінці
-- товару достатньо ОДНОГО індексованого запиту
-- "WHERE brand_a = ? AND article_a = ?", без UNION/OR по двох
-- колонках одразу. Пишеться рідко (при імпорті файлу кросів),
-- читається на кожному відкритті сторінки товару — тому оптимізуємо
-- саме під читання
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tecdoc_crosses (
  id BIGSERIAL PRIMARY KEY,

  brand_a TEXT NOT NULL,
  -- Артикул уже очищений тією ж функцією cleanArticle(), що й
  -- products.article (scripts/tecdoc/cleanArticle.ts) — без цього
  -- зв'язки не зматчаться з реальними товарами при пошуку
  article_a TEXT NOT NULL,

  brand_b TEXT NOT NULL,
  article_b TEXT NOT NULL,

  -- 'oem' — B це оригінальний номер автовиробника для A; 'cross' —
  -- A і B рівноправні аналоги різних виробників запчастин
  relation_type TEXT NOT NULL DEFAULT 'cross' CHECK (relation_type IN ('cross', 'oem')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Захист від дублікатів при повторному запуску скрипта імпорту
  -- (ON CONFLICT DO NOTHING у scripts/tecdoc/batchInserter.ts
  -- спирається саме на це обмеження)
  UNIQUE (brand_a, article_a, brand_b, article_b, relation_type)
);

-- Головний індекс для читання: "дано лише артикул (без бренду) —
-- знайти всі його кроси". УВАГА: UNIQUE вище НЕ підходить для цього —
-- складений індекс (brand_a, article_a, ...) ефективний лише коли
-- фільтр йде ПО ПЕРШІЙ колонці (brand_a) або по обох одразу, а не
-- коли фільтруємо ЛИШЕ по другій (article_a), як роблять і
-- lib/productDetail.ts (loadTecdocCrosses), і пошук на сайті
-- (app/api/products/route.ts) — без окремого індексу саме на
-- article_a Postgres змушений сканувати всю таблицю (мільйони рядків)
-- на кожен пошук
CREATE INDEX IF NOT EXISTS idx_tecdoc_crosses_article_a ON tecdoc_crosses (article_a);

-- Источник строки кросса — каждый скрипт импорта пишет свой:
--   trw_2025      — OEM-справочник TRW (import-trw-oe.ts)
--   autohelp      — прайс Autohelp (import-autohelp-crosses.ts)
--   price_nippon  — прайс NMCO/Nippon (import-nippon-crosses.ts)
--   unknown       — источник не указан
-- Бывшие источники tecdoc_2016, tecdoc_2018, price_cardon и price_va
-- удалены 30.09.2026 вместе со скриптами импорта
-- Константный DEFAULT не переписывает таблицу — ALTER выполняется мгновенно
ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'unknown';

-- false — строка признана ложной или из исключённого источника и нигде
-- не используется (сайт фильтрует AND is_valid). Причина — invalid_reason
ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT true;

-- Почему строка не используется (is_valid = false):
--   source_excluded — источник исключён целиком (tecdoc_2016, tecdoc_2018,
--                     price_cardon, price_va);
--   brand_mismatch  — ни одна сторона строки не совпала с товаром каталога
--                     по бренду
ALTER TABLE tecdoc_crosses ADD COLUMN IF NOT EXISTS invalid_reason TEXT;

-- Строки исключённых источников (если их снова кто-то загрузит) сразу
-- пишутся помеченными и сайтом не используются
CREATE OR REPLACE FUNCTION tecdoc_crosses_exclude_sources() RETURNS trigger AS $$
BEGIN
  IF NEW.source IN ('tecdoc_2016', 'tecdoc_2018', 'price_cardon', 'price_va') THEN
    NEW.is_valid := false;
    NEW.invalid_reason := 'source_excluded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tecdoc_crosses_exclude_sources ON tecdoc_crosses;
CREATE TRIGGER trg_tecdoc_crosses_exclude_sources
  BEFORE INSERT OR UPDATE OF source, is_valid ON tecdoc_crosses
  FOR EACH ROW EXECUTE FUNCTION tecdoc_crosses_exclude_sources();
