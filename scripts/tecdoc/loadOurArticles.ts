// ============================================================
// Один SELECT DISTINCT article FROM products — увесь набір
// очищених артикулів, які реально є у вашому каталозі. Саме на цей
// набір фільтруються файли кросів під час імпорту — в цьому й суть
// звуження "тільки перетин з products", а не весь файл цілком.
//
// Десятки тисяч коротких рядків у Set — це одиниці мегабайт пам'яті,
// завантажити їх одним запитом без стрімінгу абсолютно нормально
// ============================================================

import type { Pool } from 'pg';

export async function loadOurArticles(pool: Pool): Promise<Set<string>> {
  const result = await pool.query('SELECT DISTINCT article FROM products');
  return new Set(result.rows.map((row) => row.article as string));
}
