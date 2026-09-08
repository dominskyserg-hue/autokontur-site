// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес запроса: POST /api/suppliers/parse-excel
//
// Что делает этот файл, по шагам:
//   1. Принимает Excel-файл поставщика, ID поставщика и настройки
//      маппинга колонок через multipart/form-data (FormData).
//   2. Проверяет валюту/курс поставщика и его правила наценки.
//   3. Разбирает файл и сохраняет товары в PostgreSQL — вся эта
//      логика теперь живёт в lib/priceListImport.ts (см. там), и её
//      же использует автозагрузка прайсов по email
//      (lib/emailPriceImport.ts) — здесь только приём HTTP-запроса
//      и вызов общей функции.
//   4. Возвращает { success: true, addedCount, updatedCount }.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { importPriceListForSupplier, type MappingSettings } from '@/lib/priceListImport';

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
    // Serverless: кожен файл створює СВІЙ Pool (кеш через globalThis
    // працює тільки в dev — див. умову NODE_ENV нижче), тому тримаємо
    // ліміт з'єднань НА ОДИН інстанс низьким. Без цього ліміту сума
    // з'єднань з усіх функцій одного разу вичерпала ліміт Supabase
    // і поклала весь прод ("Application error" на кількох сторінках)
    max: 3,
  });

globalThis.pgPool = pool;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
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

    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой. Максимальный размер — 10 МБ.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { addedCount, updatedCount } = await importPriceListForSupplier(
      pool,
      supplierId,
      supplierCurrency,
      mapping,
      buffer
    );

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
