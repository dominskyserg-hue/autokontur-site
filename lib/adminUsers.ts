// ============================================================
// Пользователи админ-панели (владелец и менеджеры).
//
// Раньше на всю админку был один общий пароль (ADMIN_PASSWORD) и
// система не знала, КТО именно вошёл. Теперь у каждого сотрудника свой
// логин и пароль, а сессия в admin_sessions привязана к пользователю
// (колонка user_id) — на этом строится "кто занимается заказом" и
// журнал действий.
//
// Роли:
//   owner   — владелец: видит всё и управляет менеджерами
//   manager — менеджер: работает с заказами (какие разделы ему
//             доступны — решается отдельно, см. requireOwner())
//
// Таблицы описаны в конце schema.sql, но этот модуль сам создаёт их
// при первом обращении, если их ещё нет (тот же приём, что и в
// lib/orderHistory.ts) — отдельно запускать SQL в базе не нужно.
//
// Пароли хранятся только в виде хеша scrypt с индивидуальной солью —
// из базы сам пароль получить нельзя.
// ============================================================

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Pool } from 'pg';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

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

export type AdminRole = 'owner' | 'manager';

// Кто вошёл — то, что отдаёт getCurrentAdmin() (lib/adminAuth.ts)
export interface AdminIdentity {
  // null — "старая" сессия, созданная ещё до появления пользователей
  // (вход по общему паролю). Такая сессия считается сессией владельца,
  // чтобы при деплое никого не выкинуло из админки
  id: string | null;
  login: string;
  name: string;
  role: AdminRole;
  sessionId: string;
}

export interface AdminUserRow {
  id: string;
  login: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// ------------------------------------------------------------
// Таблицы
// ------------------------------------------------------------
let tablesReady: Promise<void> | null = null;

// Один раз на запуск функции; при ошибке забываем результат, чтобы
// следующий вызов попробовал снова
export function ensureAdminUsersTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          login TEXT NOT NULL UNIQUE CHECK (login = lower(login)),
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager')),
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ
        )
      `);
      await pool.query(
        'ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE'
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_admin_sessions_user_id ON admin_sessions (user_id)');
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  return tablesReady;
}

// ------------------------------------------------------------
// Пароли
// ------------------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8;

// Формат: scrypt:<соль hex>:<хеш hex>
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Хеш-пустышка: когда логина нет в базе, всё равно считаем scrypt —
// чтобы по времени ответа нельзя было понять, существует ли такой логин
let dummyHashPromise: Promise<string> | null = null;
export async function verifyAgainstDummy(password: string): Promise<void> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummyHashPromise);
}

// ------------------------------------------------------------
// Проверка входных данных
// ------------------------------------------------------------
const LOGIN_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeLogin(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidLogin(login: string): boolean {
  return LOGIN_PATTERN.test(login);
}

// ------------------------------------------------------------
// Запросы
// ------------------------------------------------------------
interface DbUser {
  id: string;
  login: string;
  name: string;
  password_hash: string;
  role: AdminRole;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

function toRow(row: DbUser): AdminUserRow {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function countAdminUsers(): Promise<number> {
  await ensureAdminUsersTables();
  const result = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM admin_users');
  return result.rows[0]?.count ?? 0;
}

export async function findAdminUserByLogin(login: string): Promise<(AdminUserRow & { passwordHash: string }) | null> {
  await ensureAdminUsersTables();
  const result = await pool.query<DbUser>('SELECT * FROM admin_users WHERE login = $1', [login]);
  const row = result.rows[0];
  return row ? { ...toRow(row), passwordHash: row.password_hash } : null;
}

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  await ensureAdminUsersTables();
  const result = await pool.query<DbUser>('SELECT * FROM admin_users ORDER BY is_active DESC, role, name');
  return result.rows.map(toRow);
}

export async function createAdminUser(input: {
  login: string;
  name: string;
  password: string;
  role: AdminRole;
}): Promise<AdminUserRow> {
  await ensureAdminUsersTables();
  const result = await pool.query<DbUser>(
    'INSERT INTO admin_users (login, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [input.login, input.name, await hashPassword(input.password), input.role]
  );
  return toRow(result.rows[0]);
}

export async function markAdminUserLogin(userId: string): Promise<void> {
  await pool.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [userId]);
}

// Удаляет сессии пользователя (кроме одной, если указана) — после
// отключения, смены пароля или роли старые входы должны перестать работать
export async function deleteUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)', [
    userId,
    exceptSessionId ?? null,
  ]);
}

export async function updateAdminUser(
  userId: string,
  changes: { name?: string; role?: AdminRole; isActive?: boolean; password?: string }
): Promise<AdminUserRow | null> {
  await ensureAdminUsersTables();
  const sets: string[] = [];
  const values: unknown[] = [userId];

  if (changes.name !== undefined) {
    values.push(changes.name);
    sets.push(`name = $${values.length}`);
  }
  if (changes.role !== undefined) {
    values.push(changes.role);
    sets.push(`role = $${values.length}`);
  }
  if (changes.isActive !== undefined) {
    values.push(changes.isActive);
    sets.push(`is_active = $${values.length}`);
  }
  if (changes.password !== undefined) {
    values.push(await hashPassword(changes.password));
    sets.push(`password_hash = $${values.length}`);
  }
  if (sets.length === 0) return null;

  const result = await pool.query<DbUser>(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  return result.rows[0] ? toRow(result.rows[0]) : null;
}
