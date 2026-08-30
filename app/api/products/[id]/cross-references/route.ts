// ============================================================
// API Route (Route Handler) для Next.js App Router.
// Адрес: /api/products/[id]/cross-references
//
// Управление кросс-номерами ОДНОГО товара — экран "Кроссы" в админке
// (components/CrossReferencesScreen.tsx). Модель данных — "группы
// взаимозаменяемости" (см. подробный комментарий в schema.sql, раздел
// 11): два участника ОДНОЙ группы (cross_reference_members) — кросс
// друг для друга. У товара может ещё не быть группы (тогда список
// кросс-номеров просто пуст), а может быть группа с одним или
// несколькими другими участниками — вот их и показывает GET.
//
//   GET  /api/products/[id]/cross-references — товар + все ОСТАЛЬНЫЕ
//        участники его группы (сам товар из списка исключён — это не
//        "кросс самому себе")
//
//   POST /api/products/[id]/cross-references — привязать новый
//        кросс-номер к товару. Тело:
//        { "crossBrand": "Bosch", "crossArticle": "0986424815",
//          "crossPartType": "aftermarket", "source": "user-reported" }
//        crossPartType и source необязательны (значения по умолчанию
//        ниже) — MANUAL_SOURCE_DEFAULT, потому что это ручное
//        добавление одной записи админом, а не загрузка проверенного
//        файла поставщика (там источник 'official', см. .../import)
//
// [id] — id ТОВАРА В НАШЕМ КАТАЛОГЕ, а не самого кросс-номера
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { Pool, PoolClient } from 'pg';

// Библиотека pg использует Node.js API, поэтому роут должен
// выполняться в окружении Node.js, а не в "Edge"-окружении Next.js
export const runtime = 'nodejs';

// ------------------------------------------------------------
// ПОДКЛЮЧЕНИЕ К POSTGRESQL (общий пул соединений)
// ------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

const pool =
  globalThis.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.pgPool = pool;
}

// ------------------------------------------------------------
// ПРОВЕРКА, ЧТО СТРОКА — НАСТОЯЩИЙ UUID
// ------------------------------------------------------------
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

// Та же самая нормализация, что и для обычного артикула товара (см.
// app/api/products/route.ts) — кросс-номер должен искаться и
// сохраняться в точности так же, иначе "0986424815" и "0 986 424 815"
// будут считаться разными номерами
function cleanArticle(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';

  return String(rawValue)
    .toUpperCase()
    .trim()
    .replace(/[\s\-_./\\]+/g, '')
    .replace(/[^A-Z0-9А-Я]/g, '');
}

const PART_TYPE_VALUES = ['oem', 'aftermarket'] as const;
type PartType = (typeof PART_TYPE_VALUES)[number];
function isValidPartType(value: string): value is PartType {
  return (PART_TYPE_VALUES as readonly string[]).includes(value);
}

const SOURCE_VALUES = ['official', 'user-reported', 'algorithmic'] as const;
type Source = (typeof SOURCE_VALUES)[number];
function isValidSource(value: string): value is Source {
  return (SOURCE_VALUES as readonly string[]).includes(value);
}

// Ручное добавление одной связи через эту форму — по умолчанию
// считаем источником "администратор добавил вручную", а не
// "официальный прайс" (тот источник проставляет уже сам импорт, см.
// app/api/products/cross-references/import/route.ts)
const MANUAL_SOURCE_DEFAULT: Source = 'user-reported';

interface CrossMemberResponse {
  memberId: string;
  brand: string;
  partNumber: string;
  partNumberRaw: string | null;
  partType: PartType;
  source: Source;
  productId: string | null;
  // Если этот кросс-номер тоже привязан к товару из нашего каталога —
  // его текущие цена/остаток, чтобы админ видел, есть ли он в наличии
  inStockRetailPrice: number | null;
  inStockQuantity: number | null;
}

// ------------------------------------------------------------
// GET — товар + участники его группы (кроме него самого)
// ------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  try {
    const productResult = await pool.query(
      `SELECT id, article, brand, name FROM products WHERE id = $1`,
      [id]
    );

    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }

    // Собственная запись товара в модели кроссов — если её ещё нет,
    // товар пока ни с чем не связан, дальше и искать нечего
    const myMemberResult = await pool.query(
      `SELECT group_id FROM cross_reference_members WHERE product_id = $1`,
      [id]
    );

    let crossReferences: CrossMemberResponse[] = [];

    if (myMemberResult.rows.length > 0) {
      const groupId = myMemberResult.rows[0].group_id;

      const membersResult = await pool.query(
        `
        SELECT
          m.id, m.brand, m.part_number, m.part_number_raw, m.part_type, m.source, m.product_id,
          p.retail_price, p.stock
        FROM cross_reference_members m
        LEFT JOIN products p ON p.id = m.product_id
        WHERE m.group_id = $1 AND m.product_id IS DISTINCT FROM $2
        ORDER BY m.created_at ASC
        `,
        [groupId, id]
      );

      crossReferences = membersResult.rows.map((row) => ({
        memberId: row.id,
        brand: row.brand,
        partNumber: row.part_number,
        partNumberRaw: row.part_number_raw,
        partType: row.part_type,
        source: row.source,
        productId: row.product_id,
        inStockRetailPrice: row.retail_price !== null ? parseFloat(row.retail_price) : null,
        inStockQuantity: row.stock,
      }));
    }

    const productRow = productResult.rows[0];

    return NextResponse.json({
      success: true,
      product: {
        id: productRow.id,
        article: productRow.article,
        brand: productRow.brand,
        name: productRow.name,
      },
      crossReferences,
    });
  } catch (error) {
    console.error('Ошибка при получении кросс-номеров товара:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось получить кросс-номера: ' + message },
      { status: 500 }
    );
  }
}

// ------------------------------------------------------------
// ЯДРО МОДЕЛИ: связать деталь A с деталью B в одну группу
// взаимозаменяемости. Используется и здесь (ручное добавление одной
// связи), и в массовом импорте — там та же самая функция продублирована
// (проект намеренно не выносит общий код в отдельные lib-модули, см.
// другие роуты: каждый файл самодостаточен)
// ------------------------------------------------------------
interface PartRef {
  brand: string;
  partNumber: string; // уже очищенный cleanArticle()
  partNumberRaw: string | null;
  productId: string | null;
  partType: PartType;
}

type LinkOutcome =
  | { action: 'created' | 'linked' | 'already_linked' }
  | { action: 'conflict'; conflictId: string };

async function linkParts(
  client: PoolClient,
  partA: PartRef,
  partB: PartRef,
  source: Source,
  sourceFile: string | null
): Promise<LinkOutcome> {
  const memberAResult = await client.query(
    `SELECT id, group_id FROM cross_reference_members WHERE brand = $1 AND part_number = $2`,
    [partA.brand, partA.partNumber]
  );
  const memberBResult = await client.query(
    `SELECT id, group_id FROM cross_reference_members WHERE brand = $1 AND part_number = $2`,
    [partB.brand, partB.partNumber]
  );

  const memberA = memberAResult.rows[0] as { id: string; group_id: string } | undefined;
  const memberB = memberBResult.rows[0] as { id: string; group_id: string } | undefined;

  // Случай 1: ни одна из двух деталей ещё нигде не встречалась —
  // заводим для них новую группу на двоих
  if (!memberA && !memberB) {
    const groupResult = await client.query(
      `INSERT INTO cross_reference_groups DEFAULT VALUES RETURNING id`
    );
    const groupId = groupResult.rows[0].id;

    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [groupId, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType, source]
    );
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [groupId, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType, source]
    );

    return { action: 'created' };
  }

  // Случай 2: одна из деталей уже состоит в группе — присоединяем
  // вторую к ТОЙ ЖЕ группе
  if (memberA && !memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberA.group_id, partB.brand, partB.partNumber, partB.partNumberRaw, partB.productId, partB.partType, source]
    );
    return { action: 'linked' };
  }

  if (!memberA && memberB) {
    await client.query(
      `INSERT INTO cross_reference_members (group_id, brand, part_number, part_number_raw, product_id, part_type, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [memberB.group_id, partA.brand, partA.partNumber, partA.partNumberRaw, partA.productId, partA.partType, source]
    );
    return { action: 'linked' };
  }

  // Случай 3: обе детали уже где-то состоят
  if (memberA!.group_id === memberB!.group_id) {
    // Уже связаны — новых данных эта связь не добавляет
    return { action: 'already_linked' };
  }

  // Случай 4: КОНФЛИКТ — детали состоят в ДВУХ РАЗНЫХ группах.
  // Слепо сливать группы нельзя (см. комментарий у cross_reference_
  // conflicts в schema.sql) — кладём на ручную проверку администратору
  const conflictResult = await client.query(
    `
    INSERT INTO cross_reference_conflicts
      (part_a_brand, part_a_number, part_b_brand, part_b_number, existing_group_a, existing_group_b, source, source_file)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [partA.brand, partA.partNumber, partB.brand, partB.partNumber, memberA!.group_id, memberB!.group_id, source, sourceFile]
  );

  return { action: 'conflict', conflictId: conflictResult.rows[0].id };
}

// ------------------------------------------------------------
// POST — добавить кросс-номер вручную
// ------------------------------------------------------------
interface CreateCrossReferenceBody {
  crossArticle?: string;
  crossBrand?: string;
  crossPartType?: string;
  source?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'id товара должен быть корректным UUID.' }, { status: 400 });
  }

  let body: CreateCrossReferenceBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const crossArticle = cleanArticle(body.crossArticle);
  const crossBrand = body.crossBrand?.trim();
  const crossPartType = body.crossPartType?.trim() || 'aftermarket';
  const source = body.source?.trim() || MANUAL_SOURCE_DEFAULT;

  if (!crossArticle) {
    return NextResponse.json({ error: 'Укажите кросс-номер.' }, { status: 400 });
  }
  if (!crossBrand) {
    return NextResponse.json({ error: 'Укажите бренд кросс-номера.' }, { status: 400 });
  }
  if (!isValidPartType(crossPartType)) {
    return NextResponse.json(
      { error: `Тип детали должен быть одним из: ${PART_TYPE_VALUES.join(', ')}.` },
      { status: 400 }
    );
  }
  if (!isValidSource(source)) {
    return NextResponse.json(
      { error: `Источник должен быть одним из: ${SOURCE_VALUES.join(', ')}.` },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const productResult = await client.query('SELECT id, article, brand FROM products WHERE id = $1', [id]);
    if (productResult.rows.length === 0) {
      return NextResponse.json({ error: 'Товар с таким id не найден.' }, { status: 404 });
    }
    const product = productResult.rows[0];

    if (!product.brand) {
      return NextResponse.json(
        { error: 'У товара не указан бренд — без него нельзя однозначно определить деталь в модели кроссов.' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const outcome = await linkParts(
      client,
      {
        brand: product.brand,
        partNumber: cleanArticle(product.article),
        partNumberRaw: product.article,
        productId: product.id,
        partType: 'aftermarket',
      },
      {
        brand: crossBrand,
        partNumber: crossArticle,
        partNumberRaw: body.crossArticle?.trim() || crossArticle,
        productId: null,
        partType: crossPartType,
      },
      source,
      null
    );

    await client.query('COMMIT');

    if (outcome.action === 'conflict') {
      return NextResponse.json(
        {
          error:
            `Этот кросс-номер уже состоит в другой группе взаимозаменяемости, отдельной от текущего товара. ` +
            `Конфликт записан для ручной проверки на вкладке "Конфликты" (id: ${outcome.conflictId}).`,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, outcome: outcome.action }, { status: 201 });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // транзакция могла и не начаться — ROLLBACK без BEGIN безопасен, но на всякий случай перехватываем
    }
    console.error('Ошибка при добавлении кросс-номера:', error);
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return NextResponse.json(
      { error: 'Не удалось добавить кросс-номер: ' + message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
