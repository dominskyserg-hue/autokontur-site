// ============================================================
// АВТОЗАГРУЗКА ПРАЙС-ЛИСТОВ ПО ПРЯМОЙ ССЫЛКЕ (URL).
//
// Альтернатива автозагрузке из почты (см. lib/emailPriceImport.ts) —
// для поставщиков, которые просто держат актуальный Excel-прайс по
// одному и тому же адресу (например, http://postavshik.com/price.xls)
// и сами перезаписывают файл по этому адресу, когда меняются цены.
// Здесь ничего разбирать в письме не нужно — просто скачиваем файл по
// ссылке из suppliers.price_url и прогоняем через ту же самую логику
// разбора прайса, что и ручная загрузка и почтовая автозагрузка (см.
// lib/priceListImport.ts).
//
// Используется в ДВУХ местах:
//   1. app/api/cron/import-supplier-urls/route.ts — Vercel Cron
//      вызывает по расписанию (см. vercel.json), защищено CRON_SECRET
//   2. app/api/admin/url-import/route.ts — кнопка "Проверить сейчас" в
//      панели администратора (components/UrlImportPanel.tsx)
// ============================================================

import { Pool } from 'pg';
import { importPriceListForSupplier, type MappingSettings } from '@/lib/priceListImport';

// ------------------------------------------------------------
// ЖУРНАЛ ПОПЫТОК (url_import_log)
// ------------------------------------------------------------
export type UrlImportStatus = 'imported' | 'error';

export interface UrlImportLogEntry {
  supplierId: string;
  supplierName: string;
  priceUrl: string;
  status: UrlImportStatus;
  addedCount: number;
  updatedCount: number;
  errorMessage: string | null;
  processedAt: string;
}

async function writeLogEntry(
  pool: Pool,
  entry: Omit<UrlImportLogEntry, 'processedAt'>
): Promise<void> {
  await pool.query(
    `
    INSERT INTO url_import_log
      (supplier_id, supplier_name, price_url, status, added_count, updated_count, error_message)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      entry.supplierId,
      entry.supplierName,
      entry.priceUrl,
      entry.status,
      entry.addedCount,
      entry.updatedCount,
      entry.errorMessage,
    ]
  );
}

// ------------------------------------------------------------
// ОЧИСТКА СТАРЫХ ЗАПИСЕЙ ЖУРНАЛА
// ------------------------------------------------------------
// Та же логика и тот же срок хранения, что и у email_import_log (см.
// lib/emailPriceImport.ts) — журнал нужен для панели в админке, а не
// как вечный архив
const LOG_RETENTION_DAYS = 15;

async function cleanupOldLogEntries(pool: Pool): Promise<void> {
  try {
    await pool.query(`DELETE FROM url_import_log WHERE processed_at < now() - $1::interval`, [
      `${LOG_RETENTION_DAYS} days`,
    ]);
  } catch (error) {
    // Проверку ссылок из-за сбоя очистки журнала прерывать не стоит —
    // это вспомогательная уборка, а не часть самой автозагрузки
    console.error('Ошибка при очистке старых записей журнала автозагрузки по URL:', error);
  }
}

// ------------------------------------------------------------
// ПОСТАВЩИКИ С НАСТРОЕННОЙ ССЫЛКОЙ НА ПРАЙС
// ------------------------------------------------------------
interface SupplierWithPriceUrl {
  id: string;
  name: string;
  currency: string;
  priceUrl: string;
  mapping: MappingSettings;
}

async function loadSuppliersWithPriceUrl(pool: Pool): Promise<SupplierWithPriceUrl[]> {
  const result = await pool.query(`
    SELECT
      s.id, s.name, s.currency, s.price_url,
      m.article_column, m.brand_column, m.name_column, m.price_column, m.stock_column,
      m.car_make_column, m.car_model_column, m.car_year_column, m.engine_volume_column, m.image_column,
      m.start_row, m.markup_percent
    FROM suppliers s
    JOIN supplier_excel_mappings m ON m.supplier_id = s.id
    WHERE s.is_active = true
      AND s.price_url IS NOT NULL
      AND s.price_url <> ''
  `);

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency,
    priceUrl: row.price_url,
    mapping: {
      article: row.article_column,
      brand: row.brand_column || '',
      name: row.name_column || '',
      price: row.price_column,
      stock: row.stock_column || '',
      carMake: row.car_make_column || undefined,
      carModel: row.car_model_column || undefined,
      carYear: row.car_year_column || undefined,
      engineVolume: row.engine_volume_column || undefined,
      image: row.image_column || undefined,
      startRow: row.start_row,
      markup: parseFloat(row.markup_percent),
    },
  }));
}

// ------------------------------------------------------------
// СКАЧИВАНИЕ ФАЙЛА ПО ССЫЛКЕ
// ------------------------------------------------------------
// Некоторые серверы поставщиков отдают 403/пустой ответ без заголовка
// User-Agent (принимают только запросы "от браузера") — подставляем
// обычный браузерный UA, чтобы не упираться в это на ровном месте
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Ссылка на прайс может протухнуть/зависнуть — не даём одному
// медленному поставщику съесть весь maxDuration cron-роута
const FETCH_TIMEOUT_MS = 20_000;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

async function downloadPriceFile(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': FETCH_USER_AGENT },
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    throw new Error(`Не удалось скачать файл по ссылке: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Сервер поставщика ответил ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
    throw new Error('Файл по ссылке слишком большой (больше 10 МБ).');
  }
  if (arrayBuffer.byteLength === 0) {
    throw new Error('По ссылке пришёл пустой файл.');
  }

  return Buffer.from(arrayBuffer);
}

// ------------------------------------------------------------
// ИТОГ ОДНОЙ ПРОВЕРКИ
// ------------------------------------------------------------
export interface UrlImportSummary {
  checked: number;
  imported: number;
  failed: number;
  entries: UrlImportLogEntry[];
}

// ------------------------------------------------------------
// ГЛАВНАЯ ФУНКЦИЯ
// ------------------------------------------------------------
export async function runUrlPriceImport(pool: Pool): Promise<UrlImportSummary> {
  await cleanupOldLogEntries(pool);

  const suppliers = await loadSuppliersWithPriceUrl(pool);
  const entries: UrlImportLogEntry[] = [];

  for (const supplier of suppliers) {
    const processedAt = new Date().toISOString();
    try {
      const buffer = await downloadPriceFile(supplier.priceUrl);
      const { addedCount, updatedCount } = await importPriceListForSupplier(
        pool,
        supplier.id,
        supplier.currency,
        supplier.mapping,
        buffer
      );

      const entry: UrlImportLogEntry = {
        supplierId: supplier.id,
        supplierName: supplier.name,
        priceUrl: supplier.priceUrl,
        status: 'imported',
        addedCount,
        updatedCount,
        errorMessage: null,
        processedAt,
      };
      await writeLogEntry(pool, entry);
      entries.push(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      const entry: UrlImportLogEntry = {
        supplierId: supplier.id,
        supplierName: supplier.name,
        priceUrl: supplier.priceUrl,
        status: 'error',
        addedCount: 0,
        updatedCount: 0,
        errorMessage: message,
        processedAt,
      };
      await writeLogEntry(pool, entry);
      entries.push(entry);
    }
  }

  return {
    checked: entries.length,
    imported: entries.filter((e) => e.status === 'imported').length,
    failed: entries.filter((e) => e.status === 'error').length,
    entries,
  };
}
