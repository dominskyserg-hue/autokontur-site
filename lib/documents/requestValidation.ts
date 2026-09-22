// ============================================================
// Общая проверка входных данных для всех трёх роутов
// app/api/orders/[id]/documents/[docType]/{preview,download,save}/route.ts —
// вынесена сюда, а не продублирована в каждом файле (как обычно
// принято в этом проекте для простых проверок вроде isValidUuid),
// потому что здесь проверка составная: id заказа, тип документа И,
// для акта повернення, ещё и тело запроса с позициями возврата.
// ============================================================

import { NextResponse } from 'next/server';
import { buildOrderDocumentData, OrderNotFoundError, type ReturnActInput } from './orderDocumentData';
import { hasExistingDocument, type DocumentType } from './numbering';
import type { OrderDocumentData } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_TYPES: DocumentType[] = ['invoice', 'delivery_note', 'return_act'];

function isValidDocType(value: string): value is DocumentType {
  return (DOC_TYPES as string[]).includes(value);
}

type ResolveResult = { data: OrderDocumentData } | { error: NextResponse };

// Тело запроса используется только для акта повернення: { items:
// [{ article, quantity }], reason }. Для рахунку и накладной тело
// не нужно вовсе — оба документа полностью выводятся из самого
// заказа, тело запроса в этих случаях просто игнорируется
async function parseReturnInput(request: Request): Promise<ReturnActInput | undefined | NextResponse> {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const { items, reason } = (body as { items?: unknown; reason?: unknown }) || {};
  if (!Array.isArray(items) || items.length === 0) return undefined;

  const parsedItems = items
    .filter(
      (item): item is { article: string; quantity: number } =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).article === 'string' &&
        Number.isFinite((item as Record<string, unknown>).quantity) &&
        ((item as Record<string, unknown>).quantity as number) > 0
    )
    .map((item) => ({ article: item.article, quantity: Math.floor(item.quantity) }));

  if (parsedItems.length === 0) {
    return NextResponse.json({ error: 'Не удалось распознать список позиций для возврата.' }, { status: 400 });
  }

  return { items: parsedItems, reason: typeof reason === 'string' ? reason.trim() : '' };
}

export async function resolveDocumentData(
  orderId: string,
  docTypeParam: string,
  request: Request
): Promise<ResolveResult> {
  if (!UUID_PATTERN.test(orderId)) {
    return { error: NextResponse.json({ error: 'id заказа должен быть корректным UUID.' }, { status: 400 }) };
  }
  if (!isValidDocType(docTypeParam)) {
    return {
      error: NextResponse.json(
        { error: `Неизвестный тип документа. Допустимые значения: ${DOC_TYPES.join(', ')}.` },
        { status: 400 }
      ),
    };
  }

  let returnInput: ReturnActInput | undefined;
  if (docTypeParam === 'return_act') {
    const parsed = await parseReturnInput(request);
    if (parsed instanceof NextResponse) return { error: parsed };
    returnInput = parsed;

    if (!returnInput) {
      const alreadyExists = await hasExistingDocument(orderId, 'return_act');
      if (!alreadyExists) {
        return {
          error: NextResponse.json(
            {
              error:
                'Для первого формирования акта возврата укажите список позиций (items) и причину возврата (reason).',
            },
            { status: 400 }
          ),
        };
      }
    }
  }

  try {
    const data = await buildOrderDocumentData(orderId, docTypeParam, returnInput);
    return { data };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { error: NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 }) };
    }
    throw error;
  }
}
