// Страница "Карточка клиента" в админ-панели — баланс, лента операций
// и заказы одного клиента. Вся логика — в components/CustomerDetailScreen.tsx
import CustomerDetailScreen from '@/components/CustomerDetailScreen';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetailScreen customerId={id} />;
}
