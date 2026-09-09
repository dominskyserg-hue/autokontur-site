// ============================================================
// АВТОЗАГРУЗКА ПРАЙС-ЛИСТОВ ИЗ ПОЧТЫ.
//
// Идея: поставщик присылает Excel-прайс обычным письмом на почтовый
// ящик магазина (например, на Gmail) — без того, чтобы кто-то из
// админов заходил в панель и вручную нажимал "Загрузить прайс".
// Этот модуль подключается к почтовому ящику по протоколу IMAP,
// просматривает свежие письма, находит среди них те, что пришли ОТ
// уже заведённого поставщика (по адресу отправителя — см.
// suppliers.email), достаёт из письма Excel-вложение и прогоняет его
// через ту же самую логику разбора прайса, что и ручная загрузка
// (см. lib/priceListImport.ts).
//
// Используется в ДВУХ местах:
//   1. app/api/cron/import-supplier-emails/route.ts — Vercel Cron
//      вызывает по расписанию (см. vercel.json), защищено CRON_SECRET
//   2. app/api/admin/email-import/route.ts — кнопка "Проверить почту
//      сейчас" в панели администратора (components/EmailImportPanel.tsx)
//
// Требует переменные окружения EMAIL_IMAP_USER и EMAIL_IMAP_PASSWORD
// (см. .env.example) — без них функция ничего не делает и возвращает
// configured: false, чтобы админка могла вежливо объяснить, что нужно
// донастроить, а не упасть с ошибкой 500.
// ============================================================

import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import AdmZip from 'adm-zip';
import { Pool } from 'pg';
import { importPriceListForSupplier, type MappingSettings } from '@/lib/priceListImport';

// ------------------------------------------------------------
// НАСТРОЙКИ ПОДКЛЮЧЕНИЯ К ПОЧТЕ
// ------------------------------------------------------------
interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function getImapConfig(): ImapConfig | null {
  const user = process.env.EMAIL_IMAP_USER;
  const pass = process.env.EMAIL_IMAP_PASSWORD;
  // Без логина/пароля почтового ящика проверять нечего — считаем
  // автозагрузку "не настроенной", а не ошибкой (см. runEmailPriceImport)
  if (!user || !pass) return null;

  return {
    // По умолчанию — Gmail (imap.gmail.com, порт 993, TLS). Если
    // магазин когда-нибудь переедет на другую почту — достаточно
    // задать EMAIL_IMAP_HOST/EMAIL_IMAP_PORT в переменных окружения,
    // без изменений в коде
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: process.env.EMAIL_IMAP_PORT ? parseInt(process.env.EMAIL_IMAP_PORT, 10) : 993,
    secure: process.env.EMAIL_IMAP_SECURE !== 'false',
    user,
    pass,
  };
}

// Сколько дней письма проверяем при каждом запуске. Не "с последней
// проверки" — вместо этого каждый раз просто пересматриваем свежее
// окно, а от повторной обработки одного и того же письма защищает
// email_import_log.message_id (UNIQUE, см. schema.sql). Так надёжнее:
// даже если один запуск cron сорвался или мы что-то пропустили, письмо
// не потеряется навсегда, а будет замечено на следующей проверке
const LOOKBACK_DAYS = 5;

// Сколько последних писем от ОДНОГО поставщика проверять за раз —
// поставщик обычно шлёт прайс не чаще раза в день, этого с запасом
// хватает. Ограничение нужно, чтобы serverless-функция уложилась в
// таймаут (см. maxDuration в app/api/cron/import-supplier-emails/route.ts)
const MAX_MESSAGES_PER_SUPPLIER = 5;

// ------------------------------------------------------------
// СОПОСТАВЛЕНИЕ ПИСЕМ С ПОСТАВЩИКАМИ
// ------------------------------------------------------------
interface SupplierMatch {
  id: string;
  name: string;
  currency: string;
  mapping: MappingSettings;
}

// Поставщик может указать сразу несколько адресов через запятую —
// форма на экране "Поставщики" это не запрещает (обычное текстовое
// поле), поэтому на всякий случай разбиваем строку и заводим на КАЖДЫЙ
// адрес отдельную запись в карте соответствий
async function loadSupplierMatchers(pool: Pool): Promise<Map<string, SupplierMatch>> {
  const result = await pool.query(`
    SELECT
      s.id, s.name, s.email, s.currency,
      m.article_column, m.brand_column, m.name_column, m.price_column, m.stock_column,
      m.car_make_column, m.car_model_column, m.car_year_column, m.engine_volume_column, m.image_column,
      m.start_row, m.markup_percent
    FROM suppliers s
    JOIN supplier_excel_mappings m ON m.supplier_id = s.id
    WHERE s.email_auto_import_enabled = true
      AND s.is_active = true
      AND s.email IS NOT NULL
      AND s.email <> ''
  `);

  const byAddress = new Map<string, SupplierMatch>();

  for (const row of result.rows) {
    const match: SupplierMatch = {
      id: row.id,
      name: row.name,
      currency: row.currency,
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
    };

    const addresses = String(row.email)
      .split(/[,;]/)
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean);

    for (const address of addresses) {
      byAddress.set(address, match);
    }
  }

  return byAddress;
}

// ------------------------------------------------------------
// ЖУРНАЛ ОБРАБОТАННЫХ ПИСЕМ (email_import_log)
// ------------------------------------------------------------
export type EmailImportStatus = 'imported' | 'error' | 'unmatched' | 'skipped';

export interface EmailImportLogEntry {
  messageId: string;
  supplierId: string | null;
  supplierName: string | null;
  fromAddress: string;
  subject: string | null;
  status: EmailImportStatus;
  addedCount: number;
  updatedCount: number;
  errorMessage: string | null;
  receivedAt: Date | null;
}

async function alreadyProcessed(pool: Pool, messageId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM email_import_log WHERE message_id = $1', [messageId]);
  return result.rows.length > 0;
}

// ON CONFLICT DO NOTHING — на случай, если ручная кнопка "Проверить
// сейчас" и плановый cron случайно пересекутся по времени и оба
// попробуют обработать одно и то же новое письмо
async function writeLogEntry(pool: Pool, entry: EmailImportLogEntry): Promise<void> {
  await pool.query(
    `
    INSERT INTO email_import_log
      (message_id, supplier_id, supplier_name, from_address, subject, status, added_count, updated_count, error_message, received_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (message_id) DO NOTHING
    `,
    [
      entry.messageId,
      entry.supplierId,
      entry.supplierName,
      entry.fromAddress,
      entry.subject,
      entry.status,
      entry.addedCount,
      entry.updatedCount,
      entry.errorMessage,
      entry.receivedAt,
    ]
  );
}

// ------------------------------------------------------------
// ПОИСК EXCEL-ВЛОЖЕНИЯ В ПИСЬМЕ
// ------------------------------------------------------------
const EXCEL_EXTENSION_PATTERN = /\.(xlsx|xls)$/i;
const ZIP_EXTENSION_PATTERN = /\.zip$/i;

// Достаёт первый файл .xlsx/.xls из ZIP-архива — некоторые поставщики
// (например, CARDON) присылают прайс не отдельным Excel-файлом, а
// запакованным в .zip. AdmZip.getEntries() читает архив ЦЕЛИКОМ ИЗ
// ПАМЯТИ (буфер вложения), а entry.getData() достаёт содержимое
// конкретного файла — тоже в памяти, на диск ничего не пишется. Это
// важно: у adm-zip есть известная уязвимость именно в методах
// извлечения НА ДИСК (extractAllTo/extractEntryTo, следуют symlink
// в целевой папке) — здесь эти методы вообще не используются
function extractExcelFromZip(zipBuffer: Buffer): Buffer | null {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    // Файл с расширением .zip, но битый/не архив вовсе — не поднимаем
    // ошибку выше, просто считаем, что Excel-файла тут нет
    return null;
  }

  const entry = zip
    .getEntries()
    .find((item) => !item.isDirectory && EXCEL_EXTENSION_PATTERN.test(item.entryName));

  return entry ? entry.getData() : null;
}

async function extractExcelAttachment(rawMessage: Buffer): Promise<Buffer | null> {
  const parsed = await simpleParser(rawMessage);

  const directAttachment = parsed.attachments.find((item) => EXCEL_EXTENSION_PATTERN.test(item.filename || ''));
  if (directAttachment) return directAttachment.content;

  // Прямого .xlsx/.xls нет — ищем среди .zip-вложений (проверяем ВСЕ,
  // не только первое: в письме может быть несколько архивов, и не
  // в каждом обязательно есть Excel-файл)
  const zipAttachments = parsed.attachments.filter((item) => ZIP_EXTENSION_PATTERN.test(item.filename || ''));
  for (const zipAttachment of zipAttachments) {
    const excelBuffer = extractExcelFromZip(zipAttachment.content);
    if (excelBuffer) return excelBuffer;
  }

  return null;
}

// ------------------------------------------------------------
// ИТОГ ОДНОЙ ПРОВЕРКИ ПОЧТЫ
// ------------------------------------------------------------
export interface EmailImportSummary {
  configured: boolean;
  error?: string;
  checked: number;
  imported: number;
  skipped: number;
  unmatched: number;
  failed: number;
  entries: EmailImportLogEntry[];
}

const EMPTY_SUMMARY_BASE = { checked: 0, imported: 0, skipped: 0, unmatched: 0, failed: 0, entries: [] };

// ------------------------------------------------------------
// ГЛАВНАЯ ФУНКЦИЯ
// ------------------------------------------------------------
export async function runEmailPriceImport(pool: Pool): Promise<EmailImportSummary> {
  const config = getImapConfig();
  if (!config) {
    return {
      configured: false,
      error:
        'Не заданы EMAIL_IMAP_USER и EMAIL_IMAP_PASSWORD в переменных окружения — автозагрузка по email выключена.',
      ...EMPTY_SUMMARY_BASE,
    };
  }

  const supplierMatchers = await loadSupplierMatchers(pool);
  if (supplierMatchers.size === 0) {
    return {
      configured: true,
      error:
        'Нет ни одного активного поставщика с заполненным email и настроенным маппингом Excel — проверять почту не для кого.',
      ...EMPTY_SUMMARY_BASE,
    };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const entries: EmailImportLogEntry[] = [];
  let checked = 0;

  try {
    await client.connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      configured: true,
      error: `Не удалось подключиться к почте (${config.host}:${config.port}): ${message}`,
      ...EMPTY_SUMMARY_BASE,
    };
  }

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

      // Ищем письма ОТДЕЛЬНО по каждому адресу поставщика (обычный IMAP
      // SEARCH FROM), а не "последние N писем во входящих подряд". На
      // загруженном ящике, где вперемешку идут заказы покупателей,
      // системные уведомления и письма от десятков поставщиков, простой
      // просмотр последних N писем мог вообще не долететь до письма с
      // прайсом нужного поставщика — так и оказалось на практике: за
      // одну проверку "последних 20 писем" ни одно письмо с прайсом не
      // попало в выборку, хотя они были в ящике. Поиск по конкретному
      // отправителю быстрый и не зависит от того, сколько постороннего
      // трафика идёт в тот же ящик
      for (const [address, supplier] of supplierMatchers) {
        const uids = await client.search({ from: address, since }, { uid: true });
        if (!uids || uids.length === 0) continue;

        // Самые свежие письма ЭТОГО поставщика — в конце списка (search
        // возвращает по возрастанию UID)
        const candidateUids = uids.slice(-MAX_MESSAGES_PER_SUPPLIER);

        // ВАЖНО: сначала получаем конверты ВСЕХ писем целиком через
        // fetchAll (а не потоковый for-await над fetch()), и только
        // потом, уже вне открытой команды FETCH, скачиваем вложения
        // (client.download внутри processMessage). IMAP не умеет
        // выполнять две команды одновременно на одном соединении —
        // если вызвать download() прямо внутри цикла по fetch(), не
        // дождавшись его завершения, соединение зависает намертво
        // (именно так и было при первой попытке: запрос "Проверить
        // почту сейчас" не завершался вообще)
        const messages = await client.fetchAll(candidateUids, { envelope: true, uid: true }, { uid: true });
        checked += messages.length;

        for (const message of messages) {
          const entry = await processMessage(pool, client, message, supplier);
          if (entry) entries.push(entry);
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return {
      configured: true,
      error: `Ошибка при чтении почты: ${message}`,
      checked,
      imported: entries.filter((e) => e.status === 'imported').length,
      skipped: entries.filter((e) => e.status === 'skipped').length,
      unmatched: entries.filter((e) => e.status === 'unmatched').length,
      failed: entries.filter((e) => e.status === 'error').length,
      entries,
    };
  } finally {
    await client.logout().catch(() => {
      // Соединение могло уже разорваться само — логаут "на прощание"
      // не критичен, если он не удался, работу это не портит
    });
  }

  return {
    configured: true,
    checked,
    imported: entries.filter((e) => e.status === 'imported').length,
    skipped: entries.filter((e) => e.status === 'skipped').length,
    unmatched: entries.filter((e) => e.status === 'unmatched').length,
    failed: entries.filter((e) => e.status === 'error').length,
    entries,
  };
}

// Обрабатывает ОДНО письмо УЖЕ ИЗВЕСТНОГО поставщика (мы нашли его
// через SEARCH FROM <адрес поставщика> — см. runEmailPriceImport выше,
// поэтому сопоставление здесь заново не требуется). При необходимости
// скачивает вложение и импортирует прайс. Возвращает null, если письмо
// уже было обработано раньше (тогда журнал трогать не нужно — запись
// там уже есть)
async function processMessage(
  pool: Pool,
  client: ImapFlow,
  message: FetchMessageObject,
  supplier: SupplierMatch
): Promise<EmailImportLogEntry | null> {
  const envelope = message.envelope;
  // У писем без заголовка Message-ID (редкость, но встречается у
  // некоторых корпоративных рассылок) собираем свой стабильный
  // идентификатор из UID и ящика — иначе message_id окажется NULL,
  // а колонка в базе NOT NULL UNIQUE
  const messageId = envelope?.messageId || `<uid-${message.uid}@${client.host}>`;

  if (await alreadyProcessed(pool, messageId)) {
    return null;
  }

  const fromAddress = envelope?.from?.[0]?.address?.toLowerCase() || '';
  const subject = envelope?.subject || null;
  // envelope.date иногда приходит строкой, а не объектом Date —
  // приводим к единому виду перед тем, как передать в pg (колонка
  // TIMESTAMPTZ ожидает Date, а не произвольную строку)
  const receivedAt = envelope?.date ? new Date(envelope.date) : null;

  // Отправитель совпал с поставщиком — скачиваем письмо целиком
  // (заголовки + тело + вложения) и ищем в нём Excel-файл
  const download = await client.download(message.uid, undefined, { uid: true });
  const chunks: Buffer[] = [];
  for await (const chunk of download.content) {
    chunks.push(chunk as Buffer);
  }
  const rawMessage = Buffer.concat(chunks);

  const attachment = await extractExcelAttachment(rawMessage);

  if (!attachment) {
    const entry: EmailImportLogEntry = {
      messageId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      fromAddress,
      subject,
      status: 'skipped',
      addedCount: 0,
      updatedCount: 0,
      errorMessage: null,
      receivedAt,
    };
    await writeLogEntry(pool, entry);
    return entry;
  }

  try {
    const { addedCount, updatedCount } = await importPriceListForSupplier(
      pool,
      supplier.id,
      supplier.currency,
      supplier.mapping,
      attachment
    );

    const entry: EmailImportLogEntry = {
      messageId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      fromAddress,
      subject,
      status: 'imported',
      addedCount,
      updatedCount,
      errorMessage: null,
      receivedAt,
    };
    await writeLogEntry(pool, entry);
    return entry;
  } catch (error) {
    const message2 = error instanceof Error ? error.message : 'Неизвестная ошибка';
    const entry: EmailImportLogEntry = {
      messageId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      fromAddress,
      subject,
      status: 'error',
      addedCount: 0,
      updatedCount: 0,
      errorMessage: message2,
      receivedAt,
    };
    await writeLogEntry(pool, entry);
    return entry;
  }
}
