// ============================================================
// Бейдж статуса оплаты заказа — используется и в списке заказов
// (components/OrdersScreen.tsx), и в карточке заказа
// (components/OrderDetailsModal.tsx), поэтому вынесен в общий файл,
// а не продублирован в обоих местах.
//
// Считается от paidAmount (сумма движений кассы по заказу,
// app/api/orders/[id]/route.ts и app/api/orders/route.ts) —
// частичная оплата отдельный, третий вариант, а не просто "да/нет"
// ============================================================

import { formatMoney } from '@/lib/orderUi';

export default function PaymentBadge({
  paidAmount,
  totalAmount,
}: {
  paidAmount: number;
  totalAmount: number;
}) {
  const EPSILON = 0.01;

  if (paidAmount <= EPSILON) {
    return (
      <span
        className="text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ background: '#3A1E22', color: '#F2635F' }}
      >
        Не оплачено
      </span>
    );
  }

  if (paidAmount + EPSILON >= totalAmount) {
    return (
      <span
        className="text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap"
        style={{ background: '#12301F', color: '#3FBE8B' }}
      >
        Оплачено
      </span>
    );
  }

  return (
    <span
      className="text-[11px] px-2 py-1 rounded-full font-medium whitespace-nowrap"
      style={{ background: '#3A2A16', color: '#F2A65A' }}
      title={`Оплачено ${formatMoney(paidAmount)} из ${formatMoney(totalAmount)} грн`}
    >
      Оплачено частично
    </span>
  );
}
