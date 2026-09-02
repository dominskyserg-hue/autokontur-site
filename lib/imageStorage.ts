// ============================================================
// Куди фізично зберігати вже стиснене фото (WebP, ~100 КБ).
//
// "Сервер/папка /uploads/" із класичного завдання тут НЕ підійде:
// проєкt задеплоєний на Vercel, а файлова система serverless-функцій
// там ЕФЕМЕРНА — все, що функція запише на диск під час одного
// виклику, зникає одразу після його завершення й ніколи не
// віддається наступному відвідувачу. Тому потрібне СПРАВЖНЄ
// сховище — окремий сервіс або база даних, а не локальна папка.
//
// Зараз у проєкті вже є звичка зберігати фото прямо в колонці
// products.image_url як base64 data:-URI (так само робить ручне
// завантаження в адмінці, components/ProductsScreen.tsx) — і саме
// так ця функція працює за замовчуванням: жодного нового сервісу
// підключати не треба, працює одразу "з коробки" на 0$.
//
// ОБМЕЖЕННЯ цього підходу: Supabase на безкоштовному тарифі дає базі
// даних лsomewhat 500 МБ. Якщо на сайті 20 000+ товарів і фото
// знайдеться хоча б для половини з них по ~100 КБ — це вже ~1 ГБ,
// більше ліміту бази. Тому як тільки фото стане реально багато, варто
// перейти на Supabase Storage (окреме файлове сховище, безкоштовний
// ліміт 1 ГБ, НЕ витрачає ліміт самої бази) — нижче лишена готова,
// вимкнена за замовчуванням гілка коду для цього: досить завести два
// секрети (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) в Project
// Settings → API вашого проєкту Supabase, встановити
// "npm install @supabase/supabase-js" і розкоментувати блок нижче —
// решта пайплайна (lib/productImagePipeline.ts) зміниться сама,
// оскільки викликає лише saveImage(), не знаючи, як саме він працює
// ============================================================

export async function saveImage(webpBuffer: Buffer): Promise<string> {
  // ---- Варіант "з коробки", 0$, без налаштувань: base64 у базі ----
  const base64 = webpBuffer.toString('base64');
  return `data:image/webp;base64,${base64}`;

  // ---- Варіант "для масштабу": Supabase Storage (закоментовано) ----
  // Розкоментуйте цей блок і закоментуйте (або видаліть) return вище,
  // коли будете готові підключити окреме сховище:
  //
  // import { createClient } from '@supabase/supabase-js';
  //
  // const supabase = createClient(
  //   process.env.SUPABASE_URL!,
  //   process.env.SUPABASE_SERVICE_ROLE_KEY!
  // );
  //
  // const fileName = `products/${crypto.randomUUID()}.webp`;
  // const { error } = await supabase.storage
  //   .from('product-images')
  //   .upload(fileName, webpBuffer, { contentType: 'image/webp', cacheControl: '31536000' });
  //
  // if (error) throw new Error(`Не вдалося завантажити фото в Supabase Storage: ${error.message}`);
  //
  // const { data } = supabase.storage.from('product-images').getPublicUrl(fileName);
  // return data.publicUrl;
}
