// ============================================================
// ФИД СТРАНИЦ ДЛЯ ДИНАМИЧЕСКОЙ РЕКЛАМЫ GOOGLE ADS (DSA)
// Публичный адрес: /feeds/dsa-pages.csv
// ============================================================
// CSV (UTF-8, запятая) с колонками "Page URL,Custom label":
//   - только главные страницы групп бренд+артикул (lib/productGroups.ts,
//     is_group_primary) — те же адреса, что в sitemap (canonical);
//   - только В НАЛИЧИИ (хоть одно предложение группы в наличии);
//   - только оригинальные бренды автопроизводителей (OEM_BRAND_LABELS);
//   - без восстановленных деталей (бейдж "Відновлена", products.is_refurbished) —
//     ни у главной, ни у лучшего предложения группы;
//   - без "пустых" названий ("Деталь двигуна TOYOTA 1234", lib/emptyPartName.ts).
// Custom label — бренд группы латиницей в нижнем регистре (mobis, toyota...),
// по нему в Google Ads делаются отдельные группы объявлений / ставки.
//
// Строк ~77 тыс. (~10 МБ) — больше лимита ответа функции Vercel (4,5 МБ),
// поэтому файл собирается раз в сутки (cron /api/cron/rebuild-dsa-feed,
// вручную — npm run dsa-feed:rebuild) и кладётся в Vercel Blob под
// постоянным именем, а /feeds/dsa-pages.csv проксируется туда (rewrite в
// next.config.mjs). В sitemap адрес не добавляется, robots.txt его не закрывает
// ============================================================

import type { Pool } from 'pg';
import { put } from '@vercel/blob';
import { normalizeBrandKey } from './brandFamilies';
import { isEmptyPartName } from './emptyPartName';
import { buildProductPath } from './slug';
import { SITE_URL } from './siteConfig';

// Имя файла в Blob — постоянное (перезаписывается), на него ведёт rewrite
export const DSA_FEED_BLOB_PATH = 'feeds/dsa-pages.csv';

// Токен хранилища: локально — BLOB_READ_WRITE_TOKEN (.env.local), на Vercel
// это же хранилище (store_khIb8AmQctsKdmXz) подключено с префиксом "bazaa_"
// — стандартной переменной там нет. Тот же выбор в next.config.mjs (rewrite)
function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || process.env.bazaa_READ_WRITE_TOKEN || undefined;
}

// Бренд (normalizeBrandKey: верхний регистр, без пробелов и знаков) → label.
// В базе один бренд записан по-разному ("HYUNDAI / KIA", "Hyundai", "KIA"),
// поэтому здесь все встречающиеся варианты. MOBIS — оригинал Hyundai/Kia,
// поэтому HYUNDAI/KIA → mobis; Lexus → toyota, Infiniti → nissan,
// VW/Audi/Skoda → vag (как в lib/brandFamilies.ts).
// Намеренно НЕ входят: "MITSUBISHI ELECTRIC" (другой производитель),
// "MOBIS(БРАК)", "RENAULT TRUCKS", "ROVER", "Nissan Infiniti Renault"
const OEM_BRAND_LABELS: Record<string, string> = {
  MOBIS: 'mobis',
  HYUNDAI: 'mobis',
  KIA: 'mobis',
  HYUNDAIKIA: 'mobis',
  NISSAN: 'nissan',
  INFINITI: 'nissan',
  NISSANINFINITI: 'nissan',
  TOYOTA: 'toyota',
  LEXUS: 'toyota',
  TOYOTALEXUS: 'toyota',
  TOYOTALEXUSSCION: 'toyota',
  MAZDA: 'mazda',
  MITSUBISHI: 'mitsubishi',
  HONDA: 'honda',
  HONDAACURA: 'honda',
  SUBARU: 'subaru',
  SUZUKI: 'suzuki',
  SUZUKIMARUTI: 'suzuki',
  ISUZU: 'isuzu',
  SSANGYONG: 'ssangyong',
  KGMSSANGYONG: 'ssangyong',
  VAG: 'vag',
  VW: 'vag',
  VOLKSWAGEN: 'vag',
  VOIKSVAGEN: 'vag', // опечатка в прайсе поставщика
  AUDI: 'vag',
  SKODA: 'vag',
  FORD: 'ford',
  BMW: 'bmw',
  MERCEDES: 'mercedes',
  MERCEDESBENZ: 'mercedes',
  MERSEDESBENZ: 'mercedes', // опечатка в прайсе поставщика
  RENAULT: 'renault',
  PEUGEOTCITROEN: 'peugeot',
  CITROENPEUGEOT: 'peugeot',
  PEUGEOT: 'peugeot',
  CITROEN: 'peugeot',
  PSA: 'peugeot',
  LANDROVER: 'landrover',
};

export interface DsaFeedRow {
  url: string;
  label: string;
}

export interface DsaFeedStats {
  total: number;
  byLabel: Record<string, number>;
  ms: number;
}

// Все строки фида из базы. Порядок — по label, затем id: файл стабилен
// между пересборками (проще сравнивать и Google не видит лишних "изменений")
export async function buildDsaFeedRows(pool: Pool): Promise<DsaFeedRow[]> {
  // Тот же ключ, что normalizeBrandKey(), но на стороне базы — чтобы не
  // тянуть 300+ тыс. товаров чужих брендов
  const result = await pool.query(
    `SELECT p.id, p.article, p.brand, p.name, p.group_display_name
     FROM products p
     LEFT JOIN products best ON best.id = p.group_best_offer_id
     WHERE p.is_active = true
       AND p.is_group_primary
       AND COALESCE(p.group_in_stock, p.stock > 0)
       AND NOT COALESCE(p.is_refurbished, false)
       AND NOT COALESCE(best.is_refurbished, false)
       AND regexp_replace(upper(coalesce(p.brand, '')), '[^A-Z0-9А-Я]', '', 'g') = ANY($1::text[])
     ORDER BY p.id`,
    [Object.keys(OEM_BRAND_LABELS)]
  );

  const rows: DsaFeedRow[] = [];
  for (const row of result.rows) {
    const label = OEM_BRAND_LABELS[normalizeBrandKey(row.brand)];
    if (!label) continue;
    // Пустое название проверяем по тому, что видит покупатель в H1 —
    // лучшему названию группы, а если его нет — по собственному
    if (isEmptyPartName(row.group_display_name ?? row.name, row.brand, row.article)) continue;
    // Слаг — из СОБСТВЕННОГО названия, как в sitemap и canonical страницы
    rows.push({
      url: `${SITE_URL}${buildProductPath(row.id, { brand: row.brand, article: row.article, name: row.name })}`,
      label,
    });
  }
  rows.sort((a, b) => a.label.localeCompare(b.label));
  return rows;
}

// Экранирование значения CSV: в кавычки, только если есть запятая, кавычка или перенос
function csvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildDsaFeedCsv(rows: DsaFeedRow[]): string {
  const lines = ['Page URL,Custom label', ...rows.map((row) => `${csvValue(row.url)},${csvValue(row.label)}`)];
  return lines.join('\r\n') + '\r\n';
}

export function countByLabel(rows: DsaFeedRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.label] = (counts[row.label] ?? 0) + 1;
  return counts;
}

// Собрать фид и перезаписать файл в Blob. Пустой фид НЕ записываем —
// если запрос вдруг вернул 0 строк (сбой данных), пусть Google берёт вчерашний
export async function rebuildDsaFeed(pool: Pool): Promise<DsaFeedStats & { url: string | null }> {
  const started = Date.now();
  const rows = await buildDsaFeedRows(pool);
  let url: string | null = null;
  if (rows.length > 0) {
    const blob = await put(DSA_FEED_BLOB_PATH, buildDsaFeedCsv(rows), {
      access: 'public',
      contentType: 'text/csv; charset=utf-8',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken(),
      // Файл меняется раз в сутки — CDN держит копию не дольше часа
      cacheControlMaxAge: 3600,
    });
    url = blob.url;
  }
  return { total: rows.length, byLabel: countByLabel(rows), ms: Date.now() - started, url };
}
