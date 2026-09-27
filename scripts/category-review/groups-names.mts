// ============================================================
// 20 случайных групп "бренд + артикул", где названия двойников сильно
// отличаются (разный тип детали в первом слове, как у MR377487), — какое
// название выбрано для H1 главной и почему (lib/productGroups.ts). ТОЛЬКО ЧТЕНИЕ.
//
//   node --env-file=.env.local --import tsx scripts/category-review/groups-names.mts
// ============================================================

import pg from 'pg';

const { loadProductGroups, resolveGroup, nameDetailScore } = await import('../../lib/productGroups.ts');
const { twinIsSamePart } = await import('../../lib/twinMatch.ts');
const { foldLookalikes } = await import('../../lib/latinLookalikes.ts');
const { buildDisplayProductNameDetailed } = await import('../../lib/productNameTranslation.ts');
const translatable = (name: string) => Boolean(buildDisplayProductNameDetailed(name)?.safe);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const groups = await loadProductGroups(pool);
await pool.end();

const differing = [...groups.values()].filter((members) => {
  const names = members.map((m) => foldLookalikes(m.name ?? ''));
  return names.some((a, i) => names.some((b, j) => j > i && !twinIsSamePart(a, b)));
});
console.log(`Групп всего: ${groups.size}; с сильно разными названиями: ${differing.length}\n`);
const sample = differing.sort(() => Math.random() - 0.5).slice(0, 20);
sample.forEach((members, i) => {
  const g = resolveGroup(members);
  const p = members[0];
  console.log(`${i + 1}. ${p.brand} ${p.article} (${members.length} предл.)`);
  for (const m of [...members].sort((a, b) => nameDetailScore(b.name ?? '', p.brand, p.article) - nameDetailScore(a.name ?? '', p.brand, p.article))) {
    const words = Math.floor(nameDetailScore(m.name ?? '', p.brand, p.article) / 1000);
    console.log(`   ${m.name === g.displayName ? '✔' : ' '} «${m.name}» — слов: ${words}, ${translatable(m.name ?? '') ? 'переводится' : 'НЕ переводится'}${m.id === g.primaryId ? ' [главная страница]' : ''}`);
  }
});
