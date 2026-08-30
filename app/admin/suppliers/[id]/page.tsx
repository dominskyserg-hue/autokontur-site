// Страница "Поставщик" — детальная карточка одного поставщика и
// каталог его товаров (редактирование цены/остатка, удаление).
// Вся логика — в components/SupplierProductsScreen.tsx
import SupplierProductsScreen from '@/components/SupplierProductsScreen';

// Next.js 15: params у страницы — это Promise, поэтому его нужно
// дождаться через await, а сам компонент страницы — async-функция
export default async function SupplierDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <SupplierProductsScreen supplierId={id} />;
}
