// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: GET /api/customer/orders
//
// Личный кабинет покупателя ("Мої замовлення" на витрине,
// components/CustomerDashboard.tsx). Входа по паролю на сайте нет —
// заказы оформляются просто по номеру телефона (см. app/api/orders/
// create/route.ts), поэтому и "вход в кабинет" устроен так же просто:
// покупатель вводит телефон, а этот же роут одновременно СЛУЖИТ
// проверкой входа — если заказы с таким телефоном нашлись, значит
// телефон "верный" и фронтенд показывает кабинет; если нет — фронтенд
// показывает "заказов не найдено" и остаётся на экране входа.
//
// В РЕАЛЬНОЙ системе здесь была бы SMS-верификация (код из смс,
// подтверждающий, что телефоном владеет именно тот, кто его ввёл) —
// в этом проекте её нет, это осознанное упрощение ("заглушка"),
// прямо оговорённое в задании. Именно поэтому у этой схемы есть
// настоящая, а не воображаемая уязвимость: НОМЕР ТЕЛЕФОНА тут
// фактически исполняет роль пароля, а телефоны — не секрет (их часто
// говорят вслух, передают третьим лицам и т.п.). Для интернет-магазина
// с заказами "экономкласса" (без хранения платёжных данных, паспортов
// и т.п.) это принятый компромисс простоты; для более чувствительных
// данных так делать нельзя.
//
// Что здесь РЕАЛЬНО защищено (а не просто "как бы"):
//   1. Каждый заказ отдаётся ТОЛЬКО если его customer_phone совпадает
//      с переданным телефоном — нельзя получить чужие заказы, даже
//      просто гуляя по /api/customer/orders?phone=ЛЮБОЙ-ЧУЖОЙ-НОМЕР,
//      не зная его на самом деле (см. также .../orders/[id]/route.ts —
//      там та же проверка для ОДНОГО конкретного заказа)
//   2. SQL-запрос параметризован (через $1), поэтому SQL-инъекция
//      через номер телефона невозможна
//
//   GET /api/customer/orders?phone=+380501234567
//
// Сумма и количество позиций заказа — не отдельные колонки в orders,
// а считаются "на лету" через LEFT JOIN на order_items и агрегатные
// функции SUM/COUNT — тот же приём, что и в app/api/orders/route.ts
// (админский список заказов)
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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

const STATUS_VALUES = ['new', 'processing', 'awaiting_parts', 'ready', 'cancelled'] as const;
type OrderStatus = (typeof STATUS_VALUES)[number];

// ------------------------------------------------------------
// НОРМАЛИЗАЦИЯ ТЕЛЕФОНА
// ------------------------------------------------------------
// Покупатель мог оформить заказ, введя телефон как "0501234567",
// "+380501234567" или "380 50 123 45 67" — при оформлении заказа
// (app/api/orders/create/route.ts) телефон почти не нормализуется,
// только проверяется количество цифр. Чтобы вход в кабинет находил
// заказы независимо от того, как именно был введён номер тогда и
// сейчас, сравниваем не строки целиком, а ПОСЛЕДНИЕ 9 ЦИФР — это
// и есть сам номер абонента у украинских мобильных операторов, не
// зависящий от того, приписан ли спереди код страны "380" и/или
// ведущий "0". Экспортируем эту же логику и в SQL (RIGHT(...,9)),
// и сюда — они обязаны совпадать, иначе сравнение будет неверным
const MIN_PHONE_DIGITS = 9;

function normalizePhoneTail(rawPhone: string): string {
  const digitsOnly = rawPhone.replace(/\D/g, '');
  return digitsOnly.slice(-MIN_PHONE_DIGITS);
}

function isValidPhone(rawPhone: string): boolean {
  return rawPhone.replace(/\D/g, '').length >= MIN_PHONE_DIGITS;
}

interface CustomerOrderListItem {
  id: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  createdAt: string;
}

export async function GET(request: NextRequest) {
  try {
    const rawPhone = (request.nextUrl.searchParams.get('phone') || '').trim();

    if (!rawPhone || !isValidPhone(rawPhone)) {
      return NextResponse.json(
        { error: 'Вкажіть коректний номер телефону.' },
        { status: 400 }
      );
    }

    const phoneTail = normalizePhoneTail(rawPhone);

    // RIGHT(regexp_replace(customer_phone, '\D', '', 'g'), 9) — та же
    // нормализация, что и в normalizePhoneTail() выше, но на стороне
    // Postgres: убираем из сохранённого телефона всё, кроме цифр, и
    // сравниваем последние 9 цифр с тем, что ввёл покупатель сейчас
    const result = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        o.created_at,
        COUNT(oi.id) AS items_count,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE RIGHT(regexp_replace(o.customer_phone, '\\D', '', 'g'), 9) = $1
      GROUP BY o.id
      ORDER BY o.created_at DESC
      `,
      [phoneTail]
    );

    if (result.rows.length === 0) {
      // Не различаем "такого номера вообще нет" и "у него просто нет
      // заказов" — с точки зрения покупателя оба случая означают одно
      // и то же: "войти в кабинет с этим номером нельзя"
      return NextResponse.json(
        { error: 'Замовлень з таким номером телефону не знайдено.' },
        { status: 404 }
      );
    }

    const orders: CustomerOrderListItem[] = result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      itemsCount: parseInt(row.items_count, 10),
      // total_amount — результат SUM() по колонке NUMERIC, драйвер pg
      // возвращает такие значения строкой, явно переводим в число
      totalAmount: parseFloat(row.total_amount),
      createdAt: row.created_at,
    }));

    return NextResponse.json({ success: true, orders });
  } catch (error) {
    console.error('Ошибка при получении заказов клиента:', error);
    const message = error instanceof Error ? error.message : 'Невідома помилка';
    return NextResponse.json(
      { error: 'Не вдалося отримати замовлення: ' + message },
      { status: 500 }
    );
  }
}
