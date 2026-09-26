// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders/create
//
// Единственный маршрут, которым пользуется САМА ВИТРИНА (не админ-
// панель): покупатель собрал корзину на главной странице
// (components/StorefrontHome.tsx), заполнил имя и телефон и нажал
// "Підтвердити замовлення" — вот это тело запроса сюда и прилетает.
//
//   POST /api/orders/create
//   Тело запроса (JSON):
//   {
//     "customerName": "Іван",
//     "customerSurname": "Петренко",
//     "customerPhone": "+380501234567",
//     "city": "Київ",
//     "novaPoshtaAddress": "Відділення №25, вул. Хрещатик, 1",
//     "comment": "Зателефонуйте, будь ласка, ввечері",
//     "items": [
//       { "id": "3fa85f64-...", "count": 2 },
//       { "id": "7c9e6679-...", "count": 1 }
//     ],
//     "utmSource": "google", "utmMedium": "cpc", "utmCampaign": "tochnyi_artikul",
//     "utmTerm": null, "utmContent": null, "gclid": "Cj0KCQ...", "referrer": null
//   }
//
// customerName, customerSurname, customerPhone, city, novaPoshtaAddress
// обязательны; comment — необязательное поле (пожелание по доставке).
//
// utmSource/utmMedium/utmCampaign/utmTerm/utmContent/gclid/referrer —
// сквозная атрибуция заказа (откуда пришёл покупатель), тоже все
// необязательные. Фронтенд берёт их не из текущего URL, а из
// localStorage (components/StorefrontHome.tsx вызывает
// getStoredAttribution() из lib/attribution.ts) — там сохраняется
// самое ПЕРВОЕ посещение сайта этим браузером (first-touch), а не то,
// с какой страницы покупатель оформляет заказ прямо сейчас
//
// ВАЖНО про цену/артикул/бренд/название: фронтенд ПЕРЕДАЁТ их в теле
// запроса (retailPrice/article/brand/name — так исторически сложилось
// в CartItem), но этот роут их сознательно ИГНОРИРУЕТ и вместо этого
// сам перечитывает актуальные данные товара из таблицы products по
// id. Если довериться цене из тела запроса, покупатель мог бы через
// консоль браузера отправить любую цену, какую захочет — это классическая
// уязвимость (подмена цены на клиенте). Единственное, чему отсюда
// действительно можно доверять — это id товара и количество.
//
// Тексты ошибок в JSON-ответах этого роута — на УКРАИНСКОМ языке
// (в отличие от остальных API-роутов проекта, где они на русском):
// это единственный роут, который напрямую вызывает витрина
// (components/StorefrontHome.tsx показывает текст ошибки покупателю
// как есть, через orderError), а весь текст для покупателя на этом
// сайте — украинский. Комментарии в самом коде при этом, как и везде
// в проекте, остаются на русском.
//
// Дальше эти актуальные (проверенные) данные записываются в
// order_items уже как "снимок на момент покупки" — та же архитектура,
// что и во всей остальной админке (см. схему таблицы order_items в
// schema.sql): даже если товар потом подорожает, переименуется или
// вовсе будет удалён из каталога, в уже оформленном заказе останется
// точно то, что покупатель реально заказал.
//
// Вставка заказа и всех его позиций выполняется одной транзакцией
// (BEGIN...COMMIT): либо создаётся и сам заказ, и ВСЕ его позиции
// разом, либо (если что-то пошло не так на любом шаге) не создаётся
// вообще ничего — ROLLBACK. Так в базе никогда не появится "заказ без
// единой позиции" из-за случайной ошибки посередине.
// ============================================================

import { NextRequest, NextResponse, after } from 'next/server';
import { Pool } from 'pg';
import { sendTelegramMessage, sendTelegramMessageTo } from '@/lib/telegramNotify';
import { normalizePhone } from '@/lib/phoneNormalize';
import { computeCustomerPrice, type CustomerPricingRule } from '@/lib/customerPricing';

// Библиотека pg использует Node.js API, поэтому роут должен
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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Та же самая проверка телефона, что и на фронтенде (см. isValidPhone
// в components/StorefrontHome.tsx) — считаем только цифры и требуем,
// чтобы их было от 9 до 13. Проверку обязательно нужно повторить
// именно здесь, на сервере: фронтенд можно обойти (например, отправив
// запрос напрямую, минуя форму), а бэкенд — это последний рубеж,
// который решает, что реально попадёт в базу
function isValidPhone(value: string): boolean {
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length >= 9 && digitsOnly.length <= 13;
}

// Приводит необязательное строковое поле атрибуции (utm_*, gclid,
// referrer) к виду, в котором оно ляжет в базу: обрезает пробелы,
// а пустую строку/undefined/null превращает в null — та же логика,
// что и у comment чуть ниже, только вынесена в функцию, потому что
// здесь таких полей сразу семь
function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

// ------------------------------------------------------------
// ТИПЫ ТЕЛА ЗАПРОСА
// ------------------------------------------------------------

// Одна позиция корзины со стороны покупателя. Из всего этого объекта
// сервер реально использует только id и count — остальные поля
// (если фронтенд их прислал) просто игнорируются, см. комментарий
// в шапке файла про подмену цены
interface OrderCreateItemInput {
  id?: string;
  count?: number;
  retailPrice?: number;
  name?: string;
  article?: string;
  brand?: string;
}

interface OrderCreateRequestBody {
  customerName?: string;
  customerSurname?: string;
  customerPhone?: string;
  city?: string;
  novaPoshtaAddress?: string;
  // Ref міста/відділення з реального пошуку Нової Пошти на вітрині
  // (components/NovaPoshtaAddressFields.tsx) — необов'язкові, null,
  // якщо покупець ввів адресу вручну текстом або обрав доставку
  // кур'єром. Зберігаються, щоб оператору в адмінці не доводилось
  // шукати те саме відділення заново для створення ТТН (схема —
  // секція 33 schema.sql, app/api/orders/[id]/route.ts)
  cityRef?: string | null;
  warehouseRef?: string | null;
  comment?: string;
  items?: OrderCreateItemInput[];
  // Атрибуция первого визита (см. lib/attribution.ts) — откуда
  // пришёл покупатель. Все поля необязательные: при обычном прямом
  // заходе (без UTM-меток, без gclid, без стороннего referrer)
  // фронтенд присылает их как null, и это нормальная, ожидаемая
  // ситуация, а не ошибка
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  gclid?: string | null;
  referrer?: string | null;
}

// Строка из products, актуальная на момент оформления заказа — то,
// что реально ляжет "снимком" в order_items
interface ProductSnapshotRow {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
  cost_price: string; // NUMERIC из pg приходит строкой
  retail_price: string; // NUMERIC из pg приходит строкой
  supplier_id: string;
  supplier_name: string;
}

export async function POST(request: NextRequest) {
  // ---- разбор и базовая проверка тела запроса ----
  let body: OrderCreateRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Некоректний формат запиту.' },
      { status: 400 }
    );
  }

  const customerName = (body.customerName || '').trim();
  const customerSurname = (body.customerSurname || '').trim();
  const customerPhone = (body.customerPhone || '').trim();
  const city = (body.city || '').trim();
  const novaPoshtaAddress = (body.novaPoshtaAddress || '').trim();
  // Просто доверяем тому, что прислал фронтенд — эти Ref ни на что не
  // влияют в самом заказе, они лишь ускоряют создание ТТН в адмінці
  // позже (см. комментарий у поля в интерфейсе выше), поэтому нет
  // смысла проверять их через отдельный запрос к API Новой Пошти
  const cityRef = body.cityRef?.trim() || null;
  const warehouseRef = body.warehouseRef?.trim() || null;
  // comment — единственное необязательное поле из этой группы:
  // пустая строка превращается в null, а не сохраняется как есть,
  // чтобы в базе не копились строки из одних пробелов
  const comment = (body.comment || '').trim() || null;

  // Атрибуция первого визита — откуда пришёл покупатель (см.
  // lib/attribution.ts). Все семь полей необязательные и никак не
  // проверяются: это данные для аналитики, а не для логики заказа,
  // поэтому даже если фронтенд прислал что-то странное — заказ всё
  // равно должен оформиться. normalizeOptionalText превращает пустые
  // строки/undefined в null, чтобы в базе не копился "мусор"
  const utmSource = normalizeOptionalText(body.utmSource);
  const utmMedium = normalizeOptionalText(body.utmMedium);
  const utmCampaign = normalizeOptionalText(body.utmCampaign);
  const utmTerm = normalizeOptionalText(body.utmTerm);
  const utmContent = normalizeOptionalText(body.utmContent);
  const gclid = normalizeOptionalText(body.gclid);
  const referrer = normalizeOptionalText(body.referrer);

  if (!customerName) {
    return NextResponse.json({ error: "Вкажіть ваше ім'я." }, { status: 400 });
  }

  if (!customerSurname) {
    return NextResponse.json({ error: 'Вкажіть ваше прізвище.' }, { status: 400 });
  }

  if (!customerPhone || !isValidPhone(customerPhone)) {
    return NextResponse.json({ error: 'Вкажіть коректний номер телефону.' }, { status: 400 });
  }

  if (!city) {
    return NextResponse.json({ error: 'Вкажіть місто доставки.' }, { status: 400 });
  }

  if (!novaPoshtaAddress) {
    return NextResponse.json({ error: 'Вкажіть адресу відділення Нової Пошти.' }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'Кошик порожній — немає що оформлювати.' }, { status: 400 });
  }

  // Проверяем и приводим к числу count у каждой позиции ДО начала
  // транзакции — так явно некорректный запрос (не число, дробное,
  // отрицательное количество) отклоняется сразу, без лишнего похода
  // в базу
  const items: { id: string; count: number }[] = [];
  for (const rawItem of body.items) {
    const id = rawItem.id;
    const count = rawItem.count;

    if (!id || !isValidUuid(id)) {
      return NextResponse.json(
        { error: 'У кожного товару в кошику має бути коректний id.' },
        { status: 400 }
      );
    }

    if (!Number.isInteger(count) || (count as number) <= 0) {
      return NextResponse.json(
        { error: `Некоректна кількість для товару ${id}: кількість має бути цілим числом більше нуля.` },
        { status: 400 }
      );
    }

    items.push({ id, count: count as number });
  }

  // ---- сама транзакция ----
  // pool.query() каждый раз берёт СЛУЧАЙНОЕ свободное соединение из
  // пула — для набора независимых запросов это нормально, но
  // транзакция (BEGIN...COMMIT) обязана выполняться на ОДНОМ и том же
  // соединении от начала до конца. Поэтому здесь, в отличие от
  // остальных роутов проекта, соединение забирается явно через
  // pool.connect() и в конце обязательно возвращается в пул (finally
  // -> client.release())
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Актуальные данные всех товаров из корзины — одним запросом,
    // а не по одному на каждую позицию. JOIN c suppliers — чтобы сразу
    // получить название поставщика для supplier_name-снимка
    // (products.supplier_id NOT NULL, поэтому обычный JOIN, а не LEFT
    // JOIN, здесь ничего не потеряет)
    const ids = items.map((item) => item.id);
    const productsResult = await client.query<ProductSnapshotRow>(
      `
      SELECT p.id, p.article, p.brand, p.name, p.cost_price, p.retail_price, p.supplier_id, s.name AS supplier_name
      FROM products p
      JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ANY($1::uuid[])
      `,
      [ids]
    );

    const productById = new Map(productsResult.rows.map((row) => [row.id, row]));

    // Если хотя бы один товар из корзины не нашёлся в каталоге
    // (например, его успели удалить, пока покупатель оформлял заказ) —
    // откатываем транзакцию целиком и сообщаем, какого товара не хватает,
    // вместо того чтобы молча создать заказ с неполным составом
    const missingId = ids.find((id) => !productById.has(id));
    if (missingId) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Товар з id ${missingId} більше не доступний у каталозі. Оновіть кошик і спробуйте ще раз.` },
        { status: 400 }
      );
    }

    // Шаг 0.5: клиент как персистентная сущность (для личного баланса,
    // см. секцию 28 schema.sql) — находим по нормализованному телефону
    // или заводим нового. ON CONFLICT (phone) DO UPDATE, а не DO
    // NOTHING: если человек оформляет уже второй заказ под тем же
    // телефоном, но указал имя/фамилию чуть иначе (опечатка в прошлый
    // раз, или сменил фамилию) — берём самые свежие данные, это не
    // ломает историю (сами заказы всё равно хранят свой собственный
    // снимок customer_name/customer_surname, как и раньше)
    const normalizedPhone = normalizePhone(customerPhone);
    const customerResult = await client.query<{ id: string }>(
      `
      INSERT INTO customers (phone, name, surname)
      VALUES ($1, $2, $3)
      ON CONFLICT (phone) DO UPDATE SET
        name = EXCLUDED.name,
        surname = EXCLUDED.surname,
        updated_at = now()
      RETURNING id
      `,
      [normalizedPhone, customerName, customerSurname]
    );
    const customerId = customerResult.rows[0].id;

    // Шаг 1: сам заказ. Статус всегда 'new' ("Новий") — так и должно
    // быть для только что оформленного заказа с витрины, менять его
    // может только админ на экране "Заказы" (PATCH /api/orders/[id]).
    // customer_id — связь с только что найденным/созданным клиентом
    // выше (для личного баланса); customer_name/customer_phone здесь
    // остаются как и раньше, отдельным "снимком" на момент заказа
    const orderResult = await client.query<{ id: string; order_number: number }>(
      `
      INSERT INTO orders (
        customer_id, customer_name, customer_surname, customer_phone, city, nova_poshta_address, city_ref, warehouse_ref, comment, status,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, referrer
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, order_number
      `,
      [
        customerId,
        customerName,
        customerSurname,
        customerPhone,
        city,
        novaPoshtaAddress,
        cityRef,
        warehouseRef,
        comment,
        utmSource,
        utmMedium,
        utmCampaign,
        utmTerm,
        utmContent,
        gclid,
        referrer,
      ]
    );
    const orderId = orderResult.rows[0].id;
    const orderNumber = orderResult.rows[0].order_number;

    // Персональне правило ціни покупця (customer_pricing_rules, за
    // нормалізованим номером телефону) — застосовується АВТОМАТИЧНО,
    // без промокоду: якщо для цього покупця раніше призначили знижку
    // або націнку в адмінці (app/api/admin/customer-pricing-rules/route.ts),
    // вона одразу враховується в ціні кожної позиції ЩЕ ДО запису в
    // order_items — так order_items і надалі лишається чесним "знімком"
    // того, що покупець реально заплатив (той самий принцип, що й з
    // product-level discount_percent при імпорті прайсу, див.
    // lib/priceListImport.ts). Знижка й націнка — взаємовиключні: у
    // телефону одночасно може бути лише ОДНЕ правило (rule_type).
    //
    // computeCustomerPrice рахує відсоток від cost_price ("голої" ціни
    // постачальника), а НЕ від retail_price — інакше для покупця з
    // персональним правилом накрутилась би ще й звичайна націнка
    // магазину поверх його власної (див. lib/customerPricing.ts)
    const pricingRuleResult = await client.query<{ rule_type: 'discount' | 'markup'; percent: string }>(
      'SELECT rule_type, percent FROM customer_pricing_rules WHERE phone = $1',
      [normalizedPhone]
    );
    const pricingRuleRow = pricingRuleResult.rows[0];
    const pricingRule: CustomerPricingRule | null = pricingRuleRow
      ? { ruleType: pricingRuleRow.rule_type, percent: parseFloat(pricingRuleRow.percent) }
      : null;

    // Шаг 2: позиции заказа — по одной вставке на каждый товар из
    // корзины, с уже проверенными (не из тела запроса!) артикулом,
    // брендом, названием, ценой и поставщиком.
    // Заодно копим summaryLines/totalAmount — для Telegram-уведомления
    // ниже, чтобы не делать по коммиту отдельный SELECT за тем же самым
    let totalAmount = 0;
    const summaryLines: string[] = [];
    for (const item of items) {
      const product = productById.get(item.id)!;
      const unitPrice = computeCustomerPrice(parseFloat(product.cost_price), parseFloat(product.retail_price), pricingRule);

      // cost_price — снимок себестоимости НА МОМЕНТ ПРОДАЖИ (секция 28
      // schema.sql), нужен для точного расчёта валовой прибыли в
      // отчётах позже: products.cost_price к моменту отчёта может уже
      // измениться из-за нового прайса от поставщика, а этот снимок —
      // нет. Берём "голую" цену поставщика (product.cost_price), а не
      // unitPrice (это то, что реально заплатил покупатель — уже с
      // персональной скидкой/наценкой, если она есть)
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, article, brand, name, price, cost_price, quantity, supplier_id, supplier_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          orderId,
          product.id,
          product.article,
          product.brand,
          product.name,
          unitPrice,
          parseFloat(product.cost_price),
          item.count,
          product.supplier_id,
          product.supplier_name,
        ]
      );

      const lineTotal = unitPrice * item.count;
      totalAmount += lineTotal;
      summaryLines.push(`• ${product.name || product.article} ×${item.count} — ${lineTotal.toFixed(0)} грн`);
    }

    await client.query('COMMIT');

    // Telegram-сповіщення — навмисно ПІСЛЯ COMMIT (замовлення вже
    // гарантовано збережене). Обгорнуто в after() з next/server (той
    // самий прийом, що і у фоновому пошуку фото товарів,
    // app/api/products/route.ts) — БЕЗ цього виклик "void
    // sendTelegramMessage(...)" без await у serverless-функції на
    // Vercel міг встигнути НЕ завершитись: як тільки нижче йде
    // return NextResponse.json(...), Vercel має право одразу заморозити
    // виконання функції, і "підвішений" fetch() до Telegram API
    // просто обривається на півдорозі — сповіщення випадково не
    // долітає, хоча сам код ніби відпрацював без помилок. after()
    // гарантує, що ця робота довиконається вже ПІСЛЯ того, як відповідь
    // пішла покупцю, а не обривається разом із нею
    after(async () => {
      try {
        await sendTelegramMessage(
          [
            `🛒 Нове замовлення`,
            `${customerName} ${customerSurname}, ${customerPhone}`,
            `${city}, ${novaPoshtaAddress}`,
            comment ? `Коментар: ${comment}` : null,
            pricingRule
              ? pricingRule.ruleType === 'discount'
                ? `Персональна знижка: -${pricingRule.percent}%`
                : `Персональна націнка: +${pricingRule.percent}%`
              : null,
            '',
            ...summaryLines,
            '',
            `Разом: ${totalAmount.toFixed(0)} грн`,
          ]
            .filter((line) => line !== null)
            .join('\n')
        );
      } catch (error) {
        console.error('Ошибка при отправке Telegram-уведомления владельцу о заказе:', error);
      }

      // Персональне сповіщення САМОМУ ПОКУПЦЮ — тільки якщо він раніше
      // підключив Telegram-сповіщення в кабінеті (customer_telegram_links,
      // app/api/telegram/webhook/route.ts). Якщо не підключав — рядка
      // просто немає, chatId буде undefined, і сповіщення тихо не
      // надсилається (як і скрізь тут: збій/відсутність сповіщення не
      // повинні заважати оформленню замовлення)
      try {
        const chatResult = await pool.query('SELECT telegram_chat_id FROM customer_telegram_links WHERE phone = $1', [
          normalizedPhone,
        ]);
        const chatId = chatResult.rows[0]?.telegram_chat_id;
        if (chatId) {
          await sendTelegramMessageTo(
            chatId,
            [
              `Дякуємо за замовлення, ${customerName}!`,
              `Номер замовлення: №${orderNumber}`,
              '',
              ...summaryLines,
              '',
              `Разом: ${totalAmount.toFixed(0)} грн`,
              '',
              `Доставка: ${city}, ${novaPoshtaAddress}`,
              'Номер ТТН надішлемо тут одразу, як тільки відправимо посилку.',
            ].join('\n')
          );
        }
      } catch (error) {
        console.error('Ошибка при отправке личного Telegram-уведомления покупателю:', error);
      }
    });

    return NextResponse.json({ success: true, orderId, orderNumber });
  } catch (error) {
    // Откатываем всё, что успели вставить в этой транзакции — заказ
    // без позиций (или наоборот) хуже, чем полностью отсутствующий заказ
    await client.query('ROLLBACK');
    console.error('Ошибка при создании заказа:', error);
    // Подробности ошибки (в т.ч. текст из базы) — только в логи Vercel (console.error выше), покупателю — общий текст
    return NextResponse.json(
      { error: 'Сталася помилка, спробуйте пізніше' },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
