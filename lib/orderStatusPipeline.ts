// ============================================================
// Общая логика для эндпоинтов закупок (app/api/admin/procurement/*) —
// автоматический перевод orders.status вперёд по цепочке в зависимости
// от статусов его order_items, когда очередная позиция ушла в закупку
// у поставщика или пришла на склад.
//
// НЕ трогает заказы, которые уже отменены или отгружены (это тупиковые
// состояния для этой функции — из них дальше двигать нечего), и никогда
// не двигает статус НАЗАД: используется "ранг" статуса в цепочке,
// обновление применяется только если новый статус дальше текущего.
//
// Переход в 'shipped' сюда намеренно НЕ входит — финальная отгрузка
// сделана отдельным, куда более строгим шагом прямо в
// PATCH /api/orders/[id] (там же и списание склада, и начисление на
// баланс клиента, см. функцию shipOrder в этом файле)
// ============================================================

import type { PoolClient } from 'pg';

const STATUS_RANK: Record<string, number> = {
  new: 0,
  processing: 1,
  ordered_from_supplier: 2,
  in_stock: 3,
  ready_for_pickup: 4,
  shipped: 5,
  cancelled: -1, // тупиковое состояние, не участвует в продвижении вперёд
};

// Вызывать ВНУТРИ уже открытой транзакции (client — то же соединение,
// на котором только что менялся статус order_items), после каждого
// изменения статуса позиций заказа
export async function autoAdvanceOrderStatus(client: PoolClient, orderId: string): Promise<void> {
  const orderResult = await client.query<{ status: string }>('SELECT status FROM orders WHERE id = $1', [orderId]);
  const currentStatus = orderResult.rows[0]?.status;
  if (!currentStatus || currentStatus === 'cancelled' || currentStatus === 'shipped') return;

  // 'returned' сюда не должен попадать на этом этапе пайплайна (возврат
  // возможен только после отгрузки), но исключаем его на всякий случай
  // той же логикой, что и 'cancelled' — обе позиции не участвуют в
  // определении готовности заказа
  const itemsResult = await client.query<{ status: string }>(
    `SELECT status FROM order_items WHERE order_id = $1 AND status NOT IN ('cancelled', 'returned')`,
    [orderId]
  );
  const statuses = itemsResult.rows.map((row) => row.status);
  if (statuses.length === 0) return;

  let target: string | null = null;
  if (statuses.every((s) => s === 'in_stock' || s === 'shipped')) {
    target = 'in_stock';
  } else if (!statuses.includes('pending')) {
    // Не осталось позиций "pending" — значит все либо уже заказаны у
    // поставщика, либо ушли дальше по цепочке
    target = 'ordered_from_supplier';
  }

  if (target && STATUS_RANK[target] > STATUS_RANK[currentStatus]) {
    await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [orderId, target]);
  }
}
