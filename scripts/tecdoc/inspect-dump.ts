// ============================================================
// Скрипт-розвідник: одразу подивитись, ЯКІ таблиці й колонки реально
// є у вашому конкретному дампі TecDoc — ОБОВ'ЯЗКОВО запустіть його
// ПЕРШИМ, до import-dump.ts.
//
// Чому це окремий крок, а не одразу "розумний" імпорт: TecDoc
// поширюється різними постачальниками з РІЗНИМИ назвами таблиць і
// колонок (немає єдиної "офіційної" структури, яку можна було б
// зашити в код заздалегідь) — те, що для одного дампа таблиця
// кросів називається "gm_ref_oe_nrs", для іншого може бути
// "oem_numbers" чи взагалі щось третє. Значення індексів колонок у
// import-dump.ts (CONFIG.crosses.columns і т.п.) треба заповнити
// РЕАЛЬНИМИ назвами/позиціями з ВАШОГО файлу — цей скрипт саме їх
// і показує, за кілька хвилин пробігши по файлу (не завантажуючи
// його цілком у пам'ять — той самий потоковий читач, що й у
// import-dump.ts).
//
// Запуск:
//   npx tsx scripts/tecdoc/inspect-dump.ts шлях/до/дампа.sql
//
// Що виведе:
//   - Список усіх CREATE TABLE з переліком колонок і їх позицій
//     (позиція — це і є "індекс колонки", який далі вписується в
//     CONFIG у import-dump.ts)
//   - Скільки рядків INSERT/COPY реально зустрілось у кожній таблиці
//     (щоб зрозуміти, яка таблиця маленька-довідникова, а яка —
//     мільйони рядків "лінкувань", саме її і треба шукати для
//     кросів/застосовності)
// ============================================================

import { readDump } from './dumpReader';

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Використання: npx tsx scripts/tecdoc/inspect-dump.ts шлях/до/дампа.sql');
    process.exit(1);
  }

  console.log(`Скануємо ${filePath} ...\n`);

  const tableColumns = new Map<string, string[]>();
  const tableRowCounts = new Map<string, number>();

  const stats = await readDump(filePath, {
    onCreateTable(table, columns) {
      tableColumns.set(table, columns);
    },
    onInsertRows(table, rows) {
      tableRowCounts.set(table, (tableRowCounts.get(table) || 0) + rows.length);
    },
    progressEveryLines: 500_000,
    onProgress(progress) {
      const mb = (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
      console.log(
        `... ${progress.linesRead.toLocaleString('uk-UA')} рядків файлу, ` +
          `${(progress.elapsedMs / 1000).toFixed(0)}с, пам'ять процесу ${mb} МБ`
      );
    },
  });

  console.log('\n============================================================');
  console.log('СТРУКТУРА ДАМПА (назва_таблиці · кількість_рядків)');
  console.log('============================================================\n');

  const allTables = new Set([...tableColumns.keys(), ...tableRowCounts.keys()]);
  const sortedTables = [...allTables].sort(
    (a, b) => (tableRowCounts.get(b) || 0) - (tableRowCounts.get(a) || 0)
  );

  for (const table of sortedTables) {
    const rowCount = tableRowCounts.get(table) || 0;
    console.log(`\n${table}  —  ${rowCount.toLocaleString('uk-UA')} рядків`);

    const columns = tableColumns.get(table);
    if (columns) {
      columns.forEach((col, index) => {
        console.log(`    [${index}] ${col}`);
      });
    } else {
      console.log('    (CREATE TABLE для цієї таблиці в дампі не знайдено — можливо, лише COPY-заголовок)');
    }
  }

  console.log('\n============================================================');
  console.log(
    `Готово: ${stats.linesRead.toLocaleString('uk-UA')} рядків файлу, ` +
      `${stats.statementsRead.toLocaleString('uk-UA')} SQL-операторів, ` +
      `${(stats.elapsedMs / 1000).toFixed(1)}с`
  );
  console.log('============================================================\n');
  console.log(
    'Далі: знайдіть у списку вище таблицю з кросами/OEM-номерами і таблицю\n' +
      'застосовності до авто (зазвичай це найбільші таблиці за кількістю рядків),\n' +
      'і впишіть їх реальні назви та індекси потрібних колонок у CONFIG на\n' +
      'початку scripts/tecdoc/import-dump.ts'
  );
}

main().catch((error) => {
  console.error('Помилка сканування дампа:', error);
  process.exit(1);
});
