// Страница "Финансы поставщика" — долг, лента операций, накладные.
// Вся логика — в components/SupplierFinanceScreen.tsx
import SupplierFinanceScreen from '@/components/SupplierFinanceScreen';

export default async function SupplierFinancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierFinanceScreen supplierId={id} />;
}
