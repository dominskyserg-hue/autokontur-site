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
//     ]
//   }
//
// customerName, customerSurname, customerPhone, city, novaPoshtaAddress
// обязательны; comment — необязательное поле (пожелание по доставке)
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

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

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
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

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
  comment?: string;
  items?: OrderCreateItemInput[];
}

// Строка из products, актуальная на момент оформления заказа — то,
// что реально ляжет "снимком" в order_items
interface ProductSnapshotRow {
  id: string;
  article: string;
  brand: string | null;
  name: string | null;
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
  // comment — единственное необязательное поле из этой группы:
  // пустая строка превращается в null, а не сохраняется как есть,
  // чтобы в базе не копились строки из одних пробелов
  const comment = (body.comment || '').trim() || null;

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
      SELECT p.id, p.article, p.brand, p.name, p.retail_price, p.supplier_id, s.name AS supplier_name
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

    // Шаг 1: сам заказ. Статус всегда 'new' ("Новий") — так и должно
    // быть для только что оформленного заказа с витрины, менять его
    // может только админ на экране "Заказы" (PATCH /api/orders/[id])
    const orderResult = await client.query<{ id: string }>(
      `
      INSERT INTO orders (customer_name, customer_surname, customer_phone, city, nova_poshta_address, comment, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'new')
      RETURNING id
      `,
      [customerName, customerSurname, customerPhone, city, novaPoshtaAddress, comment]
    );
    const orderId = orderResult.rows[0].id;

    // Шаг 2: позиции заказа — по одной вставке на каждый товар из
    // корзины, с уже проверенными (не из тела запроса!) артикулом,
    // брендом, названием, ценой и поставщиком
    for (const item of items) {
      const product = productById.get(item.id)!;
      await client.query(
        `
        INSERT INTO order_items (order_id, product_id, article, brand, name, price, quantity, supplier_id, supplier_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          orderId,
          product.id,
          product.article,
          product.brand,
          product.name,
          product.retail_price,
          item.count,
          product.supplier_id,
          product.supplier_name,
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true, orderId });
  } catch (error) {
    // Откатываем всё, что успели вставить в этой транзакции — заказ
    // без позиций (или наоборот) хуже, чем полностью отсутствующий заказ
    await client.query('ROLLBACK');
    console.error('Ошибка при создании заказа:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json(
      { error: 'Не вдалося оформити замовлення: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
