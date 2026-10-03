// ============================================================
// Оплата картой на сайте через monobank (plata by mono, интернет-
// эквайринг). Документация API: https://api.monobank.ua/docs/acquiring.html
//
// Как это работает, по шагам:
//   1. Покупатель выбирает в корзине "Оплата карткою онлайн" и
//      оформляет заказ (как обычно, /api/orders/create).
//   2. Сайт просит mono создать СЧЁТ на оплату (createInvoice) и
//      отправляет покупателя на страницу оплаты mono (pageUrl).
//   3. Покупатель платит картой / Apple Pay / Google Pay на странице mono.
//   4. mono присылает на сайт ВЕБХУК (POST /api/payments/mono/webhook) со
//      статусом счёта. Мы проверяем подпись (verifyWebhookSignature),
//      и если статус "success" — один раз записываем оплату в систему
//      (applyInvoiceStatus): в раздел "Кассы и счета" (приход + комиссия
//      mono отдельным расходом), в долг клиента и в историю заказа.
//   5. Покупатель возвращается на /zamovlennia, где видит "Оплачено".
//
// Ничего не включается, пока не задана переменная окружения
// MONO_ACQUIRING_TOKEN (токен из бизнес-кабинета mono или ТЕСТОВЫЙ токен
// с https://api.monobank.ua/). MONO_API_BASE — адрес API (по умолчанию
// боевой; для тестов на своём компьютере подставляется заглушка).
//
// Подписку вебхука проверяем открытым ключом mono (/api/merchant/pubkey),
// ключ кэшируем и перезапрашиваем, если подпись перестала сходиться.
// ============================================================

import { createVerify } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { logOrderEvent, historyMoney } from '@/lib/orderHistory';
import { sendTelegramMessage } from '@/lib/telegramNotify';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
  });
globalThis.pgPool = pool;

const API_BASE = (process.env.MONO_API_BASE || 'https://api.monobank.ua').replace(/\/$/, '');

// Название кассы в "Кассах и счетах", куда попадают оплаты mono
export const MONO_REGISTER_NAME = 'monobank (еквайринг)';

// Комиссия mono с украинских карт — используется, только если mono не
// вернул точную комиссию в данных платежа (paymentInfo.fee)
const FALLBACK_FEE_RATE = 0.013;

export function isMonoPayEnabled(): boolean {
  return Boolean(process.env.MONO_ACQUIRING_TOKEN);
}

// Статусы счёта в mono (документация: Статус рахунку)
export type MonoInvoiceStatus = 'created' | 'processing' | 'hold' | 'success' | 'failure' | 'reversed' | 'expired';

// Что присылает mono в вебхуке и в ответе "Статус рахунку" (нужные поля)
export interface MonoInvoiceData {
  invoiceId: string;
  status: MonoInvoiceStatus;
  amount?: number; // копейки
  finalAmount?: number; // копейки
  reference?: string;
  failureReason?: string;
  modifiedDate?: string;
  paymentInfo?: { fee?: number; maskedPan?: string; paymentSystem?: string; paymentMethod?: string };
}

// ------------------------------------------------------------
// Таблица счетов + колонка способа оплаты в заказе (создаются сами)
// ------------------------------------------------------------
let tablesReady: Promise<void> | null = null;

export function ensureMonoTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mono_invoices (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          invoice_id TEXT NOT NULL UNIQUE,
          amount NUMERIC(12, 2) NOT NULL,
          status TEXT NOT NULL DEFAULT 'created',
          page_url TEXT,
          failure_reason TEXT,
          fee NUMERIC(12, 2),
          paid_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_mono_invoices_order_id ON mono_invoices (order_id)');
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

// ------------------------------------------------------------
// Запросы к API mono
// ------------------------------------------------------------
async function monoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.MONO_ACQUIRING_TOKEN;
  if (!token) throw new Error('Оплата карткою не налаштована (немає MONO_ACQUIRING_TOKEN).');

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Token': token,
      'X-Cms': 'autokontur-site',
      ...(init.headers || {}),
    },
    // Платёжный сервис не должен вешать оформление заказа надолго
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // не JSON — разберём ниже по статусу
  }
  if (!response.ok) {
    const detail = (data as { errText?: string; errCode?: string } | null)?.errText || text.slice(0, 200);
    throw new Error(`mono: ${response.status} ${detail}`);
  }
  return data as T;
}

export interface CreateInvoiceInput {
  orderId: string;
  orderNumber: number;
  amountUah: number;
  redirectUrl: string;
  webHookUrl: string;
  items: { name: string; quantity: number; priceUah: number; article: string }[];
}

// Создаёт счёт в mono и сохраняет его у нас. Возвращает ссылку на оплату
export async function createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; pageUrl: string }> {
  await ensureMonoTables();

  const amountKop = Math.round(input.amountUah * 100);
  const created = await monoFetch<{ invoiceId: string; pageUrl: string }>('/api/merchant/invoice/create', {
    method: 'POST',
    body: JSON.stringify({
      amount: amountKop,
      ccy: 980, // гривна
      merchantPaymInfo: {
        reference: String(input.orderNumber),
        destination: `Оплата замовлення №${input.orderNumber}`,
        // Состав заказа — покупатель видит его на странице оплаты, а mono
        // сверяет сумму (sum — в копейках за ВСЮ позицию, qty — количество)
        basketOrder: input.items.map((item) => ({
          name: item.name.slice(0, 120),
          qty: item.quantity,
          sum: Math.round(item.priceUah * item.quantity * 100),
          total: Math.round(item.priceUah * item.quantity * 100),
          unit: 'шт.',
          code: item.article.slice(0, 30),
        })),
      },
      redirectUrl: input.redirectUrl,
      webHookUrl: input.webHookUrl,
      validity: 24 * 60 * 60,
      paymentType: 'debit',
    }),
  });

  await pool.query(
    'INSERT INTO mono_invoices (order_id, invoice_id, amount, status, page_url) VALUES ($1, $2, $3, $4, $5)',
    [input.orderId, created.invoiceId, input.amountUah, 'created', created.pageUrl]
  );
  return created;
}

// Актуальный статус счёта (страховка, если вебхук не дошёл)
export async function fetchInvoiceStatus(invoiceId: string): Promise<MonoInvoiceData> {
  return monoFetch<MonoInvoiceData>(`/api/merchant/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`);
}

// ------------------------------------------------------------
// Проверка подписи вебхука (заголовок X-Sign, ECDSA + SHA-256)
// ------------------------------------------------------------
let cachedPublicKeyPem: string | null = null;

async function loadPublicKey(forceRefresh: boolean): Promise<string> {
  if (cachedPublicKeyPem && !forceRefresh) return cachedPublicKeyPem;
  const data = await monoFetch<{ key: string }>('/api/merchant/pubkey');
  // mono отдаёт PEM, закодированный в base64
  cachedPublicKeyPem = Buffer.from(data.key, 'base64').toString('utf8');
  return cachedPublicKeyPem;
}

function signatureMatches(rawBody: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

export async function verifyWebhookSignature(rawBody: string, signatureBase64: string | null): Promise<boolean> {
  if (!signatureBase64) return false;
  const key = await loadPublicKey(false);
  if (signatureMatches(rawBody, signatureBase64, key)) return true;
  // Ключ мог смениться — один раз берём свежий и проверяем снова
  const fresh = await loadPublicKey(true);
  return signatureMatches(rawBody, signatureBase64, fresh);
}

// ------------------------------------------------------------
// Применение статуса счёта: ровно один раз записывает оплату
// ------------------------------------------------------------

// Касса "monobank (еквайринг)" — создаётся при первой оплате
async function ensureMonoRegister(client: PoolClient): Promise<string> {
  const existing = await client.query('SELECT id FROM cash_registers WHERE name = $1 LIMIT 1', [MONO_REGISTER_NAME]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const created = await client.query(
    "INSERT INTO cash_registers (name, type) VALUES ($1, 'bank_account') RETURNING id",
    [MONO_REGISTER_NAME]
  );
  return created.rows[0].id;
}

export interface ApplyResult {
  paid: boolean;
  alreadyProcessed: boolean;
}

export async function applyInvoiceStatus(data: MonoInvoiceData): Promise<ApplyResult> {
  await ensureMonoTables();

  // Не успешный статус: просто обновляем (success не затираем неуспехом —
  // вебхуки могут приходить не по порядку)
  if (data.status !== 'success') {
    await pool.query(
      `UPDATE mono_invoices
       SET status = $2, failure_reason = COALESCE($3, failure_reason), updated_at = now()
       WHERE invoice_id = $1 AND paid_at IS NULL`,
      [data.invoiceId, data.status, data.failureReason ?? null]
    );
    return { paid: false, alreadyProcessed: false };
  }

  const client = await pool.connect();
  let orderId = '';
  let amountPaid = 0;
  let feeUah = 0;
  let orderNumber: number | null = null;
  try {
    await client.query('BEGIN');

    // paid_at IS NULL + RETURNING — защита от повторной обработки: mono
    // присылает вебхук до 3 раз, а покупатель ещё и обновляет страницу
    const claimed = await client.query(
      `UPDATE mono_invoices
       SET status = 'success', paid_at = now(), updated_at = now()
       WHERE invoice_id = $1 AND paid_at IS NULL
       RETURNING order_id, amount`,
      [data.invoiceId]
    );
    if (claimed.rows.length === 0) {
      await client.query('ROLLBACK');
      return { paid: true, alreadyProcessed: true };
    }
    orderId = claimed.rows[0].order_id;
    // Сумма — по данным mono (finalAmount/amount, копейки), а если их нет — по нашему счёту
    amountPaid = data.finalAmount || data.amount ? (data.finalAmount ?? data.amount ?? 0) / 100 : parseFloat(claimed.rows[0].amount);
    feeUah = typeof data.paymentInfo?.fee === 'number' ? data.paymentInfo.fee / 100 : Math.round(amountPaid * FALLBACK_FEE_RATE * 100) / 100;
    await client.query('UPDATE mono_invoices SET fee = $2, amount = $3 WHERE invoice_id = $1', [data.invoiceId, feeUah, amountPaid]);

    const orderResult = await client.query('SELECT customer_id, status, order_number FROM orders WHERE id = $1', [orderId]);
    const order = orderResult.rows[0];
    orderNumber = order?.order_number ?? null;
    const registerId = await ensureMonoRegister(client);
    const comment = `Оплата карткою на сайті (mono), рахунок ${data.invoiceId}`;

    // Тот же учёт, что и при ручном "Принять оплату" (app/api/admin/orders/[id]/payment):
    // долг клиента уменьшается, касса пополняется
    let customerTransactionId: string | null = null;
    if (order?.customer_id) {
      const transaction = await client.query(
        `INSERT INTO customer_transactions (customer_id, amount, type, order_id, cash_register_id, affects_customer_balance, comment, created_by)
         VALUES ($1, $2, 'prepayment', $3, $4, true, $5, 'mono')
         RETURNING id`,
        [order.customer_id, -amountPaid, orderId, registerId, comment]
      );
      customerTransactionId = transaction.rows[0].id;
    }
    const movementType = order?.status === 'shipped' ? 'customer_payment' : 'customer_prepayment';
    await client.query(
      `INSERT INTO cash_movements (cash_register_id, amount, type, customer_transaction_id, order_id, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'mono')`,
      [registerId, amountPaid, movementType, customerTransactionId, orderId, comment]
    );
    // Комиссия mono — отдельным расходом, чтобы остаток кассы совпадал
    // с реальными деньгами на счёте
    if (feeUah > 0) {
      await client.query(
        `INSERT INTO cash_movements (cash_register_id, amount, type, order_id, comment, created_by)
         VALUES ($1, $2, 'expense', $3, $4, 'mono')`,
        [registerId, -feeUah, orderId, `Комісія mono за замовлення №${orderNumber ?? ''}`]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // История заказа и сообщение менеджеру — вне транзакции (их сбой не
  // должен откатывать уже принятую оплату)
  await logOrderEvent(orderId, `Оплачено карткою на сайті ${historyMoney(amountPaid)} (mono, комісія ${historyMoney(feeUah)})`);
  try {
    await sendTelegramMessage(`💳 Замовлення №${orderNumber ?? ''} оплачено карткою на сайті: ${Math.round(amountPaid)} грн`);
  } catch (error) {
    console.error('Не удалось отправить уведомление об оплате в Telegram:', error);
  }
  return { paid: true, alreadyProcessed: false };
}

// ------------------------------------------------------------
// Для страницы "Де моє замовлення?" и "Дякуємо": оплачен ли заказ онлайн
// ------------------------------------------------------------
export interface OrderPaymentInfo {
  status: 'none' | 'pending' | 'paid' | 'failed';
  amount: number | null;
}

// Если есть неоплаченный счёт — сверяемся с mono (на случай, когда вебхук
// ещё не дошёл, а покупатель уже вернулся на сайт)
export async function getOrderPaymentInfo(orderId: string): Promise<OrderPaymentInfo> {
  if (!isMonoPayEnabled()) return { status: 'none', amount: null };
  await ensureMonoTables();
  const result = await pool.query(
    'SELECT invoice_id, status, amount, paid_at FROM mono_invoices WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [orderId]
  );
  if (result.rows.length === 0) return { status: 'none', amount: null };
  const row = result.rows[0];
  if (row.paid_at) return { status: 'paid', amount: parseFloat(row.amount) };

  if (row.status === 'created' || row.status === 'processing' || row.status === 'hold') {
    try {
      const live = await fetchInvoiceStatus(row.invoice_id);
      const applied = await applyInvoiceStatus({ ...live, invoiceId: row.invoice_id });
      if (applied.paid) return { status: 'paid', amount: parseFloat(row.amount) };
      if (live.status === 'failure' || live.status === 'expired' || live.status === 'reversed') {
        return { status: 'failed', amount: parseFloat(row.amount) };
      }
    } catch (error) {
      console.error('Не удалось сверить статус счёта mono:', error);
    }
    return { status: 'pending', amount: parseFloat(row.amount) };
  }
  return { status: 'failed', amount: parseFloat(row.amount) };
}
