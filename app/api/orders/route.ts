// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/orders
//
// Отдаёт список заказов для экрана "Заказы" (управление заказами
// клиентов). Как и товаров, заказов со временем может накопиться
// много — поэтому здесь тоже пагинация, а не выдача всех разом.
//
//   GET /api/orders?page=1&pageSize=20&status=processing&search=0501234567
//
//   page      — номер страницы, начиная с 1 (по умолчанию 1)
//   pageSize  — сколько заказов на странице (по умолчанию 20,
//               максимум 100)
//   status    — один из статусов заказа (см. STATUS_VALUES ниже);
//               если не передан — показываются заказы всех статусов
//   search    — ищет совпадение по имени клиента, фамилии ИЛИ по
//               телефону (регистронезависимо, по подстроке)
//   dateFrom  — YYYY-MM-DD: заказы, созданные в этот день или позже
//   dateTo    — YYYY-MM-DD: заказы, созданные в этот день или раньше
//               (день считается по киевскому времени)
//   unpaid    — "1": только заказы, оплаченные не полностью (без
//               отменённых — там платить уже нечего)
//   manager   — кто ведёт заказ: "me" (мои), "none" (без менеджера) или
//               UUID конкретного менеджера. Действует и на счётчики
//   withCounts — "1": дополнительно вернуть counts — сколько заказов
//               в каждом статусе и сколько неоплаченных (с учётом
//               поиска и дат, но БЕЗ фильтра по статусу) — для кнопок
//               быстрых фильтров над списком (components/OrdersScreen.tsx)
//
// Сумма заказа и количество позиций в нём — НЕ отдельные колонки в
// таблице orders, а считаются "на лету" агрегатными функциями
// SUM/COUNT по таблице order_items (LEFT JOIN — чтобы заказ без
// единой позиции тоже попал в список, просто с суммой 0)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getCurrentAdmin } from '@/lib/adminAuth';
import { ensureOrderAssignmentColumns } from '@/lib/orderAssignment';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
// Тот же приём, что и в остальных роутах — общий Pool в globalThis,
// чтобы все файлы использовали одно и то же подключение
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
// СТАТУСЫ ЗАКАЗА
// ------------------------------------------------------------
// Ровно тот же набор значений, что и в CHECK-ограничении колонки
// orders.status в schema.sql — если когда-нибудь понадобится новый
// статус, менять нужно СРАЗУ в двух местах: там и здесь
const STATUS_VALUES = [
  'new',
  'processing',
  'ordered_from_supplier',
  'in_stock',
  'ready_for_pickup',
  'shipped',
  'cancelled',
] as const;
type OrderStatus = (typeof STATUS_VALUES)[number];

function isValidStatus(value: string): value is OrderStatus {
  return (STATUS_VALUES as readonly string[]).includes(value);
}

// ------------------------------------------------------------
// ПАГИНАЦИЯ — значения по умолчанию и ограничения
// ------------------------------------------------------------
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Оплаченная сумма заказа — отдельным коррелированным подзапросом, а
// не через JOIN с cash_movements: JOIN вместе с уже имеющимся JOIN
// order_items размножил бы строки (одна на каждую пару позиция×движение
// кассы) и испортил бы SUM(). Вынесено в константу, потому что нужно
// в трёх местах: в списке, в фильтре "Не оплачены" и в счётчике
const PAID_AMOUNT_SQL = `COALESCE(
  (SELECT SUM(cm.amount) FROM cash_movements cm
   WHERE cm.order_id = o.id AND cm.type IN ('customer_payment', 'customer_prepayment', 'customer_refund')),
  0
)`;

// Сумма заказа — тоже в трёх местах, поэтому тоже константа
const ORDER_TOTAL_SQL = `COALESCE((SELECT SUM(oi2.price * oi2.quantity) FROM order_items oi2 WHERE oi2.order_id = o.id), 0)`;

// Один заказ в списке — БЕЗ состава товаров (полный состав отдаётся
// только для одного конкретного заказа через GET /api/orders/[id])
interface OrderListItem {
  id: string;
  // Человекочитаемый номер заказа (1, 2, 3...) — см. lib/orderUi.ts
  orderNumber: number;
  customerName: string;
  customerSurname: string;
  customerPhone: string;
  status: OrderStatus;
  itemsCount: number;
  totalAmount: number;
  createdAt: string;
  updatedAt: string;
  // Сколько реально поступило деньгами по этому заказу — для бейджа
  // оплаты рядом со статусом отгрузки (components/PaymentBadge.tsx),
  // тот же расчёт, что и в GET /api/orders/[id]
  paidAmount: number;
  // Кто ведёт заказ; null — заказ ничей
  assignedManager: { id: string; name: string } | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  // Вторая проверка входа (кроме middleware.ts): сессия админа в базе
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Потрібна авторизація.' }, { status: 401 });
  }

  try {
    await ensureOrderAssignmentColumns();
    const searchParams = request.nextUrl.searchParams;

    // ---- пагинация ----
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

    const rawPageSize = parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10);
    const pageSize =
      Number.isFinite(rawPageSize) && rawPageSize > 0
        ? Math.min(rawPageSize, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;

    const offset = (page - 1) * pageSize;

    // ---- фильтры ----
    const statusFilter = (searchParams.get('status') || '').trim();
    const search = (searchParams.get('search') || '').trim();
    const dateFrom = (searchParams.get('dateFrom') || '').trim();
    const dateTo = (searchParams.get('dateTo') || '').trim();
    const unpaidOnly = searchParams.get('unpaid') === '1';
    const withCounts = searchParams.get('withCounts') === '1';
    const managerFilter = (searchParams.get('manager') || '').trim();

    if ((dateFrom && !DATE_PATTERN.test(dateFrom)) || (dateTo && !DATE_PATTERN.test(dateTo))) {
      return NextResponse.json({ error: 'Дата должна быть в формате ГГГГ-ММ-ДД.' }, { status: 400 });
    }

    if (statusFilter && !isValidStatus(statusFilter)) {
      return NextResponse.json(
        { error: `Статус должен быть одним из: ${STATUS_VALUES.join(', ')}.` },
        { status: 400 }
      );
    }

    // ---- собираем WHERE-условие и параметры динамически ----
    // Сначала общие условия (поиск и даты) — они же нужны счётчикам
    // быстрых фильтров. Статус и "Не оплачены" добавляем после, только
    // для самого списка
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (search) {
      // Один и тот же текст ищем в имени, фамилии и телефоне — так поле
      // поиска может быть одно, а не три разных на фронтенде
      values.push(`%${search}%`);
      conditions.push(
        `(o.customer_name ILIKE $${values.length} OR o.customer_surname ILIKE $${values.length} OR o.customer_phone ILIKE $${values.length})`
      );
    }

    // День заказа считаем по киевскому времени — иначе заказ, сделанный
    // в 01:00 ночи, по UTC попал бы во вчерашний день
    if (dateFrom) {
      values.push(dateFrom);
      conditions.push(`(o.created_at AT TIME ZONE 'Europe/Kyiv')::date >= $${values.length}::date`);
    }
    if (dateTo) {
      values.push(dateTo);
      conditions.push(`(o.created_at AT TIME ZONE 'Europe/Kyiv')::date <= $${values.length}::date`);
    }

    // Фильтр по ответственному менеджеру — тоже общий (влияет и на счётчики)
    if (managerFilter === 'none') {
      conditions.push('o.assigned_manager_id IS NULL');
    } else if (managerFilter === 'me') {
      // Сессия без личного пользователя (старый вход по общему паролю) —
      // "моих" заказов у неё нет
      values.push(admin.id);
      conditions.push(`o.assigned_manager_id = $${values.length}::uuid`);
    } else if (managerFilter) {
      if (!UUID_PATTERN.test(managerFilter)) {
        return NextResponse.json({ error: 'manager должен быть me, none или UUID менеджера.' }, { status: 400 });
      }
      values.push(managerFilter);
      conditions.push(`o.assigned_manager_id = $${values.length}::uuid`);
    }

    // Копия общих условий и параметров — для счётчиков (без статуса)
    const commonConditions = [...conditions];
    const commonValues = [...values];

    if (statusFilter) {
      values.push(statusFilter);
      conditions.push(`o.status = $${values.length}`);
    }

    if (unpaidOnly) {
      conditions.push(`o.status <> 'cancelled' AND ${PAID_AMOUNT_SQL} < ${ORDER_TOTAL_SQL}`);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    values.push(pageSize, offset);
    const limitPlaceholder = `$${values.length - 1}`;
    const offsetPlaceholder = `$${values.length}`;

    // ---- сам запрос ----
    // GROUP BY o.id достаточно (не нужно перечислять все колонки
    // orders в GROUP BY) — Postgres знает, что id первичный ключ,
    // и остальные колонки таблицы от него функционально зависят.
    // COUNT(*) OVER() здесь считает количество ГРУПП (то есть заказов)
    // после WHERE, но ДО LIMIT/OFFSET — то, что и нужно для пагинации
    const result = await pool.query(
      `
      SELECT
        o.id,
        o.order_number,
        o.customer_name,
        o.customer_surname,
        o.customer_phone,
        o.status,
        o.created_at,
        o.updated_at,
        COUNT(oi.id) AS items_count,
        COALESCE(SUM(oi.price * oi.quantity), 0) AS total_amount,
        ${PAID_AMOUNT_SQL} AS paid_amount,
        o.assigned_manager_id,
        am.name AS assigned_manager_name,
        COUNT(*) OVER() AS total_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN admin_users am ON am.id = o.assigned_manager_id
      ${whereSql}
      GROUP BY o.id, am.id
      ORDER BY o.created_at DESC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `,
      values
    );

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;

    const orders: OrderListItem[] = result.rows.map((row) => ({
      id: row.id,
      // order_number — колонка INTEGER, драйвер pg возвращает такие
      // значения обычным числом (не строкой, в отличие от NUMERIC) —
      // parseFloat/parseInt тут не нужен
      orderNumber: row.order_number,
      customerName: row.customer_name,
      customerSurname: row.customer_surname,
      customerPhone: row.customer_phone,
      status: row.status,
      itemsCount: parseInt(row.items_count, 10),
      // total_amount — результат SUM() по колонке NUMERIC, драйвер pg
      // возвращает такие значения строкой, явно переводим в число
      totalAmount: parseFloat(row.total_amount),
      paidAmount: parseFloat(row.paid_amount),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedManager: row.assigned_manager_id
        ? { id: row.assigned_manager_id, name: row.assigned_manager_name }
        : null,
    }));

    // ---- счётчики для кнопок быстрых фильтров ----
    let counts: { byStatus: Record<string, number>; unpaid: number; all: number } | undefined;
    if (withCounts) {
      const commonWhere = commonConditions.length > 0 ? `WHERE ${commonConditions.join(' AND ')}` : '';
      const countsResult = await pool.query(
        `
        SELECT
          o.status,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE o.status <> 'cancelled' AND ${PAID_AMOUNT_SQL} < ${ORDER_TOTAL_SQL})::int AS unpaid
        FROM orders o
        ${commonWhere}
        GROUP BY o.status
        `,
        commonValues
      );

      const byStatus: Record<string, number> = {};
      let unpaid = 0;
      let all = 0;
      for (const row of countsResult.rows) {
        byStatus[row.status] = row.total;
        unpaid += row.unpaid;
        all += row.total;
      }
      counts = { byStatus, unpaid, all };
    }

    return NextResponse.json({
      success: true,
      orders,
      pagination: { page, pageSize, totalCount, totalPages },
      ...(counts ? { counts } : {}),
    });
  } catch (error) {
    console.error('Ошибка при получении списка заказов:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить список заказов: ' + message },
      { status: 500 }
    );
  }
}
