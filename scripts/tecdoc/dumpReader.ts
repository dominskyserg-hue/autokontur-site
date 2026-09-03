// ============================================================
// Потоковий (streaming) читач великого SQL-дампа (mysqldump АБО
// pg_dump) — серце всього імпорту TecDoc. Читає файл рядок за рядком
// через Node.js readline поверх fs.createReadStream, тому в пам'яті
// одночасно тримається лише ОДИН оператор SQL (для mysqldump це може
// бути кілька, рідше — кілька десятків мегабайт при "extended insert",
// але ніколи не весь файл) — саме це дає обіцяний Zero-RAM Overhead
// на файлі в 11 ГБ.
//
// Підтримує ДВА формати, тому що дампи TecDoc в мережі трапляються в
// обох варіантах залежно від того, хто і чим його вивантажив:
//
//   1) mysqldump:  INSERT INTO `таблиця` VALUES (1,'a','b'),(2,'c','d');
//   2) pg_dump:    COPY "таблиця" (col1, col2) FROM stdin;
//                  1<TAB>a
//                  2<TAB>c
//                  \.
//
// Формат визначається автоматично по кожному оператору — вручну
// нічого перемикати не треба.
//
// Використання (див. scripts/tecdoc/import-dump.ts і
// scripts/tecdoc/inspect-dump.ts):
//
//   await readDump(shlyakhDoFajlu, {
//     onCreateTable(table, columns) { ... },   // необов'язково
//     onInsertRows(table, rows) { ... },        // rows: unknown[][]
//     onProgress(stats) { ... },                // необов'язково
//   });
// ============================================================

import fs from 'node:fs';
import readline from 'node:readline';

export interface DumpReaderStats {
  linesRead: number;
  statementsRead: number;
  rowsRead: number;
  elapsedMs: number;
}

export interface DumpReaderHooks {
  // Викликається один раз на кожну знайдену CREATE TABLE — зручно для
  // scripts/tecdoc/inspect-dump.ts, щоб просто роздрукувати структуру
  // дампа перед тим, як налаштовувати сам імпорт
  onCreateTable?: (table: string, columns: string[]) => void;

  // Викликається на КОЖЕН оператор INSERT/блок COPY з рядками даних —
  // rows завжди unknown[][] (кожен внутрішній масив — одна строка
  // таблиці, значення вже розпарсені з SQL-літералів у звичайні
  // JS-значення: string | number | null).
  //
  // МОЖЕ повертати Promise — readDump() його ЧЕКАЄ (await) перед тим,
  // як читати наступний рядок файлу. Це навмисний backpressure: без
  // нього readline вичитував би файл (дешева локальна операція)
  // набагато швидше, ніж БД встигає приймати батчі (мережевий I/O до
  // Supabase), і непровставлені рядки накопичувались би в необмеженій
  // черзі промісів у пам'яті — якраз те, чого вимога "< 256 МБ RAM"
  // прямо забороняє
  onInsertRows?: (table: string, rows: unknown[][]) => void | Promise<void>;

  // Раз на progressEveryLines рядків файлу — для індикації прогресу
  // при роботі з 11-гігабайтним файлом (без цього незрозуміло, чи
  // скрипт завис, чи просто працює довго)
  onProgress?: (stats: DumpReaderStats) => void;
  progressEveryLines?: number;
}

// ------------------------------------------------------------
// Розбір ОДНОГО значення SQL-літералу в JS-значення
// ------------------------------------------------------------
function parseSqlValue(raw: string): string | number | null {
  const value = raw.trim();

  if (/^NULL$/i.test(value)) return null;

  // Ціле або дробове число без лапок
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return value.includes('.') ? parseFloat(value) : parseInt(value, 10);
  }

  // Рядок у лапках — знімаємо лапки і розекрануємо і backslash-стиль
  // (MySQL), і подвоєні лапки (SQL-стандарт/Postgres) — обидва
  // трапляються залежно від джерела дампа
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    const inner = value.slice(1, -1);
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\0/g, '\0')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/''/g, "'")
      .replace(/""/g, '"');
  }

  // Все інше (шістнадцяткові літерали 0x.., службові конструкції) —
  // повертаємо як є текстом, для наших цілей (кроси/застосовність)
  // такі значення не потрібні
  return value;
}

// ------------------------------------------------------------
// Розбір "INSERT INTO `таблиця` [(колонки)] VALUES (...),(...);"
// на назву таблиці й масив рядків. Побудований як маленький
// символьний автомат, а не regex — бо всередині лапок можуть бути
// коми й дужки, які regex надійно не порахує
// ------------------------------------------------------------
const INSERT_PREFIX =
  /^INSERT\s+INTO\s+[`"]?([\w.]+)[`"]?\s*(?:\([^)]*\))?\s*VALUES\s*/i;

function parseInsertStatement(statement: string): { table: string; rows: unknown[][] } | null {
  const prefixMatch = INSERT_PREFIX.exec(statement);
  if (!prefixMatch) return null;

  const table = prefixMatch[1];
  let rest = statement.slice(prefixMatch[0].length).trimEnd();
  if (rest.endsWith(';')) rest = rest.slice(0, -1);

  const rows: unknown[][] = [];
  const n = rest.length;
  let i = 0;

  while (i < n) {
    while (i < n && (rest[i] === ',' || /\s/.test(rest[i]))) i++;
    if (i >= n) break;
    if (rest[i] !== '(') {
      // Не мала форма (напр. хвіст на кшталт "ON DUPLICATE KEY ...") —
      // припиняємо розбір цього оператора, зібрані рядки все одно
      // повертаємо
      break;
    }
    i++; // з'їли відкриваючу дужку тюпла-рядка

    const fields: string[] = [];
    let fieldStart = i;
    let inString = false;
    let quoteChar = '';

    while (i < n) {
      const ch = rest[i];

      if (inString) {
        if (ch === '\\') {
          i += 2; // пропускаємо екранований символ повністю
          continue;
        }
        if (ch === quoteChar) {
          if (rest[i + 1] === quoteChar) {
            i += 2; // подвоєна лапка-екранування ('' або "")
            continue;
          }
          inString = false;
          i++;
          continue;
        }
        i++;
        continue;
      }

      if (ch === "'" || ch === '"') {
        inString = true;
        quoteChar = ch;
        i++;
        continue;
      }
      if (ch === ',') {
        fields.push(rest.slice(fieldStart, i));
        i++;
        fieldStart = i;
        continue;
      }
      if (ch === ')') {
        fields.push(rest.slice(fieldStart, i));
        i++;
        break;
      }
      i++;
    }

    rows.push(fields.map(parseSqlValue));
  }

  return { table, rows };
}

// ------------------------------------------------------------
// Розбір заголовку "CREATE TABLE `таблиця` (...)" — повертає лише
// назву таблиці й "сирий" список визначень колонок (кожна — окремим
// рядком типу "`id` int NOT NULL"), з якого inspect-dump.ts дістає
// перше слово як назву колонки
// ------------------------------------------------------------
const CREATE_TABLE_PREFIX = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([\w.]+)[`"]?\s*\(/i;

function parseCreateTableStatement(statement: string): { table: string; columns: string[] } | null {
  const match = CREATE_TABLE_PREFIX.exec(statement);
  if (!match) return null;

  const table = match[1];
  const afterParen = statement.slice(match[0].length);

  // Ріжемо по верхньорівневих комах усередині "(...)" визначення
  // таблиці — так само важливо не плутати їх із комами всередині
  // типів на кшталт DECIMAL(10,2)
  const columns: string[] = [];
  let depth = 1;
  let start = 0;
  let i = 0;
  const n = afterParen.length;

  while (i < n && depth > 0) {
    const ch = afterParen[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const piece = afterParen.slice(start, i).trim();
        if (piece) columns.push(piece);
        break;
      }
    } else if (ch === ',' && depth === 1) {
      columns.push(afterParen.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }

  // Лишаємо тільки визначення колонок (перше слово в лапках) —
  // рядки на кшталт "PRIMARY KEY (...)" чи "KEY idx (...)" теж
  // потрапляють у список, inspect-dump.ts сам відфільтрує їх при друку
  const columnNames = columns.map((def) => {
    const nameMatch = /^[`"]?([\w]+)[`"]?/.exec(def.trim());
    return nameMatch ? nameMatch[1] : def;
  });

  return { table, columns: columnNames };
}

// ------------------------------------------------------------
// Розбір ОДНОГО рядка даних у форматі pg_dump COPY (TAB-розділені
// значення, без лапок — екрановані лише сам TAB/\n/\\ і NULL як \N)
// ------------------------------------------------------------
function parseCopyRow(line: string): (string | null)[] {
  return line.split('\t').map((raw) => {
    if (raw === '\\N') return null;
    return raw.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
  });
}

const COPY_HEADER = /^COPY\s+[`"]?([\w.]+)[`"]?\s*\(([^)]*)\)\s*FROM\s+stdin;/i;

export async function readDump(filePath: string, hooks: DumpReaderHooks): Promise<DumpReaderStats> {
  const startedAt = Date.now();
  const stats: DumpReaderStats = { linesRead: 0, statementsRead: 0, rowsRead: 0, elapsedMs: 0 };
  const progressEvery = hooks.progressEveryLines ?? 200_000;

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let statementBuffer = '';
  let inCopyBlock = false;
  let copyTable = '';

  for await (const rawLine of rl) {
    stats.linesRead++;

    if (inCopyBlock) {
      if (rawLine === '\\.') {
        inCopyBlock = false;
        copyTable = '';
      } else if (rawLine.length > 0) {
        const row = parseCopyRow(rawLine);
        stats.rowsRead++;
        await hooks.onInsertRows?.(copyTable, [row]);
      }
    } else {
      const trimmed = rawLine.trim();
      const copyHeaderMatch = COPY_HEADER.exec(trimmed);

      if (copyHeaderMatch) {
        // Незавершений statementBuffer перед COPY (не мало б траплятись
        // у справжніх дампах) свідомо відкидаємо — це не наш кейс
        statementBuffer = '';
        inCopyBlock = true;
        copyTable = copyHeaderMatch[1];
        stats.statementsRead++;
      } else {
        statementBuffer += (statementBuffer ? '\n' : '') + rawLine;

        // Оператор вважається завершеним, коли ФІЗИЧНИЙ рядок дампа
        // закінчується крапкою з комою (у mysqldump/pg_dump це завжди
        // так — навіть багаторядковий CREATE TABLE закінчується `;`
        // на останньому рядку, а значення даних усередині INSERT вже
        // проекрановані дампером, тому "сирий" `;` усередині рядка
        // з даними фізично не зустрічається)
        if (/;\s*$/.test(rawLine)) {
          const statement = statementBuffer.trim();
          statementBuffer = '';
          stats.statementsRead++;

          if (hooks.onCreateTable && /^CREATE\s+TABLE/i.test(statement)) {
            const parsed = parseCreateTableStatement(statement);
            if (parsed) hooks.onCreateTable(parsed.table, parsed.columns);
          } else if (hooks.onInsertRows && /^INSERT\s+INTO/i.test(statement)) {
            const parsed = parseInsertStatement(statement);
            if (parsed) {
              stats.rowsRead += parsed.rows.length;
              await hooks.onInsertRows(parsed.table, parsed.rows);
            }
          }
        }
      }
    }

    if (hooks.onProgress && stats.linesRead % progressEvery === 0) {
      stats.elapsedMs = Date.now() - startedAt;
      hooks.onProgress(stats);
    }
  }

  stats.elapsedMs = Date.now() - startedAt;
  return stats;
}
