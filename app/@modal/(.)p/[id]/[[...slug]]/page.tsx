// ============================================================
// Перехоплений маршрут (Next.js Intercepting Routes) — той самий
// товар, що й на app/p/[id]/[[...slug]]/page.tsx, але показаний як
// модальне вікно поверх каталогу, а не окрема сторінка.
//
// "(.)" у назві папки означає "перехопити маршрут на ТОМУ Ж РІВНІ" —
// тобто папку "p" в app/p, яка лежить поруч з app/@modal (обидві —
// прямі підпапки app/). Спрацьовує для кліку по товару з ГОЛОВНОЇ,
// з категорії (/category/[slug]) чи з марки (/marky/[make]) — усі
// вони теж лежать прямо в app/, під тим самим кореневим layout.tsx,
// що й app/@modal. Перехоплення працює ЛИШЕ при переході по
// посиланню всередині сайту (клік по <Link>) — коли Next.js сам
// робить клієнтську навігацію і вирішує, який маршрут показати в
// слоті app/@modal.
//
// При ПРЯМОМУ відкритті адреси /p/[id]/[[...slug]] (нове
// перезавантаження сторінки, посилання з Google, "Поділитись") цей
// файл НЕ використовується — Next.js віддає повну сторінку
// app/p/[id]/[[...slug]]/page.tsx, як і раніше. Тобто для Google та
// прямих посилань нічого не змінилося: та сама сторінка, той самий
// canonical, той самий контент — просто на сайті замість переходу
// зі сторінки покупець бачить той самий вміст у вікні поверх каталогу
// ============================================================

import { loadProductPageData } from '@/lib/productDetail';
import ProductDetailContent from '@/components/ProductDetailContent';
import ProductModalShell from '@/components/ProductModalShell';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PageParams = { id: string; slug?: string[] };

export default async function ProductModal({ params }: { params: Promise<PageParams> }) {
  const { id, slug } = await params;
  const data = await loadProductPageData(id, slug);

  return (
    <ProductModalShell>
      <ProductDetailContent {...data} />
    </ProductModalShell>
  );
}
