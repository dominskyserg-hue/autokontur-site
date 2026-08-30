# Задача: развернуть проект «Автосклад» (админка поставщиков)

## Как использовать этот файл

Это не гайд для человека — это инструкция для тебя, Claude, работающего
в Claude Code (агент с доступом к терминалу и файловой системе).
Пользователь (Serg) — начинающий разработчик. Он либо:
  (а) положил этот файл как `CLAUDE.md` в корень уже созданного пустого
      проекта Next.js и запустил тебя в этой папке — тогда просто
      выполняй шаги по порядку, начиная с проверки, что уже сделано;
  (б) вставил весь этот файл как первое сообщение в чат — тогда сначала
      создай проект (Шаг 1), а дальше действуй так же.

Правила, которые нужно соблюдать во всей переписке с пользователем
(это его личные настройки, не мои — уважай их и в объяснениях, и в коде):
  - Объясняй каждый шаг просто, как новичку — не считай, что он знает
    терминологию.
  - Все комментарии в коде, которые ты пишешь или показываешь, — на
    русском языке (в файлах ниже они уже на русском — сохраняй это).
  - Никогда не сокращай и не обрезай код при выводе в чат — только
    полные файлы целиком.
  - Не проси лишний раз подтверждения на каждый мелкий шаг — двигайся
    по инструкции, но обязательно остановись и спроси пользователя,
    если тебе не хватает данных (см. Шаг 4 — там нужен пароль от базы,
    который знает только он).

Итоговая цель: рабочий сайт на `http://localhost:3000` с экраном
«Поставщики и маппинг Excel» — управление поставщиками, единый
глобальный курс валют (USD/EUR) и загрузка их прайс-листов в Excel
с автоматическим пересчётом розничных цен. Все данные реально хранятся
в PostgreSQL (Supabase), а не в localStorage браузера.

---

## Шаг 1 — Создать проект Next.js (если ещё не создан)

Проверь сначала, есть ли уже `package.json` в текущей директории. Если
есть и в нём Next.js — пропусти этот шаг и переходи к Шагу 2.

Если проекта ещё нет, выполни в терминале:

```bash
npx create-next-app@latest avtosklad-admin
```

На вопросы мастера ответь именно так (файлы ниже рассчитаны на такую
структуру):

- TypeScript? → **Yes**
- ESLint? → Yes
- Tailwind CSS? → **Yes** (обязательно — компоненты используют классы Tailwind)
- `src/` directory? → **No**
- App Router? → **Yes**
- Настроить import alias (`@/*`)? → **No** (оставить дефолтный)

Затем зайди в папку проекта:

```bash
cd avtosklad-admin
```

Если файл был запущен способом (а) — то есть ты уже находишься внутри
готового проекта — просто убедись, что это Next.js-проект с App Router
и TypeScript, и продолжай.

---

## Шаг 2 — Установить зависимости

```bash
npm install pg xlsx
npm install --save-dev @types/pg
```

- `pg` — подключение к PostgreSQL из серверного кода
- `xlsx` — чтение Excel-файлов прайс-листов
- `@types/pg` — типы для TypeScript (только для разработки)

Проверь, что установка прошла без ошибок (`npm install` завершился
кодом 0).

---

## Шаг 3 — Создать файлы проекта

Создай ровно эти файлы с ровно этим содержимым (никаких сокращений —
файлы уже проверены и рабочие). Если каких-то папок ещё нет
(`app/api/rates`, `app/api/suppliers`, `app/api/suppliers/parse-excel`,
`components`) — создай их.

### `schema.sql` (в корне проекта, рядом с `package.json`)

```sql
-- ============================================================
-- ФИНАЛЬНЫЙ SQL-СКРИПТ СОЗДАНИЯ БАЗЫ ДАННЫХ
-- Экран "Поставщики и маппинг Excel" — таблицы поставщиков,
-- их настроек маппинга и товаров.
--
-- Как использовать: откройте Supabase → ваш проект → SQL Editor →
-- New query → вставьте весь этот файл целиком → нажмите "Run".
-- Скрипт безопасно запускать повторно: везде используется
-- IF NOT EXISTS, поэтому повторный запуск не выдаст ошибку и
-- не сломает уже существующие таблицы.
-- ============================================================


-- Включаем расширение pgcrypto — оно даёт функцию gen_random_uuid(),
-- которой мы будем генерировать уникальные ID для строк.
-- В Supabase оно обычно уже включено по умолчанию, но эта строка
-- ничего не сломает, даже если расширение уже есть — просто ничего
-- не сделает (IF NOT EXISTS)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ============================================================
-- 1. ТАБЛИЦА global_exchange_rates — глобальные курсы валют
-- ============================================================
-- Раньше курс валюты хранился в каждом поставщике отдельно (поле
-- suppliers.exchange_rate) — это было неудобно: если курс доллара
-- менялся, приходилось заходить в настройки КАЖДОГО поставщика с
-- долларовым прайсом и поправлять курс вручную. Теперь курс общий
-- для всей валюты: одна строка в этой таблице — один курс, который
-- сразу используется для всех поставщиков, у кого выбрана эта
-- валюта. Поменяли курс здесь один раз — пересчёт сразу применится
-- ко всем таким поставщикам при следующей загрузке прайс-листа.
--
-- Местная валюта (UAH) в этой таблице НЕ хранится — для неё курс
-- всегда считается равным 1.0 прямо в коде, отдельная строка не
-- нужна (искать её здесь и не понадобится)
CREATE TABLE IF NOT EXISTS global_exchange_rates (
  -- Код валюты — три латинские буквы (USD, EUR, RUB...). Он же и
  -- первичный ключ: для каждой валюты в таблице ровно одна строка
  -- с её текущим курсом. Именно на это поле ссылается ON CONFLICT
  -- (currency) DO UPDATE в app/api/rates/route.ts при обновлении
  currency VARCHAR(3) PRIMARY KEY CHECK (currency ~ '^[A-Z]{3}$'),

  -- Текущий курс этой валюты к местной (гривне). NUMERIC — точное
  -- число без ошибок округления, как и все денежные величины в этой
  -- базе (никогда не используем FLOAT для денег). CHECK > 0 —
  -- нулевой или отрицательный курс обнулил бы или сделал
  -- отрицательными вообще все цены, посчитанные по нему
  rate NUMERIC(12, 4) NOT NULL CHECK (rate > 0),

  -- Когда курс в последний раз обновляли — показываем в виджете
  -- курсов в интерфейсе, чтобы админ видел, насколько "свежий"
  -- сейчас курс, и не забывал обновлять его
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 2. ТАБЛИЦА suppliers — поставщики
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  -- Уникальный ID поставщика. UUID вместо простого числа —
  -- потому что его нельзя угадать перебором (id=1, id=2...) и
  -- он не пересечётся, даже если записи создаются из разных мест.
  -- gen_random_uuid() генерирует новый UUID автоматически при
  -- каждой вставке строки, вручную его указывать не нужно
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Название компании-поставщика. NOT NULL — то есть обязательно
  -- должно быть заполнено, пустых поставщиков быть не может
  name TEXT NOT NULL,

  -- Контактное лицо — необязательное поле (может остаться пустым)
  contact_name TEXT,

  -- Телефон и email храним в двух отдельных колонках (как и в самой
  -- форме на экране администратора — там это тоже два разных поля),
  -- а не одной общей "phone_email": так удобнее искать, проверять
  -- формат и, например, звонить или писать письма программно
  phone TEXT,
  email TEXT,

  -- Валюта, в которой этот поставщик присылает прайс-лист — код из
  -- 3 латинских букв (UAH, USD, EUR, RUB...). По умолчанию UAH
  -- (местная валюта, украинская гривна) — значит цены из Excel
  -- считаются уже в местной валюте, без пересчёта. Сам курс этой
  -- валюты здесь БОЛЬШЕ НЕ ХРАНИТСЯ (раньше было отдельное поле
  -- exchange_rate прямо на поставщике) — теперь курс общий для всех
  -- поставщиков одной валюты и живёт в таблице global_exchange_rates
  -- выше: так его достаточно поменять один раз в одном месте, а не
  -- у каждого поставщика отдельно
  currency TEXT NOT NULL DEFAULT 'UAH' CHECK (currency ~ '^[A-Z]{3}$'),

  -- Когда запись была создана. now() — текущее время сервера базы
  -- данных на момент вставки строки
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Проверка на уровне базы данных: должен быть указан хотя бы
  -- телефон ИЛИ email (то же самое правило уже есть в форме на
  -- экране, но продублировать его в базе — хорошая привычка:
  -- так некорректная запись не проскочит, даже если её попробуют
  -- создать в обход интерфейса, например через API напрямую)
  CONSTRAINT phone_or_email_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

-- ------------------------------------------------------------
-- МИГРАЦИЯ ДЛЯ ТЕХ, КТО УЖЕ ЗАПУСКАЛ ЭТОТ СКРИПТ РАНЬШЕ
-- ------------------------------------------------------------
-- Ровно та же ситуация, что и с order_items ниже: CREATE TABLE
-- IF NOT EXISTS не добавит новые колонки в уже существующую
-- таблицу suppliers (а она у вас уже создана в Supabase). Поэтому
-- отдельно, на всякий случай, добавляем колонку currency через
-- ALTER TABLE — ADD COLUMN IF NOT EXISTS безопасен для повторного
-- запуска
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'UAH' CHECK (currency ~ '^[A-Z]{3}$');

-- А колонку exchange_rate, наоборот, теперь УДАЛЯЕМ: курс переехал
-- из поставщика в отдельную таблицу global_exchange_rates (см. выше
-- в этом же файле). DROP COLUMN IF EXISTS безопасен и для тех, у
-- кого этой колонки никогда не было (например, для совсем свежей
-- базы, где вы применяете этот скрипт впервые) — тогда команда
-- просто ничего не сделает
ALTER TABLE suppliers DROP COLUMN IF EXISTS exchange_rate;


-- ============================================================
-- 3. ТАБЛИЦА supplier_excel_mappings — настройки маппинга Excel
-- ============================================================
-- У каждого поставщика ровно ОДНА настройка маппинга (это видно
-- по самому интерфейсу: кнопка "Сохранить настройки поставщика"
-- перезаписывает, а не добавляет новую). Поэтому здесь supplier_id
-- сделан одновременно и первичным ключом (PRIMARY KEY), и внешним
-- ключом (REFERENCES) — это гарантирует связь "один к одному":
-- у поставщика не может быть двух разных настроек маппинга
CREATE TABLE IF NOT EXISTS supplier_excel_mappings (
  -- Ссылка на поставщика. ON DELETE CASCADE означает: если
  -- поставщика удалят, его настройки маппинга удалятся вместе
  -- с ним автоматически — они всё равно бесполезны без поставщика
  supplier_id UUID PRIMARY KEY REFERENCES suppliers(id) ON DELETE CASCADE,

  -- Буква или номер колонки Excel-файла для каждого поля.
  -- Храним как текст ("B", "2" и т.п.), потому что именно так их
  -- вводит пользователь в интерфейсе — не обязательно преобразовывать
  -- сразу в число, это делает уже серверный код при разборе файла.
  -- Артикул и цена обязательны для работы маппинга, поэтому NOT NULL
  article_column TEXT NOT NULL,
  brand_column TEXT,
  name_column TEXT,
  price_column TEXT NOT NULL,
  stock_column TEXT,

  -- С какой строки файла начинаются данные (пропускаем строки-шапки)
  start_row INTEGER NOT NULL DEFAULT 1,

  -- Наценка в процентах. NUMERIC(6,2) — до 9999,99% с двумя знаками
  -- после запятой, этого более чем достаточно для процента наценки
  markup_percent NUMERIC(6, 2) NOT NULL DEFAULT 0,

  -- Когда настройки в последний раз сохраняли/меняли
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 4. ТАБЛИЦА products — товары, загруженные из прайс-листов
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Товар всегда принадлежит конкретному поставщику. ON DELETE
  -- CASCADE — если поставщика удаляют, весь его каталог товаров
  -- удаляется вместе с ним (в этом проекте товары существуют
  -- только благодаря прайс-листу поставщика, отдельно от него
  -- они не имеют смысла). Если захотите вместо этого получать
  -- ошибку при удалении поставщика с товарами "для подстраховки" —
  -- замените CASCADE на RESTRICT
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  -- Очищенный артикул (уже без пробелов/дефисов/спецсимволов,
  -- в верхнем регистре — этим занимается функция cleanArticle()
  -- в серверном коде до того, как строка попадёт сюда)
  article TEXT NOT NULL,

  brand TEXT,
  name TEXT,

  -- Оптовая цена поставщика (столбец называется cost_price, как
  -- вы и просили). NUMERIC(12,2) — до 9 999 999 999,99, с точностью
  -- до копейки; для денег всегда используем NUMERIC, а не FLOAT,
  -- потому что FLOAT округляет и может незаметно "потерять" копейки
  cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0,

  -- Розничная цена — уже посчитанная (опт + наценка), та, что
  -- увидит покупатель на сайте
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,

  stock INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ГЛАВНОЕ: составной уникальный ключ "Артикул + Поставщик".
  -- Именно на него ссылается "ON CONFLICT (supplier_id, article)"
  -- в серверном коде — без этого ограничения Upsert работать не
  -- будет (Postgres не поймёт, какую строку считать "той же самой"
  -- при повторной загрузке прайс-листа)
  UNIQUE (supplier_id, article)
);


-- ============================================================
-- 5. ИНДЕКСЫ — чтобы поиск оставался быстрым даже при миллионе строк
-- ============================================================

-- Ограничение UNIQUE (supplier_id, article) выше уже само по себе
-- создало индекс — но он "ведущий" по supplier_id, то есть хорошо
-- ускоряет запросы вида "все товары этого поставщика", а вот поиск
-- ПО ОДНОМУ АРТИКУЛУ БЕЗ УКАЗАНИЯ ПОСТАВЩИКА (например, когда сайт
-- ищет товар по артикулу across всех поставщиков сразу) через него
-- быстрым не будет. Поэтому добавляем отдельный индекс именно на
-- article — тогда такой поиск останется мгновенным при любом
-- количестве товаров
CREATE INDEX IF NOT EXISTS idx_products_article ON products (article);


-- ============================================================
-- 6. ТАБЛИЦА orders — заказы клиентов
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Имя и телефон клиента храним прямо в заказе, а не ссылкой на
  -- отдельную таблицу "клиенты" — в этом проекте пока нет регистрации
  -- покупателей, заказ оформляется просто по имени и телефону
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,

  -- Статус заказа — текстовое поле с ограничением CHECK: Postgres
  -- сам не даст записать туда что-то, кроме одного из пяти
  -- перечисленных значений. Храним статус на английском (короткие
  -- машинные "ключи"), а на русском ("Новый", "В обработке"...)
  -- показываем только в интерфейсе — так, если позже понадобится
  -- показать админке на другом языке, менять базу не придётся
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'processing', 'awaiting_parts', 'ready', 'cancelled')
  ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 7. ТАБЛИЦА order_items — позиции (товары) внутри заказа
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Заказ, к которому относится эта позиция. ON DELETE CASCADE —
  -- если удалить сам заказ, все его позиции удалятся вместе с ним
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- Ссылка на товар в каталоге — но НЕ NOT NULL и с ON DELETE SET NULL.
  -- Это осознанное решение: товар в каталоге со временем может
  -- подорожать, переименоваться или вовсе быть удалён поставщиком,
  -- но история уже оформленных заказов при этом не должна меняться —
  -- клиент должен видеть в своём старом заказе именно ту цену и то
  -- название, по которым он реально покупал. Поэтому ниже мы ЕЩЁ РАЗ
  -- сохраняем артикул/бренд/название/цену прямо в order_items —
  -- это "снимок" товара на момент покупки, а product_id — просто
  -- необязательная ссылка для перехода в текущую карточку товара
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,

  article TEXT NOT NULL,
  brand TEXT,
  name TEXT,

  -- Цена ЗА ОДНУ ШТУКУ на момент покупки (снимок retail_price)
  price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  -- С какого склада (поставщика) эта позиция — по той же причине,
  -- что и article/brand/name/price выше: это "снимок" на момент
  -- покупки. supplier_id — необязательная ссылка на текущего
  -- поставщика (ON DELETE SET NULL — если поставщика удалят,
  -- позиция заказа не пропадёт, просто ссылка обнулится), а
  -- supplier_name — его название текстом, чтобы оно осталось
  -- видно в старых заказах, даже если поставщика потом переименуют
  -- или вовсе удалят
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- МИГРАЦИЯ ДЛЯ ТЕХ, КТО УЖЕ ЗАПУСКАЛ ЭТОТ СКРИПТ РАНЬШЕ
-- ------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS выше не добавит новые колонки в уже
-- существующую таблицу order_items — он просто увидит, что таблица
-- есть, и ничего не станет делать. Поэтому для уже созданной базы
-- (как у вас в Supabase) нужны отдельные команды ALTER TABLE.
-- ADD COLUMN IF NOT EXISTS делает и это безопасным для повторного
-- запуска: если колонка уже добавлена, ничего не сломается
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_name TEXT;


-- ============================================================
-- 8. ИНДЕКСЫ ДЛЯ ЗАКАЗОВ
-- ============================================================

-- Ускоряет фильтр по статусу ("покажи все Новые заказы")
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- Ускоряет "найди все позиции заказа №X" — а именно так мы и
-- будем читать order_items почти в каждом запросе ниже
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);


-- ============================================================
-- ГОТОВО
-- ============================================================
-- global_exchange_rates ни на что не ссылается и на неё никто не
-- ссылается через внешний ключ — связь с suppliers.currency чисто
-- по значению (код валюты), а не по FOREIGN KEY: у валюты местной
-- (UAH) в этой таблице попросту нет строки, и это нормальная,
-- ожидаемая ситуация.
--
-- Курс валюты ГЛОБАЛЬНЫЙ, а не привязан к поставщику:
-- app/api/suppliers/parse-excel/route.ts сначала смотрит currency
-- выбранного поставщика, и если это не местная валюта — берёт
-- актуальный курс из global_exchange_rates. Менять курсы можно
-- через app/api/rates/route.ts — один раз для всех поставщиков сразу.
--
-- Скрипт полностью идемпотентен (можно запускать повторно сколько
-- угодно раз).
```

### `app/api/rates/route.ts` (новый файл, создай папку `app/api/rates/`)

```typescript
// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/rates
//
// Это НОВЫЙ роут — отвечает за ГЛОБАЛЬНЫЕ курсы валют (таблица
// global_exchange_rates из schema.sql). До этого курс валюты
// хранился в каждом поставщике отдельно (suppliers.exchange_rate) —
// теперь курс общий для всей валюты: один курс USD используется
// сразу для ВСЕХ поставщиков, у которых выбрана валюта USD.
//
//   GET  /api/rates  — получить список всех сохранённых курсов
//   POST /api/rates  — обновить один курс или сразу несколько.
//                       Тело запроса может быть:
//                         { currency: 'USD', rate: 95.5 }             — один курс
//                         [{ currency: 'USD', rate: 95.5 },
//                          { currency: 'EUR', rate: 101.2 }]          — сразу несколько
//                       Именно вторая форма используется виджетом
//                       "Глобальные курсы валют" в интерфейсе — там
//                       одна кнопка "Обновить" сохраняет курсы USD
//                       и EUR одним запросом.
//
// Курс каждой валюты используется дальше в
// app/api/suppliers/parse-excel/route.ts при разборе прайс-листа.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Этот блок специально написан ТОЧНО так же, как в
// app/api/suppliers/route.ts и app/api/suppliers/parse-excel/route.ts,
// и использует то же имя глобальной переменной (globalThis.pgPool) —
// поэтому все три файла работают с ОДНИМ И ТЕМ ЖЕ объектом Pool,
// а не создают три разных подключения к базе
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

// Один курс валюты в том виде, в котором фронтенд его присылает
interface RateInput {
  currency: string;
  rate: number;
}

// Один курс валюты в том виде, в котором мы отдаём его обратно
// на фронтенд
interface RateResponse {
  currency: string;
  rate: number;
  updatedAt: string;
}

// ------------------------------------------------------------
// ВАЛИДАЦИЯ
// ------------------------------------------------------------

// Код валюты — три латинские буквы (тот же формат, что и у
// suppliers.currency в app/api/suppliers/route.ts)
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

// Проверяет один элемент { currency, rate } и возвращает текст
// ошибки, либо null, если всё в порядке
function validateRateInput(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return 'Каждый курс должен быть объектом вида { currency, rate }';
  }

  const { currency, rate } = item as Record<string, unknown>;

  if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency.trim())) {
    return 'Валюта должна быть кодом из 3 латинских букв, например USD или EUR';
  }

  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return 'Курс валюты должен быть положительным числом';
  }

  return null;
}

// Тело запроса POST может прийти и как один объект, и как массив
// объектов — эта функция всегда приводит его к массиву, чтобы
// дальше по коду обрабатывать оба случая одинаково
function normalizeRequestBody(body: unknown): RateInput[] {
  const items = Array.isArray(body) ? body : [body];

  return items.map((item) => {
    const { currency, rate } = item as { currency: string; rate: number };
    return { currency: currency.trim().toUpperCase(), rate };
  });
}

// ------------------------------------------------------------
// GET /api/rates — список всех сохранённых глобальных курсов
// ------------------------------------------------------------
export async function GET() {
  try {
    // ORDER BY currency — чтобы список на фронтенде не "прыгал"
    // между обновлениями страницы, а всегда шёл в одном порядке
    const result = await pool.query(
      'SELECT currency, rate, updated_at FROM global_exchange_rates ORDER BY currency'
    );

    const rates: RateResponse[] = result.rows.map((row) => ({
      currency: row.currency,
      // rate — колонка NUMERIC, драйвер pg возвращает такие значения
      // строкой (чтобы не терять точность при преобразовании в float),
      // поэтому здесь явно переводим её в обычное число
      rate: parseFloat(row.rate),
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, rates });
  } catch (error) {
    console.error('Ошибка при получении глобальных курсов валют:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить курсы валют: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// POST /api/rates — обновить один курс или сразу несколько
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  // Тело может быть одним объектом { currency, rate } или массивом
  // таких объектов — проверяем КАЖДЫЙ элемент до того, как начнём
  // что-либо записывать в базу, чтобы не получить ситуацию "курс
  // USD обновился, а курс EUR — нет, потому что была опечатка"
  const rawItems = Array.isArray(body) ? body : [body];
  if (rawItems.length === 0) {
    return NextResponse.json(
      { error: 'Не передано ни одного курса для обновления.' },
      { status: 400 }
    );
  }

  for (const item of rawItems) {
    const validationError = validateRateInput(item);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  const items = normalizeRequestBody(body);

  // Берём отдельное подключение из пула на всё время транзакции —
  // если курсов несколько (например, USD и EUR разом из виджета),
  // они должны обновиться либо все вместе, либо ни один: иначе при
  // сбое между двумя запросами можно получить наполовину обновлённые
  // курсы, а это как раз то, чего мы хотели избежать, сделав курсы
  // глобальными
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const updatedRows = [];
    for (const item of items) {
      // ON CONFLICT (currency) DO UPDATE — то самое "обновить, если
      // уже есть, или создать, если ещё нет" (Upsert), про которое
      // и шла речь в задании. currency — PRIMARY KEY таблицы
      // global_exchange_rates, поэтому конфликт определяется по нему
      const result = await client.query(
        `
        INSERT INTO global_exchange_rates (currency, rate)
        VALUES ($1, $2)
        ON CONFLICT (currency)
        DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()
        RETURNING currency, rate, updated_at
        `,
        [item.currency, item.rate]
      );
      updatedRows.push(result.rows[0]);
    }

    await client.query('COMMIT');

    const rates: RateResponse[] = updatedRows.map((row) => ({
      currency: row.currency,
      rate: parseFloat(row.rate),
      updatedAt: row.updated_at,
    }));

    return NextResponse.json({ success: true, rates });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при обновлении курсов валют:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить курсы валют: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
```

### `app/api/suppliers/route.ts` (новый файл, создай папку `app/api/suppliers/`)

```typescript
// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/suppliers
//
// Этот файл отвечает за самих поставщиков (не за загрузку Excel —
// это отдельный роут app/api/suppliers/parse-excel/route.ts, и не
// за курсы валют — это отдельный роут app/api/rates/route.ts).
// Здесь два разных запроса уживаются в одном файле — так принято
// в Next.js App Router: имя функции = HTTP-метод, Next.js сам
// направляет запрос в нужную функцию по методу (POST/GET/...):
//
//   POST /api/suppliers  — создать НОВОГО поставщика (и, если
//                           переданы, сразу его настройки маппинга),
//                           либо ОБНОВИТЬ существующего — если в теле
//                           запроса передан "id" уже существующего
//                           поставщика. Так одна и та же кнопка
//                           "Сохранить" на фронтенде работает и для
//                           формы "Новый поставщик" (id ещё нет),
//                           и для формы "Настройки маппинга" уже
//                           выбранного поставщика (id уже есть) —
//                           без этого второй сценарий создавал бы
//                           дубликат поставщика при каждом сохранении
//   GET  /api/suppliers   — получить список всех поставщиков
//                           вместе с их настройками маппинга
//
// ВАЖНОЕ ИЗМЕНЕНИЕ: раньше у поставщика было своё собственное поле
// exchangeRate (курс валюты) — теперь курс стал ГЛОБАЛЬНЫМ и живёт
// в отдельной таблице global_exchange_rates (см. schema.sql и
// app/api/rates/route.ts). Здесь, в /api/suppliers, поставщик хранит
// только currency (какой валютой он пользуется), а сам курс этой
// валюты нужно смотреть/менять уже в /api/rates.
//
// Использует тот же пул подключений "pg", что и parse-excel/route.ts,
// и точно так же читает строку подключения из process.env.DATABASE_URL
// (переменная берётся из .env.local — см. предыдущий файл).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Этот блок специально написан ТОЧНО так же, как в parse-excel/route.ts
// и в rates/route.ts, и использует то же имя глобальной переменной
// (globalThis.pgPool). Благодаря этому все файлы в итоге работают
// с ОДНИМ И ТЕМ ЖЕ объектом Pool, а не создают несколько разных
// пулов подключений — тот, кто выполнится первым, создаст Pool и
// сохранит его в globalThis, а остальные файлы просто найдут его
// там и переиспользуют.
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

// Настройки маппинга, которые может прислать фронтенд вместе
// с данными поставщика. Все поля, кроме article и price,
// необязательны — так же, как на экране администратора
interface MappingInput {
  article: string;    // колонка с артикулом, например "B" — обязательно
  brand?: string;       // колонка с брендом, например "C"
  name?: string;          // колонка с названием детали, например "D"
  price: string;             // колонка с ценой поставщика, например "F" — обязательно
  stock?: string;               // колонка с остатком, например "G"
  startRow?: number;               // с какой строки начинаются данные (по умолчанию 1)
  markup?: number;                    // наценка в процентах (по умолчанию 0)
}

// Тело запроса на создание поставщика. mapping необязателен целиком —
// можно сначала создать поставщика с одними контактами, а настройки
// маппинга сохранить позже отдельным запросом (так тоже устроен
// сценарий использования в интерфейсе: сначала форма "Новый
// поставщик", а поля маппинга заполняются уже после)
interface CreateSupplierRequestBody {
  // Если id передан и это существующий поставщик — обновляем его,
  // а не создаём нового. Если id не передан — создаём нового
  id?: string;
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  // Валюта, в которой поставщик присылает прайс-лист (например,
  // "USD", "EUR"). Необязательное поле — если не передать,
  // подставится местная валюта (см. DEFAULT_CURRENCY ниже). Курса
  // здесь больше нет — он теперь общий для всех поставщиков этой
  // валюты и настраивается отдельно, через /api/rates
  currency?: string;
  mapping?: MappingInput;
}

// Настройки маппинга в том виде, в котором мы отдаём их обратно
// на фронтенд (уже с приведёнными типами: startRow — число,
// markup — число, а не строка из базы)
interface MappingResponse {
  article: string;
  brand: string | null;
  name: string | null;
  price: string;
  stock: string | null;
  startRow: number;
  markup: number;
  updatedAt: string;
}

// Поставщик в том виде, в котором мы отдаём его на фронтенд.
// mapping — null, если для поставщика ещё не сохраняли настройки
interface SupplierResponse {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  createdAt: string;
  mapping: MappingResponse | null;
}

// ------------------------------------------------------------
// ВАЛЮТА — значение по умолчанию и нормализация
// ------------------------------------------------------------

// Местная валюта "по умолчанию" — украинская гривна. Если поставщик
// присылает прайс уже в местной валюте, отдельно выбирать её не
// нужно и курс к ней всегда считается равным 1.0 (см. правило в
// app/api/suppliers/parse-excel/route.ts) — специально настраивать
// для неё ничего не нужно, в отличие от иностранных валют, чей курс
// хранится в global_exchange_rates и настраивается через /api/rates
const DEFAULT_CURRENCY = 'UAH';

// Код валюты — три латинские буквы (ISO 4217-подобный формат:
// "USD", "EUR", "UAH", "RUB"...). Простая проверка формата, а не
// сверка со справочником настоящих валют — этого достаточно, чтобы
// отсечь опечатки вроде пустой строки или "доллар"
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

// Приводит валюту к виду, в котором она хранится в базе: верхний
// регистр, без лишних пробелов. Если ничего не передали — местная
function normalizeCurrency(value: string | undefined | null): string {
  if (!value || !value.trim()) return DEFAULT_CURRENCY;
  return value.trim().toUpperCase();
}

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
// Тот же формат, что и в parse-excel/route.ts: 8-4-4-4-12
// шестнадцатеричных символов через дефис
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// ------------------------------------------------------------
// ВАЛИДАЦИЯ ВХОДНЫХ ДАННЫХ ПОСТАВЩИКА
// ------------------------------------------------------------
// Возвращает текст ошибки, если данные некорректны, или null,
// если всё в порядке. Эти же правила продублированы в самой базе
// (NOT NULL на name, CHECK на phone/email в schema.sql) — но
// проверять их ещё и здесь важно: так пользователь сразу получит
// понятное сообщение "Укажите телефон или email", а не сухую
// ошибку PostgreSQL про нарушение CHECK-ограничения
function validateSupplierInput(body: CreateSupplierRequestBody): string | null {
  if (!body.name || !body.name.trim()) {
    return 'Название поставщика обязательно для заполнения';
  }

  const hasPhone = Boolean(body.phone && body.phone.trim());
  const hasEmail = Boolean(body.email && body.email.trim());
  if (!hasPhone && !hasEmail) {
    return 'Укажите хотя бы телефон или email поставщика';
  }

  // Валюта — необязательное поле, но если её всё же передали,
  // это должен быть настоящий код из 3 латинских букв, а не
  // случайный текст
  if (body.currency !== undefined && body.currency !== null && body.currency.trim() !== '') {
    if (!CURRENCY_PATTERN.test(body.currency.trim())) {
      return 'Валюта должна быть кодом из 3 латинских букв, например USD, EUR или UAH';
    }
  }

  // Если настройки маппинга переданы — у них тоже есть обязательные
  // поля, ровно как при разборе самого Excel-файла
  if (body.mapping) {
    if (!body.mapping.article || !body.mapping.article.trim()) {
      return 'В настройках маппинга не указана колонка "Артикул"';
    }
    if (!body.mapping.price || !body.mapping.price.trim()) {
      return 'В настройках маппинга не указана колонка "Цена поставщика"';
    }
  }

  return null;
}

// ------------------------------------------------------------
// СОХРАНЕНИЕ МАППИНГА ДЛЯ ПОСТАВЩИКА (используется внутри POST)
// ------------------------------------------------------------
// supplier_id в этой таблице — одновременно первичный и внешний
// ключ (см. schema.sql), поэтому запись здесь всегда ровно одна
// на поставщика. INSERT ... ON CONFLICT (supplier_id) DO UPDATE
// написан как настоящий Upsert
async function upsertMapping(
  client: PoolClient,
  supplierId: string,
  mapping: MappingInput
): Promise<MappingResponse> {
  const result = await client.query(
    `
    INSERT INTO supplier_excel_mappings
      (supplier_id, article_column, brand_column, name_column, price_column, stock_column, start_row, markup_percent)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (supplier_id)
    DO UPDATE SET
      article_column = EXCLUDED.article_column,
      brand_column = EXCLUDED.brand_column,
      name_column = EXCLUDED.name_column,
      price_column = EXCLUDED.price_column,
      stock_column = EXCLUDED.stock_column,
      start_row = EXCLUDED.start_row,
      markup_percent = EXCLUDED.markup_percent,
      updated_at = now()
    RETURNING article_column, brand_column, name_column, price_column, stock_column, start_row, markup_percent, updated_at
    `,
    [
      supplierId,
      mapping.article.trim().toUpperCase(),
      mapping.brand?.trim().toUpperCase() || null,
      mapping.name?.trim().toUpperCase() || null,
      mapping.price.trim().toUpperCase(),
      mapping.stock?.trim().toUpperCase() || null,
      mapping.startRow || 1,
      mapping.markup || 0,
    ]
  );

  const row = result.rows[0];
  return {
    article: row.article_column,
    brand: row.brand_column,
    name: row.name_column,
    price: row.price_column,
    stock: row.stock_column,
    startRow: row.start_row,
    // markup_percent — колонка типа NUMERIC, драйвер pg возвращает
    // такие значения строкой (чтобы случайно не потерять точность
    // при преобразовании в float), поэтому здесь явно переводим
    // её в обычное число
    markup: parseFloat(row.markup_percent),
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------
// POST /api/suppliers — создать поставщика (и его маппинг)
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  let body: CreateSupplierRequestBody;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const validationError = validateSupplierInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // Если id передан, он обязан быть настоящим UUID — иначе это,
  // скорее всего, старый демо-идентификатор вида "sup-1"
  const isUpdate = Boolean(body.id);
  if (isUpdate && !isValidUuid(body.id as string)) {
    return NextResponse.json(
      { error: 'id поставщика должен быть корректным UUID.' },
      { status: 400 }
    );
  }

  // Берём отдельное подключение из пула на всё время транзакции —
  // сохранение поставщика и его маппинга должны либо пройти оба
  // успешно, либо не пройти вообще
  const client = await pool.connect();

  const currency = normalizeCurrency(body.currency);

  try {
    await client.query('BEGIN');

    let supplierRow;

    if (isUpdate) {
      const updateResult = await client.query(
        `
        UPDATE suppliers
        SET name = $2, contact_name = $3, phone = $4, email = $5, currency = $6
        WHERE id = $1
        RETURNING id, name, contact_name, phone, email, currency, created_at
        `,
        [
          body.id,
          body.name.trim(),
          body.contactName?.trim() || null,
          body.phone?.trim() || null,
          body.email?.trim() || null,
          currency,
        ]
      );

      if (updateResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Поставщик с таким id не найден.' },
          { status: 404 }
        );
      }

      supplierRow = updateResult.rows[0];
    } else {
      const insertResult = await client.query(
        `
        INSERT INTO suppliers (name, contact_name, phone, email, currency)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, contact_name, phone, email, currency, created_at
        `,
        [
          body.name.trim(),
          body.contactName?.trim() || null,
          body.phone?.trim() || null,
          body.email?.trim() || null,
          currency,
        ]
      );
      supplierRow = insertResult.rows[0];
    }

    const supplierId: string = supplierRow.id;

    let mapping: MappingResponse | null = null;
    if (body.mapping) {
      mapping = await upsertMapping(client, supplierId, body.mapping);
    }

    await client.query('COMMIT');

    const supplier: SupplierResponse = {
      id: supplierRow.id,
      name: supplierRow.name,
      contactName: supplierRow.contact_name,
      phone: supplierRow.phone,
      email: supplierRow.email,
      currency: supplierRow.currency,
      createdAt: supplierRow.created_at,
      mapping,
    };

    return NextResponse.json(
      { success: true, supplier },
      { status: isUpdate ? 200 : 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Ошибка при сохранении поставщика:', error);

    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось сохранить поставщика: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------
// GET /api/suppliers — список всех поставщиков с их маппингом
// ------------------------------------------------------------
export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.name,
        s.contact_name,
        s.phone,
        s.email,
        s.currency,
        s.created_at,
        m.article_column,
        m.brand_column,
        m.name_column,
        m.price_column,
        m.stock_column,
        m.start_row,
        m.markup_percent,
        m.updated_at AS mapping_updated_at
      FROM suppliers s
      LEFT JOIN supplier_excel_mappings m ON m.supplier_id = s.id
      ORDER BY s.created_at DESC
    `);

    const suppliers: SupplierResponse[] = result.rows.map((row) => {
      const hasMapping = row.article_column !== null;

      return {
        id: row.id,
        name: row.name,
        contactName: row.contact_name,
        phone: row.phone,
        email: row.email,
        currency: row.currency,
        createdAt: row.created_at,
        mapping: hasMapping
          ? {
              article: row.article_column,
              brand: row.brand_column,
              name: row.name_column,
              price: row.price_column,
              stock: row.stock_column,
              startRow: row.start_row,
              markup: parseFloat(row.markup_percent),
              updatedAt: row.mapping_updated_at,
            }
          : null,
      };
    });

    return NextResponse.json({ success: true, suppliers });
  } catch (error) {
    console.error('Ошибка при получении списка поставщиков:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список поставщиков: ' + message },
      { status: 500 }
    );
  }
}
```

### `app/api/suppliers/parse-excel/route.ts` (новый файл, создай папку `app/api/suppliers/parse-excel/`)

```typescript
// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес запроса: POST /api/suppliers/parse-excel
//
// Что делает этот файл, по шагам:
//   1. Принимает Excel-файл поставщика, ID поставщика и настройки
//      маппинга колонок через multipart/form-data (FormData).
//   2. Читает файл через библиотеку "xlsx" (SheetJS) и разбирает
//      ВСЕ строки файла (без ограничения в 10 штук).
//   3. Чистит артикулы, считает розничные цены.
//   4. Сохраняет все товары в PostgreSQL пачками (Batch Insert),
//      используя Upsert: если товар с таким артикулом у этого
//      поставщика уже есть — обновляет его, если нет — создаёт.
//   5. Возвращает { success: true, addedCount, updatedCount }.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { Pool, PoolClient } from 'pg';

// Библиотеки xlsx и pg используют Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ТИПЫ ДАННЫХ
// ------------------------------------------------------------

interface MappingSettings {
  article: string;   // колонка с артикулом (SKU), например "B"
  brand: string;      // колонка с брендом, например "C"
  name: string;         // колонка с названием детали, например "D"
  price: string;          // колонка с оптовой ценой поставщика, например "F"
  stock: string;            // колонка с остатком на складе, например "G"
  startRow: number;           // с какой строки файла начинаются данные (1 = первая строка)
  markup: number;               // наценка в процентах, например 20 означает "+20%"
}

interface ParsedProduct {
  article: string;
  brand: string;
  name: string;
  supplierPrice: number;
  retailPrice: number;
  stock: number;
}

// Местная валюта — украинская гривна. Тот же код, что и
// DEFAULT_CURRENCY в app/api/suppliers/route.ts. Для неё курс всегда
// считается равным 1.0 прямо здесь, в коде, а не в базе
const LOCAL_CURRENCY = 'UAH';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Переводит букву колонки Excel ("A", "B", ... "AA") ИЛИ номер
// колонки ("1", "2", ...) в индекс массива с отсчётом от нуля.
function columnToIndex(value: string): number {
  const clean = value.trim().toUpperCase();

  if (/^[0-9]+$/.test(clean)) {
    return parseInt(clean, 10) - 1;
  }

  let index = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i) - 64; // код символа 'A' равен 65, значит A -> 1
    index = index * 26 + code;
  }
  return index - 1;
}

// Очищает артикул от лишних пробелов, дефисов и спецсимволов,
// приводит к верхнему регистру
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

function parseCellNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value === null || value === undefined || value === '') return 0;

  const cleaned = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.');

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// exchangeRate — курс валюты поставщика к местной валюте
function parseExcelBuffer(buffer: Buffer, mapping: MappingSettings, exchangeRate: number): ParsedProduct[] {
  if (!mapping.article || !mapping.price) {
    throw new Error('Не указаны колонки "Артикул" и/или "Цена поставщика"');
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('В файле не найдено ни одного листа');
  }
  const sheet = workbook.Sheets[firstSheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
  });

  const articleIdx = columnToIndex(mapping.article);
  const brandIdx = mapping.brand ? columnToIndex(mapping.brand) : -1;
  const nameIdx = mapping.name ? columnToIndex(mapping.name) : -1;
  const priceIdx = columnToIndex(mapping.price);
  const stockIdx = mapping.stock ? columnToIndex(mapping.stock) : -1;

  const startIndex = Math.max(0, (mapping.startRow || 1) - 1);
  const markup = mapping.markup || 0;

  const products: ParsedProduct[] = [];

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawArticle = row[articleIdx];
    const rawBrand = brandIdx >= 0 ? row[brandIdx] : '';
    const rawName = nameIdx >= 0 ? row[nameIdx] : '';
    const rawPrice = row[priceIdx];
    const rawStock = stockIdx >= 0 ? row[stockIdx] : '';

    const article = cleanArticle(rawArticle);
    const brand = String(rawBrand ?? '').trim();
    const name = String(rawName ?? '').trim();
    const priceInSupplierCurrency = parseCellNumber(rawPrice);
    const stock = parseCellNumber(rawStock);

    if (!article && !priceInSupplierCurrency) continue;

    // Шаг 1: переводим цену из валюты поставщика в местную валюту
    const supplierPrice = Math.round(priceInSupplierCurrency * exchangeRate * 100) / 100;

    // Шаг 2: сверху накидываем наценку
    const retailPrice = Math.round(supplierPrice * (1 + markup / 100) * 100) / 100;

    products.push({ article, brand, name, supplierPrice, retailPrice, stock });
  }

  return products;
}

// Если в самом прайс-листе поставщика один и тот же артикул
// случайно встречается несколько раз, оставляем только последнюю
// строку с ним
function deduplicateByArticle(products: ParsedProduct[]): ParsedProduct[] {
  const byArticle = new Map<string, ParsedProduct>();
  for (const product of products) {
    byArticle.set(product.article, product);
  }
  return Array.from(byArticle.values());
}

const BATCH_SIZE = 500;

interface UpsertResult {
  addedCount: number;
  updatedCount: number;
}

async function upsertBatch(
  client: PoolClient,
  supplierId: string,
  batch: ParsedProduct[]
): Promise<UpsertResult> {
  const values: unknown[] = [];
  const rowsSql: string[] = [];

  batch.forEach((product, i) => {
    const base = i * 7;
    rowsSql.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
    );
    values.push(
      supplierId,
      product.article,
      product.brand,
      product.name,
      product.supplierPrice,
      product.retailPrice,
      product.stock
    );
  });

  const query = `
    INSERT INTO products
      (supplier_id, article, brand, name, cost_price, retail_price, stock)
    VALUES
      ${rowsSql.join(', ')}
    ON CONFLICT (supplier_id, article)
    DO UPDATE SET
      retail_price = EXCLUDED.retail_price,
      cost_price = EXCLUDED.cost_price,
      name = EXCLUDED.name,
      brand = EXCLUDED.brand,
      stock = EXCLUDED.stock,
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  `;

  const result = await client.query(query, values);

  let addedCount = 0;
  let updatedCount = 0;
  for (const row of result.rows) {
    if (row.inserted) {
      addedCount++;
    } else {
      updatedCount++;
    }
  }

  return { addedCount, updatedCount };
}

async function saveProductsToDatabase(
  supplierId: string,
  products: ParsedProduct[]
): Promise<UpsertResult> {
  const client = await pool.connect();

  let addedCount = 0;
  let updatedCount = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const batchResult = await upsertBatch(client, supplierId, batch);
      addedCount += batchResult.addedCount;
      updatedCount += batchResult.updatedCount;
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { addedCount, updatedCount };
}

// ------------------------------------------------------------
// ОБРАБОТЧИК POST-ЗАПРОСА
// ------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file');
    const mappingRaw = formData.get('mapping');
    const supplierId = formData.get('supplierId');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не найден в запросе. Ожидается поле "file".' },
        { status: 400 }
      );
    }

    if (!supplierId || typeof supplierId !== 'string') {
      return NextResponse.json(
        { error: 'Не передан ID поставщика (поле "supplierId").' },
        { status: 400 }
      );
    }

    if (!isValidUuid(supplierId)) {
      return NextResponse.json(
        { error: 'ID поставщика должен быть корректным UUID.' },
        { status: 400 }
      );
    }

    if (!mappingRaw || typeof mappingRaw !== 'string') {
      return NextResponse.json(
        { error: 'Не переданы настройки маппинга (поле "mapping").' },
        { status: 400 }
      );
    }

    let mapping: MappingSettings;
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json(
        { error: 'Настройки маппинга должны быть корректным JSON.' },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------
    // ВАЛЮТА ПОСТАВЩИКА И ЕЁ ГЛОБАЛЬНЫЙ КУРС
    // ------------------------------------------------------------
    const supplierResult = await pool.query(
      'SELECT currency FROM suppliers WHERE id = $1',
      [supplierId]
    );

    if (supplierResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Поставщик с таким id не найден.' },
        { status: 404 }
      );
    }

    const supplierCurrency: string = supplierResult.rows[0].currency;

    let exchangeRate: number;
    if (supplierCurrency === LOCAL_CURRENCY) {
      exchangeRate = 1.0;
    } else {
      const rateResult = await pool.query(
        'SELECT rate FROM global_exchange_rates WHERE currency = $1',
        [supplierCurrency]
      );

      if (rateResult.rows.length === 0) {
        return NextResponse.json(
          {
            error:
              `Для валюты ${supplierCurrency} ещё не задан глобальный курс. ` +
              'Откройте виджет "Глобальные курсы валют" и укажите его перед загрузкой прайс-листа.',
          },
          { status: 400 }
        );
      }

      exchangeRate = parseFloat(rateResult.rows[0].rate);
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимальный размер — 10 МБ.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const allProducts = parseExcelBuffer(buffer, mapping, exchangeRate);

    if (allProducts.length === 0) {
      return NextResponse.json(
        { error: 'В файле не найдено ни одной строки с данными. Проверьте настройки маппинга.' },
        { status: 400 }
      );
    }

    const uniqueProducts = deduplicateByArticle(allProducts);

    const { addedCount, updatedCount } = await saveProductsToDatabase(supplierId, uniqueProducts);

    return NextResponse.json({
      success: true,
      addedCount,
      updatedCount,
    });
  } catch (error) {
    console.error('Ошибка при обработке и сохранении Excel-файла поставщика:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обработать файл: ' + message },
      { status: 500 }
    );
  }
}
```

### `components/GlobalRatesWidget.tsx` (новый файл, создай папку `components/`)

```tsx
'use client';

// ============================================================
// Виджет "Глобальные курсы валют".
//
// Раньше курс валюты настраивался у КАЖДОГО поставщика отдельно —
// это было неудобно: если курс доллара менялся, приходилось идти
// по всем поставщикам с долларовым прайсом и поправлять курс у
// каждого вручную. Этот виджет решает задачу иначе: курс валюты —
// общий для ВСЕХ поставщиков сразу. Один раз поменяли курс здесь —
// и он сразу применится ко всем, у кого выбрана эта валюта, при
// следующей загрузке прайс-листа.
//
// Использует эндпоинт app/api/rates/route.ts:
//   GET  /api/rates  — получить сохранённые курсы
//   POST /api/rates  — сохранить сразу несколько курсов одним запросом
//
// 'use client' в самом верху обязателен: компонент использует хуки
// (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

// Валюты, для которых виджет показывает отдельное поле ввода курса.
const WIDGET_CURRENCIES = ['USD', 'EUR'] as const;
type WidgetCurrency = (typeof WIDGET_CURRENCIES)[number];

const CURRENCY_LABELS: Record<WidgetCurrency, string> = {
  USD: 'USD — доллар США',
  EUR: 'EUR — евро',
};

// Один курс валюты в том виде, в котором его отдаёт GET /api/rates
interface RateData {
  currency: string;
  rate: number;
  updatedAt: string;
}

export default function GlobalRatesWidget() {
  // ---- уже сохранённые в базе курсы (для подписи "обновлено...") ----
  const [savedRates, setSavedRates] = useState<Record<string, RateData>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- значения полей ввода — строки, пока форма редактируется ----
  const [form, setForm] = useState<Record<WidgetCurrency, string>>({ USD: '', EUR: '' });

  // ---- сохранение формы ----
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // ------------------------------------------------------------
  // ЗАГРУЗКА ТЕКУЩИХ КУРСОВ ПРИ ОТКРЫТИИ ЭКРАНА (GET /api/rates)
  // ------------------------------------------------------------
  const fetchRates = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/rates');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить курсы валют');
      }

      const rates = data.rates as RateData[];

      const byCurrency: Record<string, RateData> = {};
      const nextForm: Record<WidgetCurrency, string> = { USD: '', EUR: '' };
      for (const rate of rates) {
        byCurrency[rate.currency] = rate;
        if ((WIDGET_CURRENCIES as readonly string[]).includes(rate.currency)) {
          nextForm[rate.currency as WidgetCurrency] = String(rate.rate);
        }
      }

      setSavedRates(byCurrency);
      setForm(nextForm);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке курсов валют');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  // ------------------------------------------------------------
  // СОХРАНЕНИЕ КУРСОВ ОДНОЙ КНОПКОЙ (POST /api/rates)
  // ------------------------------------------------------------
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError(null);
    setSaved(false);

    // Отправляем только те валюты, для которых поле реально заполнено
    const payload = WIDGET_CURRENCIES.filter((currency) => form[currency].trim() !== '').map(
      (currency) => ({ currency, rate: parseFloat(form[currency]) })
    );

    if (payload.length === 0) {
      setSaveError('Укажите хотя бы один курс, прежде чем сохранять');
      return;
    }
    if (payload.some((item) => !Number.isFinite(item.rate) || item.rate <= 0)) {
      setSaveError('Курс должен быть положительным числом');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось обновить курсы валют');
      }

      await fetchRates();
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Ошибка сети при сохранении курсов');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="p-5 rounded-lg mb-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
    >
      <h2 className="text-base font-semibold mb-1">Глобальные курсы валют</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
        Курс здесь один на всех — меняете его один раз, и он сразу применяется ко всем поставщикам с этой
        валютой при следующей загрузке прайс-листа. Курс конкретного поставщика больше не настраивается
        отдельно — только сама валюта, в которой он присылает прайс.
      </p>

      {loadError && (
        <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
          {loadError}{' '}
          <button type="button" onClick={fetchRates} className="underline">
            Повторить
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        {WIDGET_CURRENCIES.map((currency) => (
          <div key={currency} className="w-40">
            <label
              htmlFor={`rate-${currency}`}
              className="block text-xs font-medium mb-1"
              style={{ color: 'var(--ink-muted)' }}
            >
              {CURRENCY_LABELS[currency]}
            </label>
            <input
              id={`rate-${currency}`}
              type="number"
              min={0}
              // step="any" — чтобы браузер не отвергал нормальные дробные
              // значения курса из-за погрешностей плавающей запятой
              step="any"
              placeholder="напр. 41.50"
              disabled={loading}
              className="w-full px-3 py-2 text-sm rounded-md font-mono disabled:opacity-50"
              style={{ border: '1px solid var(--line)' }}
              value={form[currency]}
              onChange={(e) => setForm({ ...form, [currency]: e.target.value })}
            />
            {savedRates[currency] && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-faint)' }}>
                Сейчас в базе: {savedRates[currency].rate}
              </p>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={saving || loading}
          className="px-5 py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          {saving ? 'Сохранение...' : 'Обновить глобальные курсы'}
        </button>
      </form>

      {saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
          {saveError}
        </p>
      )}
      {saved && !saveError && (
        <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
          Курсы обновлены — новые значения уже используются при загрузке прайс-листов
        </p>
      )}
    </section>
  );
}
```

### `components/SupplierMappingScreen.tsx` (новый файл)

```tsx
'use client';

// ============================================================
// Экран "Поставщики и маппинг Excel" — подключённый к настоящему
// бэкенду (без localStorage).
//
// Использует три эндпоинта:
//   GET  /api/suppliers              — список поставщиков + маппинг
//   POST /api/suppliers              — создать поставщика (без id
//                                       в теле запроса) ИЛИ обновить
//                                       существующего (с id в теле)
//   POST /api/suppliers/parse-excel  — загрузить и разобрать
//                                       Excel-файл выбранного поставщика
//
// 'use client' в самом верху обязателен: компонент использует
// хуки (useState/useEffect) и работает с браузерным fetch
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent } from 'react';
import GlobalRatesWidget from './GlobalRatesWidget';

// ------------------------------------------------------------
// ТИПЫ — повторяют то, что отдаёт бэкенд (см. app/api/suppliers/route.ts)
// ------------------------------------------------------------
interface MappingData {
  article: string;
  brand: string | null;
  name: string | null;
  price: string;
  stock: string | null;
  startRow: number;
  markup: number;
  updatedAt: string;
}

interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  // Валюта, в которой поставщик присылает прайс ("UAH", "USD", "EUR"...).
  // КУРС этой валюты здесь больше не хранится — теперь курс общий для
  // всех поставщиков одной валюты и настраивается один раз в виджете
  // "Глобальные курсы валют" (см. components/GlobalRatesWidget.tsx
  // и app/api/rates/route.ts)
  currency: string;
  createdAt: string;
  mapping: MappingData | null;
}

// Валюты, которые можно выбрать в выпадающем списке. "Местная" — это
// код местной валюты (см. LOCAL_CURRENCY ниже) — для неё курс всегда
// считается равным 1.0 и отдельно нигде не настраивается
const LOCAL_CURRENCY = 'UAH';
const CURRENCY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: LOCAL_CURRENCY, label: 'Местная (UAH)' },
  { value: 'USD', label: 'USD — доллар США' },
  { value: 'EUR', label: 'EUR — евро' },
];

interface NewSupplierForm {
  name: string;
  contactName: string;
  phone: string;
  email: string;
}

interface MappingFormState {
  article: string;
  brand: string;
  name: string;
  price: string;
  stock: string;
  startRow: string;
  markup: string;
  // Валюта прайса — тоже строка, пока форма редактируется. Курса
  // здесь больше нет: он общий для валюты и настраивается отдельно,
  // в виджете "Глобальные курсы валют"
  currency: string;
}

const EMPTY_NEW_SUPPLIER: NewSupplierForm = { name: '', contactName: '', phone: '', email: '' };
const EMPTY_MAPPING_FORM: MappingFormState = {
  article: '',
  brand: '',
  name: '',
  price: '',
  stock: '',
  startRow: '1',
  markup: '0',
  currency: LOCAL_CURRENCY,
};

export default function SupplierMappingScreen() {
  // ---- список поставщиков (GET /api/suppliers) ----
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- форма "Новый поставщик" ----
  const [newSupplier, setNewSupplier] = useState<NewSupplierForm>(EMPTY_NEW_SUPPLIER);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierFormError, setSupplierFormError] = useState<string | null>(null);

  // ---- выбор поставщика для настройки (выпадающий список) ----
  const [selectedId, setSelectedId] = useState<string>('');

  // ---- форма маппинга + наценки выбранного поставщика ----
  const [mappingForm, setMappingForm] = useState<MappingFormState>(EMPTY_MAPPING_FORM);
  const [savingMapping, setSavingMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mappingSaved, setMappingSaved] = useState(false);

  // ---- загрузка Excel-файла ----
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ addedCount: number; updatedCount: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ------------------------------------------------------------
  // 1. ЗАГРУЗКА СПИСКА ПОСТАВЩИКОВ ПРИ ОТКРЫТИИ ЭКРАНА (GET)
  // ------------------------------------------------------------
  const fetchSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    setLoadError(null);
    try {
      const response = await fetch('/api/suppliers');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось загрузить список поставщиков');
      }
      setSuppliers(data.suppliers as Supplier[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке поставщиков');
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  const selectedSupplier = suppliers.find((s) => s.id === selectedId) || null;

  // ВАЖНО: в зависимостях эффекта ниже — selectedId (строка), а НЕ сам
  // объект selectedSupplier. Причина: после fetchSuppliers() массив
  // suppliers заменяется на новый, и объект selectedSupplier внутри
  // него оказывается НОВЫМ по ссылке, даже если это "тот же" поставщик
  // с теми же полями. Если бы эффект зависел от selectedSupplier,
  // он срабатывал бы повторно каждый раз после обновления списка —
  // например, сразу после handleSaveMapping() он сбрасывал бы
  // mappingSaved обратно в false, и сообщение "Настройки сохранены"
  // ни разу не успевало бы показаться пользователю
  useEffect(() => {
    if (!selectedSupplier) {
      setMappingForm(EMPTY_MAPPING_FORM);
    } else {
      const currencyFields = {
        currency: selectedSupplier.currency,
      };
      if (selectedSupplier.mapping) {
        const m = selectedSupplier.mapping;
        setMappingForm({
          article: m.article,
          brand: m.brand || '',
          name: m.name || '',
          price: m.price,
          stock: m.stock || '',
          startRow: String(m.startRow),
          markup: String(m.markup),
          ...currencyFields,
        });
      } else {
        setMappingForm({ ...EMPTY_MAPPING_FORM, ...currencyFields });
      }
    }
    setSelectedFile(null);
    setUploadResult(null);
    setUploadError(null);
    setMappingSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ------------------------------------------------------------
  // 2. СОЗДАНИЕ ПОСТАВЩИКА — POST /api/suppliers БЕЗ id
  // ------------------------------------------------------------
  const handleAddSupplier = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSupplierFormError(null);

    if (!newSupplier.name.trim()) {
      setSupplierFormError('Укажите название поставщика');
      return;
    }
    if (!newSupplier.phone.trim() && !newSupplier.email.trim()) {
      setSupplierFormError('Укажите телефон или email');
      return;
    }

    setSavingSupplier(true);
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSupplier.name,
          contactName: newSupplier.contactName || undefined,
          phone: newSupplier.phone || undefined,
          email: newSupplier.email || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось создать поставщика');
      }

      await fetchSuppliers();
      setSelectedId(data.supplier.id as string);
      setNewSupplier(EMPTY_NEW_SUPPLIER);
    } catch (error) {
      setSupplierFormError(error instanceof Error ? error.message : 'Ошибка сети при сохранении поставщика');
    } finally {
      setSavingSupplier(false);
    }
  };

  // ------------------------------------------------------------
  // 3. СОХРАНЕНИЕ МАППИНГА — POST /api/suppliers С id (обновление)
  // ------------------------------------------------------------
  const handleSaveMapping = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMappingError(null);
    setMappingSaved(false);

    if (!selectedSupplier) {
      setMappingError('Сначала выберите поставщика из списка');
      return;
    }
    if (!mappingForm.article.trim() || !mappingForm.price.trim()) {
      setMappingError('Укажите хотя бы колонки "Артикул" и "Цена поставщика"');
      return;
    }

    setSavingMapping(true);
    try {
      const response = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedSupplier.id,
          name: selectedSupplier.name,
          contactName: selectedSupplier.contactName || undefined,
          phone: selectedSupplier.phone || undefined,
          email: selectedSupplier.email || undefined,
          // currency — на верхнем уровне тела запроса (а не внутри
          // mapping), потому что это свойство самого поставщика в
          // таблице suppliers. Курса здесь больше нет — он общий для
          // валюты и меняется через app/api/rates/route.ts
          currency: mappingForm.currency,
          mapping: {
            article: mappingForm.article,
            brand: mappingForm.brand || undefined,
            name: mappingForm.name || undefined,
            price: mappingForm.price,
            stock: mappingForm.stock || undefined,
            startRow: parseInt(mappingForm.startRow, 10) || 1,
            markup: parseFloat(mappingForm.markup) || 0,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось сохранить настройки маппинга');
      }

      await fetchSuppliers();
      setMappingSaved(true);
    } catch (error) {
      setMappingError(error instanceof Error ? error.message : 'Ошибка сети при сохранении маппинга');
    } finally {
      setSavingMapping(false);
    }
  };

  // ------------------------------------------------------------
  // 4. ЗАГРУЗКА EXCEL-ФАЙЛА — POST FormData /api/suppliers/parse-excel
  // ------------------------------------------------------------
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] || null);
    setUploadResult(null);
    setUploadError(null);
  };

  const handleUploadExcel = async () => {
    setUploadError(null);
    setUploadResult(null);

    if (!selectedSupplier) {
      setUploadError('Сначала выберите поставщика');
      return;
    }
    if (!selectedFile) {
      setUploadError('Сначала выберите файл Excel');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('supplierId', selectedSupplier.id);
      formData.append(
        'mapping',
        JSON.stringify({
          article: mappingForm.article,
          brand: mappingForm.brand,
          name: mappingForm.name,
          price: mappingForm.price,
          stock: mappingForm.stock,
          startRow: parseInt(mappingForm.startRow, 10) || 1,
          markup: parseFloat(mappingForm.markup) || 0,
        })
      );

      // Заголовок Content-Type специально НЕ проставляем вручную —
      // браузер сам добавит "multipart/form-data" с правильным
      // boundary
      const response = await fetch('/api/suppliers/parse-excel', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Не удалось обработать файл');
      }

      setUploadResult({ addedCount: data.addedCount, updatedCount: data.updatedCount });
      setSelectedFile(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Ошибка сети при загрузке файла');
    } finally {
      setUploading(false);
    }
  };

  const canUpload = Boolean(selectedSupplier) && Boolean(selectedFile) && !uploading;
  const totalProcessed = uploadResult ? uploadResult.addedCount + uploadResult.updatedCount : 0;

  // Токены оформления (CSS custom properties) — если в проекте уже
  // есть общие переменные в globals.css, этот объект можно перенести
  // туда и убрать отсюда
  const rootStyle = {
    '--bg': '#F5F6F8',
    '--surface': '#FFFFFF',
    '--surface-2': '#EEF0F3',
    '--line': '#DCE0E6',
    '--ink': '#161A21',
    '--ink-muted': '#5C6472',
    '--ink-faint': '#8A93A2',
    '--accent': '#C2560E',
    '--accent-hover': '#A6480C',
    '--accent-ink': '#FFFFFF',
    '--bad': '#C23B3B',
    '--bad-soft': '#FBE3E3',
    '--good': '#1F8A5F',
    '--good-soft': '#DFF3E9',
    background: 'var(--bg)',
    color: 'var(--ink)',
  } as CSSProperties;

  return (
    <div className="min-h-screen" style={rootStyle}>
      <div className="max-w-5xl mx-auto px-5 md:px-8 py-8">
        <header className="mb-7">
          <h1 className="text-2xl font-semibold mb-1.5">Поставщики и маппинг Excel</h1>
          <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
            Экран подключён к настоящему API: поставщики хранятся в PostgreSQL, а не в localStorage браузера.
          </p>
        </header>

        {/* Виджет курсов валют — наверху страницы, над всем остальным.
            Он не зависит от того, какой поставщик сейчас выбран внизу —
            меняет курсы сразу для всех поставщиков этой валюты */}
        <GlobalRatesWidget />

        <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-6 items-start">
          {/* ==================== ФОРМА ДОБАВЛЕНИЯ ПОСТАВЩИКА ==================== */}
          <section
            className="p-5 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <h2 className="text-base font-semibold mb-3">Новый поставщик</h2>

            <form onSubmit={handleAddSupplier} className="flex flex-col gap-3.5">
              <div>
                <label htmlFor="f-name" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Название компании *
                </label>
                <input
                  id="f-name"
                  type="text"
                  className="w-full px-3 py-2 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)' }}
                  placeholder="напр. ООО «АвтоЗапчасть Плюс»"
                  value={newSupplier.name}
                  onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-contact" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Контактное лицо
                </label>
                <input
                  id="f-contact"
                  type="text"
                  className="w-full px-3 py-2 text-sm rounded-md"
                  style={{ border: '1px solid var(--line)' }}
                  value={newSupplier.contactName}
                  onChange={(e) => setNewSupplier({ ...newSupplier, contactName: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-phone" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Телефон
                </label>
                <input
                  id="f-phone"
                  type="tel"
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)' }}
                  value={newSupplier.phone}
                  onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="f-email" className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                  Email
                </label>
                <input
                  id="f-email"
                  type="email"
                  className="w-full px-3 py-2 text-sm rounded-md font-mono"
                  style={{ border: '1px solid var(--line)' }}
                  value={newSupplier.email}
                  onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                />
              </div>

              {supplierFormError && (
                <p className="text-xs" style={{ color: 'var(--bad)' }}>
                  {supplierFormError}
                </p>
              )}

              <button
                type="submit"
                disabled={savingSupplier}
                className="w-full py-2.5 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
              >
                {savingSupplier ? 'Сохранение...' : 'Сохранить поставщика'}
              </button>
            </form>
          </section>

          {/* ==================== ВЫБОР ПОСТАВЩИКА ==================== */}
          <section
            className="p-5 rounded-lg"
            style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
          >
            <h2 className="text-base font-semibold mb-1">Поставщик</h2>
            <p className="text-xs mb-4" style={{ color: 'var(--ink-muted)' }}>
              Выберите поставщика из базы данных, чтобы настроить его маппинг и загрузить прайс-лист.
            </p>

            {loadError && (
              <p className="text-xs mb-3" style={{ color: 'var(--bad)' }}>
                {loadError}{' '}
                <button type="button" onClick={fetchSuppliers} className="underline">
                  Повторить
                </button>
              </p>
            )}

            <select
              className="w-full px-3 py-2 text-sm rounded-md mb-3"
              style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
              value={selectedId}
              disabled={loadingSuppliers}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">
                {loadingSuppliers ? 'Загрузка списка...' : 'Выберите поставщика'}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.mapping ? '' : ' (маппинг не настроен)'}
                </option>
              ))}
            </select>

            {selectedSupplier && (
              <div className="text-xs p-3 rounded-md mb-2" style={{ background: 'var(--surface-2)', color: 'var(--ink-muted)' }}>
                <div>
                  <span className="font-medium">Контакт:</span> {selectedSupplier.contactName || '—'}
                </div>
                <div>
                  <span className="font-medium">Телефон/Email:</span>{' '}
                  {[selectedSupplier.phone, selectedSupplier.email].filter(Boolean).join(' / ') || '—'}
                </div>
                <div className="font-mono mt-1" style={{ color: 'var(--ink-faint)' }}>
                  id: {selectedSupplier.id}
                </div>
              </div>
            )}

            {/* ==================== МАППИНГ + НАЦЕНКА ==================== */}
            {selectedSupplier && (
              <form onSubmit={handleSaveMapping} className="mt-4 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                <h3 className="text-sm font-semibold mb-3">Маппинг Excel и наценка</h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(
                    [
                      ['article', 'Артикул'],
                      ['brand', 'Бренд'],
                      ['name', 'Название детали'],
                      ['price', 'Цена поставщика'],
                      ['stock', 'Остаток'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                        {label}
                      </label>
                      <input
                        type="text"
                        maxLength={3}
                        className="w-full px-3 py-2 text-sm rounded-md font-mono uppercase"
                        style={{ border: '1px solid var(--line)' }}
                        value={mappingForm[field]}
                        onChange={(e) =>
                          setMappingForm({ ...mappingForm, [field]: e.target.value.toUpperCase() })
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      Начинать со строки
                    </label>
                    <input
                      type="number"
                      min={1}
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)' }}
                      value={mappingForm.startRow}
                      onChange={(e) => setMappingForm({ ...mappingForm, startRow: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                      Наценка, %
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      className="w-full px-3 py-2 text-sm rounded-md font-mono"
                      style={{ border: '1px solid var(--line)' }}
                      value={mappingForm.markup}
                      onChange={(e) => setMappingForm({ ...mappingForm, markup: e.target.value })}
                    />
                  </div>
                </div>

                {/* ==================== ВАЛЮТА ПРАЙСА ==================== */}
                {/* Курса здесь больше нет — только выбор валюты. Сам курс
                    этой валюты общий для всех поставщиков и настраивается
                    один раз в виджете "Глобальные курсы валют" наверху
                    страницы (см. components/GlobalRatesWidget.tsx) */}
                <div className="mt-3.5 pt-3.5" style={{ borderTop: '1px dashed var(--line)' }}>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-muted)' }}>
                    Валюта прайса
                  </label>
                  <select
                    className="w-full sm:w-1/2 px-3 py-2 text-sm rounded-md"
                    style={{ border: '1px solid var(--line)', background: 'var(--surface)' }}
                    value={mappingForm.currency}
                    onChange={(e) => setMappingForm({ ...mappingForm, currency: e.target.value })}
                  >
                    {CURRENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-faint)' }}>
                  Розничная цена считается так: (цена из Excel × глобальный курс валюты) × (1 + наценка / 100).
                  Курс для иностранной валюты нужно один раз задать в виджете "Глобальные курсы валют" наверху —
                  без него загрузка прайс-листа в этой валюте не пройдёт.
                </p>

                {mappingError && (
                  <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                    {mappingError}
                  </p>
                )}
                {mappingSaved && !mappingError && (
                  <p className="text-xs mt-2" style={{ color: 'var(--good)' }}>
                    Настройки сохранены
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingMapping}
                  className="w-full py-2.5 rounded-md text-sm font-medium mt-3 disabled:opacity-50"
                  style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                >
                  {savingMapping ? 'Сохранение...' : 'Сохранить настройки поставщика'}
                </button>

                {/* ==================== ЗАГРУЗКА EXCEL-ФАЙЛА ==================== */}
                <div className="mt-5 pt-4" style={{ borderTop: '1px dashed var(--line)' }}>
                  <h3 className="text-sm font-semibold mb-2">Загрузить прайс-лист</h3>

                  <div className="flex flex-wrap items-center gap-3">
                    <label
                      className="text-sm px-3.5 py-2 rounded-md cursor-pointer"
                      style={{ border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
                    >
                      Выбрать файл
                      <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                    </label>
                    <span className="text-xs font-mono" style={{ color: 'var(--ink-faint)' }}>
                      {selectedFile ? selectedFile.name : 'файл не выбран'}
                    </span>

                    <button
                      type="button"
                      disabled={!canUpload}
                      onClick={handleUploadExcel}
                      className="text-sm px-4 py-2 rounded-md disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
                    >
                      {uploading ? 'Загрузка...' : 'Загрузить прайс'}
                    </button>
                  </div>

                  {uploadError && (
                    <p className="text-xs mt-2" style={{ color: 'var(--bad)' }}>
                      {uploadError}
                    </p>
                  )}

                  {uploadResult && (
                    <p className="text-sm mt-3 p-3 rounded-md" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
                      Успешно обработано товаров: {totalProcessed} (Добавлено: {uploadResult.addedCount}, Обновлено:{' '}
                      {uploadResult.updatedCount})
                    </p>
                  )}
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
```

### `app/page.tsx` (проверь: если файл уже существует и содержит что-то другое — замени его содержимое на это; если создаётся впервые — просто создай)

```tsx
// Главная страница сайта — просто показывает экран
// «Поставщики и маппинг Excel» целиком
import SupplierMappingScreen from '@/components/SupplierMappingScreen';

export default function Home() {
  return <SupplierMappingScreen />;
}
```

---

## Шаг 4 — База данных и `.env.local`

Тебе не хватает одного секрета, который знает только пользователь —
пароль/строку подключения к базе PostgreSQL. **Останови выполнение и
спроси пользователя** одним из двух способов:

**Вариант А (Supabase, рекомендуется для новичка):**
Спроси, есть ли у него уже проект в Supabase. Если нет — попроси
зайти на supabase.com, создать проект (задать пароль базы данных) и
прислать тебе строку подключения из Project Settings → Database →
Connection string → URI. Если проект уже есть — попроси прислать
готовую строку подключения.

**Вариант Б (локальный PostgreSQL):**
Если у пользователя уже установлен и запущен локальный PostgreSQL —
спроси у него пользователя/пароль/имя базы и собери строку вида
`postgres://пользователь:пароль@localhost:5432/имя_базы`.

Когда строка подключения получена:

1. Создай в корне проекта файл `.env.local` с содержимым:
   ```
   DATABASE_URL=<строка подключения от пользователя>
   ```
2. Если это Supabase — сам выполнить SQL ты не можешь без прямого
   доступа к базе. Если у тебя есть `psql` и сетевой доступ к базе —
   выполни `schema.sql` напрямую:
   ```bash
   psql "<строка подключения>" -f schema.sql
   ```
   Если `psql` недоступен или сеть закрыта — попроси пользователя
   самого открыть в Supabase SQL Editor → New query, вставить
   содержимое `schema.sql` и нажать Run, и дождись его подтверждения
   перед тем как двигаться дальше.

---

## Шаг 5 — Проверка

1. Проверь типы без запуска сервера:
   ```bash
   npx tsc --noEmit
   ```
   Если есть ошибки — исправь их в созданных файлах (не трогая логику).

2. Запусти сервер разработки:
   ```bash
   npm run dev
   ```
3. Проверь, что сервер поднялся и отвечает (в отдельном терминале):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
   ```
   Ожидается `200`.

4. Проверь API курсов валют:
   ```bash
   curl -s http://localhost:3000/api/rates
   ```
   Ожидается `{"success":true,"rates":[]}` (пусто, пока курсы не заданы).

5. Останови сервер (`Ctrl+C`) после проверки — дальше пользователь
   будет запускать его сам через `npm run dev` и открывать
   `http://localhost:3000` в браузере.

---

## Шаг 6 — Отчёт пользователю

Кратко, по-русски, языком для новичка расскажи:
- что было создано (список файлов);
- что нужно сделать пользователю самому (если что-то осталось —
  например, применить `schema.sql` через Supabase SQL Editor);
- как запускать проект дальше: `npm run dev` → открыть
  `http://localhost:3000`;
- что можно проверить в интерфейсе: добавить поставщика, задать
  глобальный курс USD/EUR в виджете наверху, загрузить тестовый
  Excel-прайс.
