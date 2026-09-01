// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/site-settings
//
// Общие настройки витрины, которые показываются в шапке магазина —
// название магазина, телефон и часы работы. Таблица site_settings —
// "синглтон": в ней всегда РОВНО одна строка с id = 1 (это гарантирует
// CHECK-ограничение в schema.sql), поэтому здесь не нужен ни id в
// запросе, ни выбор "какую запись редактируем" — она всегда одна и та же.
//
//   GET   /api/site-settings  — получить текущее название/телефон/часы работы
//   PATCH /api/site-settings  — изменить любое из этих полей
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

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

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

interface PatchSiteSettingsBody {
  shopName?: string;
  phone?: string;
  workingHours?: string;
}

// ------------------------------------------------------------
// GET /api/site-settings
// ------------------------------------------------------------
export async function GET() {
  try {
    const result = await pool.query(
      'SELECT shop_name, phone, working_hours, updated_at FROM site_settings WHERE id = 1'
    );

    // Строка гарантированно должна быть (schema.sql вставляет её
    // значениями по умолчанию), но на случай, если кто-то вручную
    // удалил её из базы — отдаём пустые значения, а не падаем с ошибкой
    const row = result.rows[0] || { shop_name: null, phone: null, working_hours: null, updated_at: null };

    return NextResponse.json({
      success: true,
      settings: {
        shopName: row.shop_name,
        phone: row.phone,
        workingHours: row.working_hours,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при получении настроек сайта:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить настройки сайта: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// PATCH /api/site-settings
// ------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  let body: PatchSiteSettingsBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Тело запроса должно быть корректным JSON.' },
      { status: 400 }
    );
  }

  const hasShopName = body.shopName !== undefined;
  const hasPhone = body.phone !== undefined;
  const hasWorkingHours = body.workingHours !== undefined;

  if (!hasShopName && !hasPhone && !hasWorkingHours) {
    return NextResponse.json(
      { error: 'Передайте хотя бы одно поле для изменения: shopName, phone или workingHours.' },
      { status: 400 }
    );
  }

  if (hasShopName && !body.shopName?.trim()) {
    return NextResponse.json(
      { error: 'Название магазина не может быть пустым.' },
      { status: 400 }
    );
  }

  try {
    // ON CONFLICT (id) DO UPDATE — на случай, если строки с id = 1
    // почему-то ещё нет (например, очень старая база без начальной
    // вставки из schema.sql): тогда INSERT создаст её, а не упадёт
    const result = await pool.query(
      `
      INSERT INTO site_settings (id, shop_name, phone, working_hours)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id)
      DO UPDATE SET
        shop_name = COALESCE($1, site_settings.shop_name),
        phone = COALESCE($2, site_settings.phone),
        working_hours = COALESCE($3, site_settings.working_hours),
        updated_at = now()
      RETURNING shop_name, phone, working_hours, updated_at
      `,
      [
        hasShopName ? body.shopName!.trim() : null,
        hasPhone ? body.phone : null,
        hasWorkingHours ? body.workingHours : null,
      ]
    );

    const row = result.rows[0];

    return NextResponse.json({
      success: true,
      settings: {
        shopName: row.shop_name,
        phone: row.phone,
        workingHours: row.working_hours,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Ошибка при обновлении настроек сайта:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось обновить настройки сайта: ' + message },
      { status: 500 }
    );
  }
}
