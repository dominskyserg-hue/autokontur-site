// ============================================================
// Ручна перебудова корпусу українських слів (lib/corpusBuilder.ts):
// запускайте після великого імпорту прайсів, якщо не хочете чекати
// щотижневого cron-а (/api/cron/rebuild-corpus).
//
//   npm run corpus:rebuild
//
// Робить дві речі: (1) записує слова в таблицю ukrainian_corpus_words
// (звідти їх читає сайт — без нового деплою), (2) оновлює статичний
// резервний файл lib/ukrainianCorpusWords.ts (його варто закомітити
// час від часу — він потрібен, лише якщо таблиця порожня).
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { loadEnvLocal } from './tecdoc/loadEnv';
import { collectCorpusWords, loadAllProductNames, saveCorpusToDatabase, MIN_UA_NAMES } from '../lib/corpusBuilder';

async function main() {
  loadEnvLocal();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const names = await loadAllProductNames(pool);
    const words = collectCorpusWords(names);
    await saveCorpusToDatabase(pool, words);
    console.log(`Назв: ${names.length}, слів у корпусі: ${words.length} (записано в ukrainian_corpus_words)`);

    const file = path.resolve(process.cwd(), 'lib/ukrainianCorpusWords.ts');
    fs.writeFileSync(
      file,
      `// ============================================================
// РЕЗЕРВНИЙ набір українських слів (згенеровано scripts/rebuild-ukrainian-corpus.ts:
// слово зустрілось у >= ${MIN_UA_NAMES} назвах з і/ї/є/ґ і майже не трапляється в
// назвах з ы/э/ъ/ё). Основне джерело — таблиця ukrainian_corpus_words
// (lib/ukrainianCorpus.ts); цей файл потрібен, лише якщо таблиця порожня.
// ============================================================

const RAW = \`${words.join(' ')}\`;

export const UKRAINIAN_CORPUS_WORDS: ReadonlySet<string> = new Set(RAW.split(' '));
`,
      'utf8'
    );
    console.log('Оновлено lib/ukrainianCorpusWords.ts');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
