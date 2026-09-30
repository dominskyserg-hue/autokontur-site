// ============================================================
// "ХВОСТ" ИМПОРТА ПРАЙСА — отдельным вызовом, импорт его не ждёт
// ============================================================
// Раньше всё выполнялось после ответа импорта, но в ТОМ ЖЕ вызове функции
// Vercel (лимит 60 с): запись прайса 25 с + группы 5 с + категории 15 с +
// марки + словарь — для самого большого прайса ~45 с и больше. Теперь
// импорт оставляет себе запись и пересчёт групп (без них в списках висела бы
// старая цена), а категории, индекс "марка авто → товары" и словарь
// украинских слов считает отдельный вызов /api/cron/import-followup со своим
// лимитом 60 с. Время каждой части — в журнал price_import_timings
// ============================================================

import type { Pool } from 'pg';
import { recomputeProductCategories } from '@/lib/categoryAssignment';
import { rebuildOwnVehiclesSafely } from '@/lib/ownVehicles';
import { rebuildUkrainianCorpusSafely } from '@/lib/corpusBuilder';
import { SITE_URL } from '@/lib/siteConfig';
import { alertIfSlowImport, updateImportTiming } from '@/lib/importTimings';

// Сам хвост: категории поставщика, индекс марок, словарь. Каждая часть — со временем
export async function runImportFollowup(pool: Pool, supplierId: string, timingId: string | null): Promise<void> {
  const started = Date.now();
  const times: { categories_ms?: number; vehicle_makes_ms?: number; corpus_ms?: number } = {};
  let error: string | undefined;
  try {
    let t = Date.now();
    await recomputeProductCategories(pool, { kind: 'supplier', supplierId });
    times.categories_ms = Date.now() - t;
    t = Date.now();
    // Своя применимость (марка/модель авто) — товары этого поставщика
    await rebuildOwnVehiclesSafely(pool, { supplierId });
    times.vehicle_makes_ms = Date.now() - t;
    t = Date.now();
    await rebuildUkrainianCorpusSafely(pool);
    times.corpus_ms = Date.now() - t;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('Хвост импорта прайса завершился с ошибкой:', e);
  }
  const total = Date.now() - started;
  console.log(
    `Хвост импорта (${supplierId}): категории ${times.categories_ms} мс, своя применимость ${times.vehicle_makes_ms} мс, словарь ${times.corpus_ms} мс, всего ${total} мс`
  );
  await updateImportTiming(pool, timingId, {
    ...times,
    followup_total_ms: total,
    followup_finished_at: new Date(),
    ...(error ? { followup_error: error.slice(0, 500) } : {}),
  });
  await alertIfSlowImport(pool, 'хвіст імпорту (категорії, марки, словник)', supplierId, total, {
    категорії: times.categories_ms,
    'своя применимость (марка/модель)': times.vehicle_makes_ms,
    'словник назв': times.corpus_ms,
  });
}

// Запустить хвост и НЕ ждать его. На проде — отдельный запрос к
// /api/cron/import-followup (он сразу отвечает 202 и работает в своём вызове
// функции). Локально и в скриптах (нет продового адреса) — просто в фоне
export async function startImportFollowup(pool: Pool, supplierId: string, timingId: string | null): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (process.env.VERCEL_ENV === 'production' && secret) {
    try {
      const response = await fetch(`${SITE_URL}/api/cron/import-followup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId, timingId }),
      });
      if (response.ok) return;
      console.error(`Хвост импорта: /api/cron/import-followup ответил ${response.status} — считаем здесь`);
    } catch (error) {
      console.error('Хвост импорта: не удалось вызвать /api/cron/import-followup — считаем здесь', error);
    }
  }
  void runImportFollowup(pool, supplierId, timingId);
}
