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
import type { DocumentDisplayOptions, OrderDocumentData } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOC_TYPES: DocumentType[] = ['invoice', 'delivery_note', 'return_act'];

function isValidDocType(value: string): value is DocumentType {
  return (DOC_TYPES as string[]).includes(value);
}

type ResolveResult = { data: OrderDocumentData } | { error: NextResponse };

interface ParsedBody {
  returnInput?: ReturnActInput;
  displayOptions?: Partial<DocumentDisplayOptions>;
}

// Тело запроса необязательно для всех трёх типов документа. Для акта
// повернення в нём же (не отдельным запросом) приходят { items:
// [{ article, quantity }], reason } — позиции и причина возврата. Для
// любого типа документа в теле может быть { showArticle, showBrand } —
// какие колонки таблицы показывать (кнопка "Редактировать" в
// components/PrintDocumentsPanel.tsx). Тело читается РОВНО ОДИН раз
// (request.text() нельзя вызвать дважды), поэтому оба набора полей
// разбираются здесь вместе, а не в двух отдельных функциях
async function parseBody(request: Request): Promise<ParsedBody | NextResponse> {
  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return {};
  }
  if (!raw) return {};

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Тело запроса должно быть корректным JSON.' }, { status: 400 });
  }

  const { items, reason, showArticle, showBrand } =
    (body as { items?: unknown; reason?: unknown; showArticle?: unknown; showBrand?: unknown }) || {};

  const result: ParsedBody = {};

  if (typeof showArticle === 'boolean' || typeof showBrand === 'boolean') {
    result.displayOptions = {
      ...(typeof showArticle === 'boolean' ? { showArticle } : {}),
      ...(typeof showBrand === 'boolean' ? { showBrand } : {}),
    };
  }

  if (Array.isArray(items) && items.length > 0) {
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

    result.returnInput = { items: parsedItems, reason: typeof reason === 'string' ? reason.trim() : '' };
  }

  return result;
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

  const parsed = await parseBody(request);
  if (parsed instanceof NextResponse) return { error: parsed };

  if (docTypeParam === 'return_act' && !parsed.returnInput) {
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

  try {
    const data = await buildOrderDocumentData(orderId, docTypeParam, parsed.returnInput, parsed.displayOptions);
    return { data };
  } catch (error) {
    if (error instanceof OrderNotFoundError) {
      return { error: NextResponse.json({ error: 'Заказ с таким id не найден.' }, { status: 404 }) };
    }
    throw error;
  }
}
