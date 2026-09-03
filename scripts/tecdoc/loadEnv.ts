// ============================================================
// Крихітний завантажувач .env.local для автономних скриптів у
// scripts/ — Next.js сам підвантажує .env.local тільки для `next dev`
// /`next build`, а `tsx scripts/...` запускається В ОБХІД Next.js,
// тому DATABASE_URL звідти сам по собі не підхопиться. Замість того,
// щоб тягнути в проект окрему залежність (dotenv) заради 10 рядків
// коду, просто читаємо .env.local вручну тут.
//
// Викликати ОДИН РАЗ на самому початку скрипта, до першого звернення
// до process.env.DATABASE_URL
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

export function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Прибираємо один рівень лапок навколо значення, якщо вони є
    // (щоб DATABASE_URL="postgres://..." теж спрацював, а не лишив
    // лапки прямо в рядку підключення)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Не перезаписуємо значення, яке вже реально задане в оточенні
    // (напр. якщо запустили як DATABASE_URL=... npx tsx ...) —
    // змінні з реального оточення мають пріоритет над файлом
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
