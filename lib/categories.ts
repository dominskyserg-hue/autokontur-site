// ============================================================
// Довідник категорій деталей для SEO-сторінок /category/[slug].
//
// У товарів (таблиця products) НЕМАЄ окремого поля "категорія" —
// є лише вільний текст у полі name, який поставщик прислав у своєму
// прайсі (наприклад "Колодки гальмівні передні Toyota Camry"). Тому
// категорія товару визначається "на льоту", у момент запиту, пошуком
// ключових слів у name — без міграції бази й без ручної розмітки
// тисяч товарів.
//
// matchGroups — масив ГРУП ключових слів. Товар потрапляє в
// категорію, якщо його name містить ХОЧА Б ОДНЕ слово З КОЖНОЇ групи
// (групи об'єднані через "І", слова всередині групи — через "АБО").
// Наприклад, для "Гальмівні диски": [["диск"], ["гальм", "тормоз"]] —
// підходить "Диск гальмівний передній" і "Тормозной диск", але НЕ
// підходить просто "Диск зчеплення" (немає слова про гальма).
//
// Це проста евристика, а не точна класифікація — з часом, коли
// товарів стане багато, її можна замінити на окреме поле category в
// базі (заповнюване при завантаженні прайсу), а ці ж matchGroups
// використати як стартові правила автоматичного розпізнавання.
// ============================================================

export interface CategoryDef {
  slug: string;
  name: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  intro: string;
  matchGroups: string[][];
  // Назва категорії (name) — завжди у множині, бо так природно
  // називається РОЗДІЛ каталогу ("Амортизатори", "Гальмівні диски").
  // Але для назви ОДНОГО товару (buildSeoProductName, lib/productDetail.ts
  // — H1/title/JSON-LD на сторінці товару) множина часто звучить
  // неправильно: "Амортизатори MONROE D8019" — товар один, а не
  // декілька. itemName — форма однини САМЕ для такого випадку;
  // категорії, де множина природна й для одного товару теж (напр.
  // "Гальмівні колодки" — завжди продаються комплектом), itemName не
  // задають, і тоді береться просто name
  itemName?: string;
  // Слова, з якими товар ВИКЛЮЧАЄТЬСЯ з категорії, навіть якщо він
  // пройшов matchGroups (substring будь-де в назві). Потрібно, бо
  // прості ключові слова матчаться занадто широко: "амортизатор"
  // матчить не лише самі амортизатори, а й "Втулку амортизатора",
  // "Опору амортизатора", "Пильник амортизатора" — це геть інші
  // деталі (втулки/опори/пильники), які лиш ЗГАДУЮТЬ амортизатор у
  // своїй назві. Без цього поля перша сторінка "Амортизатори" (за
  // популярністю) складалась ЦІЛКОМ із таких супутніх деталей, а не
  // з самих амортизаторів — перевірено прямим запитом до бойової бази
  excludeWords?: string[];
  // true — не показувати цю категорію в загальній сітці /category та у
  // блоці "Інші категорії" на сторінках категорій. Використовується для
  // вузьких пріоритетних SEO-сторінок (напр. "Гальмівні колодки передні
  // Daewoo Lanos") — вони й так вузько націлені на конкретний запит, і
  // серед 14+ широких категорій виглядали б засмічуючим шумом. Сторінка
  // при цьому лишається повністю робочою і індексованою — просто
  // посилання на неї винесено в окремий блок "Швидкий пошук за моделлю
  // авто" внизу /category (див. app/category/page.tsx), а не в основну сітку
  hideFromIndex?: boolean;

  // ---- Поля для крос-лінків між сторінками (components/CategoryCrossLinks.tsx) ----
  // modelGroup/modelLabel — вузькі сторінки під ОДНУ Й ТУ Ж машину
  // (напр. "Pajero II кульові опори" і "Pajero II амортизатори")
  // об'єднані однаковим modelGroup — це дає блок "Інші запчастини
  // для {modelLabel}" на сторінці. Широкі категорії це поле не
  // заповнюють — у них немає "своєї" машини
  modelGroup?: string;
  modelLabel?: string;
  // parentCategorySlug — slug ШИРОКОЇ категорії, чиїм вузьким
  // варіантом (по типу деталі, а не по машині) є ця сторінка —
  // напр. у "halmivni-kolodky-peredni" це "halmivni-kolodky". Дає
  // зворотній блок "Популярні моделі" на сторінці широкої категорії.
  // Не в усіх вузьких сторінок є такий батько — деякі націлені на
  // деталь, для якої ще немає своєї широкої категорії (напр.
  // "Решітка бампера" чи "Кільця поршневі") — тоді поле просто не
  // заповнюється, це нормально
  parentCategorySlug?: string;

  // ---- Підбір авто через індекс сумісності TecDoc (замість тексту в назві) ----
  // Хвилі 1-4 (Lanos/Camry/Corolla/Pajero/Mazda6...) фільтрували модель
  // авто підрядком прямо в matchGroups (напр. ['pajero ii ']) — це
  // працювало, бо ті постачальники самі писали модель у назві товару.
  // Хвиля 6 (Autohelp/HLOD) — постачальник моделі в назві НЕ пише
  // ("Колодки гальмівні дискові передні STELLOX ...", без слова
  // "Passat" чи "Golf"), тому підрядком у назві такі товари підібрати
  // неможливо. tecdocVehicle — альтернативний спосіб: товар підходить,
  // якщо ЙОГО бренд+артикул є в tecdoc_compatibility для вказаних
  // make+models (масив, бо одна "модель" з погляду покупця часто
  // складається з кількох записів TecDoc — напр. Stufenheck+Variant).
  // matchGroups при цьому лишається — він і далі визначає лише ТИП
  // деталі (колодки/прокладки/...), а не марку авто. Обидва фільтри
  // діють одночасно (І) — див. buildCategoryWhereClause нижче
  tecdocVehicle?: { make: string; models: string[] };
}

export const CATEGORIES: CategoryDef[] = [
  {
    slug: 'halmivni-kolodky',
    name: 'Гальмівні колодки',
    h1: 'Гальмівні колодки — купити з доставкою по Україні',
    metaTitle: 'Гальмівні колодки купити — оригінал і аналоги | DominatorParts',
    metaDescription:
      'Гальмівні колодки для Toyota, Ford, Volkswagen, Audi, Skoda та інших марок. Оригінал та перевірені аналоги, доставка по всій Україні.',
    intro:
      'Гальмівні колодки — деталь, яку не можна відкладати "на потім": від них напряму залежить безпека. У нас є колодки під передню і задню вісь для Toyota, Ford та автомобілів групи VAG (Volkswagen, Audi, Skoda) — знайдіть потрібні за артикулом або маркою авто.',
    matchGroups: [['колодк']],
    // Перевірено запитом до бази: "Трос ручного гальма ... (барабанні
    // колодки)" і "Датчик гальм.колодк ..." теж містять "колодк", але
    // це трос і датчик — не самі колодки. "з датчиком"/"без датчика"
    // (звичайний опис комплектації самих колодок) під excludeWords НЕ
    // підпадає — виключена саме фраза "датчик гальм", а не голе "датчик"
    excludeWords: ['трос', 'датчик гальм'],
  },
  {
    slug: 'halmivni-dysky',
    name: 'Гальмівні диски',
    h1: 'Гальмівні диски — купити з доставкою по Україні',
    metaTitle: 'Гальмівні диски купити — вентильовані та суцільні | DominatorParts',
    metaDescription:
      'Гальмівні диски для Toyota, Ford, Volkswagen, Audi, Skoda. Вентильовані та суцільні, передні й задні. Доставка по Україні.',
    intro:
      'Гальмівні диски від перевірених постачальників — вентильовані та суцільні, під конкретну марку й модель авто. Разом з дисками зазвичай варто одразу міняти і колодки — дивіться відповідну категорію вище.',
    matchGroups: [['диск'], ['гальм', 'тормоз']],
    itemName: 'Гальмівний диск',
    // "Колодки гальмівні ДИСКОВІ" (тип колодок, а не диск) теж проходить
    // matchGroups — слово "дискові" містить підрядок "диск". Перевірено
    // запитом до бази: більше половини (5045 з 9408) товарів, що
    // матчились під "Гальмівні диски", насправді були колодками, тросами
    // чи датчиками, а не самими дисками
    // "Захист гальмівного диска" — захисний кожух/пилозахисний диск,
    // а не сам гальмівний диск
    excludeWords: ['колодк', 'трос', 'датчик гальм', 'шланг', 'захист', 'защит'],
  },
  {
    slug: 'amortyzatory',
    name: 'Амортизатори',
    h1: 'Амортизатори — купити з доставкою по Україні',
    metaTitle: 'Амортизатори купити — передні та задні | DominatorParts',
    metaDescription:
      'Амортизатори для Toyota, Ford, Volkswagen, Audi, Skoda. Передні та задні, газо-масляні та газові. Доставка по всій Україні.',
    intro:
      'Амортизатори впливають і на керованість, і на комфорт — стукіт чи "провал" підвіски на нерівностях зазвичай означає, що їх пора міняти. Підберіть амортизатори за артикулом або маркою й моделлю авто.',
    matchGroups: [['амортизатор']],
    itemName: 'Амортизатор',
    // Перевірено запитом до бази: без цього списку перша сторінка
    // категорії (за популярністю) складалась ЦІЛКОМ із супутніх
    // деталей — втулок, опор, відбійників, пильників, підшипників
    // амортизатора, а не самих амортизаторів. "Амортизатор багажника"
    // (газовий упор кришки багажника) — теж інший товар, не підвіска
    excludeWords: [
      'втулк',
      'подушк',
      'відбійник',
      'отбойник',
      'опор',
      'підшипник',
      'подшипник',
      'пильник',
      'пильовик',
      'пыльник',
      'сайлентблок',
      'багажник',
      'кільце',
      'шайба',
      'захисний',
      'захисн',
      'кронштейн',
      'кожух',
    ],
  },
  {
    slug: 'sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля',
    h1: 'Сайлентблоки важеля підвіски — купити з доставкою',
    metaTitle: 'Сайлентблоки важеля купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски для Toyota, Ford, Volkswagen, Audi, Skoda. Оригінал і аналоги, доставка по Україні.',
    intro:
      'Стук у передній підвісці на нерівностях і ямах — типова ознака зношених сайлентблоків важеля. Тут зібрані сайлентблоки під популярні моделі Toyota, Ford та автомобілів групи VAG.',
    matchGroups: [['сайлентблок']],
    itemName: 'Сайлентблок важеля',
  },
  {
    slug: 'vtulky-stabilizatora',
    name: 'Втулки стабілізатора',
    h1: 'Втулки стабілізатора — купити з доставкою по Україні',
    metaTitle: 'Втулки стабілізатора купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Втулки стабілізатора поперечної стійкості для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      'Втулки стабілізатора — недорога деталь, яка часто стає джерелом стуку та "гуляння" керма на швидкості. Знайдіть потрібні втулки за маркою авто або артикулом.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз']],
    itemName: 'Втулка стабілізатора',
    // "Пильовик втулки стабілізатора" — захисний чохол, а не сама втулка
    excludeWords: ['пильовик', 'пильник'],
  },
  {
    slug: 'kulovi-opory',
    name: 'Кульові опори',
    h1: 'Кульові опори — купити з доставкою по Україні',
    metaTitle: 'Кульова опора купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Кульові опори підвіски для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      "Кульова опора з'єднує важіль підвіски зі ступицею — люфт у ній напряму впливає на керованість і знос шин. Підберіть опору за артикулом або маркою автомобіля.",
    matchGroups: [
      ['куль', 'шаров'],
      ['опор'],
    ],
    excludeWords: ['пильовик', 'пильник'],
    itemName: 'Кульова опора',
  },
  {
    slug: 'vazheli-pidvisky',
    name: 'Важелі підвіски',
    h1: 'Важелі підвіски — купити з доставкою по Україні',
    metaTitle: 'Важіль підвіски купити — Nissan, Toyota, Mazda | DominatorParts',
    metaDescription:
      'Важелі (рычаги) підвіски для Nissan, Toyota, Mazda, Mitsubishi та інших азійських марок. Доставка по всій Україні.',
    intro:
      "Важіль підвіски з'єднує кузов автомобіля з колесом — стук чи люфт у ньому напряму впливають на керованість і рівномірний знос шин. Підберіть важіль за артикулом або маркою й моделлю авто.",
    // Другу групу ['підвіск', 'подвес'] додано навмисно: сам по собі
    // корінь "важіл"/"рычаг" ловить і сайлентблоки/опори важеля
    // (напр. "Сайлентблок рычага", "Опора рычага шаровая") — і навіть
    // геть чужі деталі на кшталт "Важіль склоочисника" (двірники) чи
    // "Важіль зчеплення" (зчеплення). Вимога другого слова про
    // підвіску прибирає майже весь цей шум (залишає ~4400 товарів
    // замість ~9900, з часткою хибних збігів ~4% замість ~28%)
    matchGroups: [
      ['рычаг', 'важіл'],
      ['підвіск', 'подвес'],
    ],
    itemName: 'Важіль підвіски',
    // "Сайлентблок рычага задней подвески" — сайлентблок важеля, для
    // нього вже є окрема категорія sailentbloky-vazhelia; тут це не
    // сам важіль, а деталь до нього (148 товарів, перевірено запитом)
    excludeWords: ['сайлентблок'],
  },
  {
    slug: 'pidshypnyky-matochyny',
    name: 'Підшипники маточини',
    h1: 'Підшипники маточини колеса — купити з доставкою',
    metaTitle: 'Підшипник маточини купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Підшипники маточини колеса для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      'Гул чи "виття" з боку колеса на швидкості — найчастіша ознака зношеного підшипника маточини. У наявності підшипники під популярні моделі Toyota, Ford та групи VAG.',
    matchGroups: [['маточин', 'ступичн']],
    itemName: 'Підшипник маточини',
    // "Болт кріплення маточини", "Гайка маточини", "Шайба ступичного
    // подшипника" — це кріпильні деталі, а не сам підшипник. Без цього
    // H1 товару міг назвати гайку "Підшипник маточини..." — покупець
    // замовить не те, що отримає (перевірено запитом до бази: 27
    // товарів)
    excludeWords: ['болт', 'гайка', 'шайба'],
  },
  {
    slug: 'oliyni-filtry',
    name: 'Оливні фільтри',
    h1: 'Оливні (масляні) фільтри — купити з доставкою',
    metaTitle: 'Оливний фільтр купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription: 'Оливні (масляні) фільтри для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по Україні.',
    intro:
      'Оливний фільтр міняють при кожному ТО разом з моторною оливою — деталь недорога, але критична для ресурсу двигуна.',
    matchGroups: [
      ['фільтр', 'фильтр'],
      ['олив', 'масл'],
    ],
    // "Прокладка масляного фільтра" і "Кришка масляного фільтра" —
    // це прокладка/кришка корпусу, а не сам фільтр
    excludeWords: ['прокладк', 'кришка', 'крышка'],
    itemName: 'Оливний фільтр',
  },
  {
    slug: 'povitryani-filtry',
    name: 'Повітряні фільтри',
    h1: 'Повітряні фільтри двигуна — купити з доставкою',
    metaTitle: 'Повітряний фільтр купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription: 'Повітряні фільтри двигуна для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по Україні.',
    intro:
      'Забитий повітряний фільтр збільшує витрату палива і знижує тягу двигуна. Міняється зазвичай раз на 15–20 тис. км або за регламентом ТО.',
    matchGroups: [
      ['фільтр', 'фильтр'],
      ['повітр', 'воздушн'],
    ],
    // "Кільце ущільн. між патрубком і корпусом повітр. фільтра" і
    // "Шпилька, корпус повітряного фільтра" — кріплення/ущільнення
    // корпусу, а не сам фільтр
    excludeWords: ['кільц', 'кольц', 'шпильк'],
    itemName: 'Повітряний фільтр',
  },
  {
    slug: 'salonni-filtry',
    name: 'Салонні фільтри',
    h1: 'Салонні фільтри — купити з доставкою по Україні',
    metaTitle: 'Салонний фільтр купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription: 'Салонні фільтри (в т.ч. вугільні) для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по Україні.',
    intro:
      'Салонний фільтр відповідає за чистоту повітря в салоні — його рекомендують міняти щонайменше раз на рік або кожні 15 тис. км.',
    matchGroups: [
      ['фільтр', 'фильтр'],
      ['салон'],
    ],
    itemName: 'Салонний фільтр',
  },
  {
    slug: 'svichky-zapaliuvannia',
    name: 'Свічки запалювання',
    h1: 'Свічки запалювання — купити з доставкою по Україні',
    metaTitle: 'Свічки запалювання купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription: 'Свічки запалювання для бензинових двигунів Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по Україні.',
    intro:
      'Зношені свічки запалювання — часта причина нестабільної роботи двигуна на холостому ходу та підвищеної витрати палива.',
    matchGroups: [['свіч', 'свеч']],
    // "Свічка розжарювання" (для дизельних двигунів) — зовсім інша
    // деталь, ніж "Свічка запалювання" (бензинові двигуни), але теж
    // містить підрядок "свіч". Перевірено запитом до бази: 757 таких
    // товарів
    excludeWords: ['розжар', 'накал'],
    itemName: 'Свічка запалювання',
  },
  {
    slug: 'remeni-rolyky-grm',
    name: 'Ремені та ролики ГРМ',
    h1: 'Комплекти ГРМ: ремені та ролики — купити з доставкою',
    metaTitle: 'Ремінь і ролики ГРМ купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Ремені, ролики та натяжувачі ГРМ для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      'Обрив ременя ГРМ на моторах з клапанами, що зустрічаються з поршнями, — це капітальний ремонт двигуна. Міняйте ремінь і ролики строго за регламентом виробника.',
    matchGroups: [['грм']],
    // Категорія — саме "Ремені ТА РОЛИКИ ГРМ", а не будь-яка деталь
    // системи ГРМ. Прокладки кришки ГРМ, шестерні і самі кришки ГРМ —
    // геть інші деталі, які лиш згадують абревіатуру "ГРМ" у назві
    excludeWords: ['прокладк', 'шестерня', 'кришка', 'крышка'],
  },
  {
    slug: 'motorni-olyvy',
    name: 'Моторні оливи',
    h1: 'Моторні оливи — купити з доставкою по Україні',
    metaTitle: 'Моторна олива купити — оригінальна для ТО | DominatorParts',
    metaDescription: 'Моторні оливи для планового ТО Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      "Моторна олива — основа будь-якого планового ТО. Підбирайте в'язкість і допуск строго за сервісною книжкою вашого автомобіля.",
    matchGroups: [
      ['олив', 'масло'],
      ['мотор'],
    ],
    itemName: 'Моторна олива',
    // "Присадка в моторне масло" — хімічна добавка ДО оливи, інший товар
    excludeWords: ['присадк'],
  },
  {
    slug: 'kermove-upravlinnya',
    name: 'Кермове управління',
    h1: 'Кермове управління — рульові рейки, наконечники, тяги',
    metaTitle: 'Рульова рейка, наконечники тяг купити — Toyota, Ford, VAG | DominatorParts',
    metaDescription:
      'Рульові рейки, наконечники та тяги керма для Toyota, Ford, Volkswagen, Audi, Skoda. Доставка по всій Україні.',
    intro:
      "Стук або люфт у кермі, важке керування чи витік гідропідсилювача — типові ознаки зношених деталей рульового управління. У наявності рульові рейки, наконечники й тяги під популярні моделі Toyota, Ford та автомобілів групи VAG.",
    matchGroups: [['рульов', 'кермов']],
    // Пильовики, сальники й сайлентблоки рульової рейки/тяги — дрібні
    // супутні деталі, а не самі рейки/наконечники/тяги, які обіцяє
    // назва категорії (перевірено запитом до бази: 224 з 8064 товарів)
    excludeWords: ['пильовик', 'пильник', 'сальник', 'сайлентблок'],
  },

  // ============================================================
  // ПРІОРИТЕТНІ SEO-СТОРІНКИ — вузькі, низькоконкурентні запити з
  // підтвердженим попитом (Google Ads Keyword Planner) і підтвердженою
  // наявністю товару в постачальників. Мета — перші органічні
  // замовлення з конкретних запитів, а не загальне охоплення.
  //
  // На відміну від категорій вище, тут частина записів — це ще й
  // ФІЛЬТР ЗА МОДЕЛЛЮ авто (Lanos, Camry, Passat B5, Golf 4), а не
  // лише за типом деталі. products.car_make/car_model у постачальників
  // цих товарів НЕ заповнені (порожні), тому фільтр по моделі, як і
  // по типу деталі вище, — пошук кореня слова прямо в назві товару
  // (matchGroups), а не по окремому полю бази.
  //
  // "Від X грн" у title/description нижче — це РЕАЛЬНА перевірена
  // ціна конкретного товару в наявності на момент написання (перевірено
  // прямим запитом до бойової бази), а НЕ значення, яке рахується наживо
  // при кожному відкритті сторінки. Якщо асортимент чи ціни суттєво
  // зміняться — цифру варто буде оновити вручну (це звичайний текстовий
  // рядок, як і решта metaTitle/metaDescription у цьому файлі).
  // ============================================================

  {
    slug: 'halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні',
    h1: 'Гальмівні колодки передні — купити з доставкою по Україні',
    metaTitle: 'Гальмівні колодки передні купити — оригінал і аналоги | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні для Toyota, Ford, Volkswagen, Daewoo та інших марок. Оригінал та перевірені аналоги, доставка по всій Україні.',
    intro:
      'Передні гальмівні колодки зношуються швидше задніх — саме передня вісь бере на себе основне гальмівне навантаження при гальмуванні. У наявності колодки під популярні моделі Toyota, Ford, Daewoo та автомобілів групи VAG.',
    matchGroups: [['колодк'], ['перед']],
    hideFromIndex: true,
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні',
    h1: 'Гальмівні колодки задні — купити з доставкою по Україні',
    metaTitle: 'Гальмівні колодки задні купити — оригінал і аналоги | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні (дискові та барабанні) для Toyota, Ford, Volkswagen, Daewoo та інших марок. Доставка по всій Україні.',
    intro:
      'Задні гальмівні колодки — дискові або барабанні, залежно від моделі авто. Підберіть потрібні за артикулом або маркою автомобіля.',
    matchGroups: [['колодк'], ['зад']],
    hideFromIndex: true,
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'halmivna-ridyna',
    name: 'Гальмівна рідина',
    h1: 'Гальмівна рідина — купити з доставкою по Україні',
    metaTitle: 'Гальмівна рідина купити — DOT 3, DOT 4 | DominatorParts',
    metaDescription:
      'Гальмівна рідина DOT 3, DOT 4 від BREMBO, HELLA PAGID та інших виробників. В наявності, доставка по всій Україні, оплата при отриманні.',
    intro:
      "Гальмівну рідину рекомендують міняти раз на 1-2 роки — вона гігроскопічна і з часом вбирає вологу, що знижує ефективність гальмування. У наявності рідина від перевірених виробників.",
    matchGroups: [
      ['рідина', 'жидкост'],
      ['гальм', 'тормоз'],
    ],
    hideFromIndex: true,
  },
  {
    slug: 'halmivna-ridyna-dot4',
    name: 'Гальмівна рідина DOT 4',
    h1: 'Гальмівна рідина DOT 4 — купити з доставкою',
    metaTitle: 'Гальмівна рідина DOT 4 купити | DominatorParts',
    metaDescription:
      'Гальмівна рідина DOT 4 від BREMBO, HELLA PAGID в наявності. Підходить для більшості легкових авто. Доставка по всій Україні.',
    intro:
      'DOT 4 — найпоширеніший тип гальмівної рідини для сучасних легкових авто, сумісний з DOT 3. У наявності рідина DOT4 від BREMBO та HELLA PAGID.',
    matchGroups: [
      ['рідина', 'жидкост'],
      ['гальм', 'тормоз'],
      ['dot4', 'dot 4', 'dot-4'],
    ],
    hideFromIndex: true,
    parentCategorySlug: 'halmivna-ridyna',
  },

  // ---- Daewoo Lanos (підтверджено в наявності) ----
  {
    slug: 'lanos-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Daewoo Lanos',
    h1: 'Гальмівні колодки передні Daewoo Lanos',
    metaTitle: 'Колодки передні Lanos від 333 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові передні Daewoo Lanos, Matiz в наявності від 333 грн (RAISO). Оригінал і аналоги, доставка по Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Daewoo Lanos (і Matiz з тим самим кріпленням) — в наявності декілька варіантів різних виробників, від бюджетних до преміальних.',
    matchGroups: [['колодк'], ['перед'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'lanos-amortyzatory-peredni',
    name: 'Амортизатор передній Daewoo Lanos',
    h1: 'Амортизатор передній Daewoo Lanos',
    metaTitle: 'Амортизатор передній Lanos від 1035 грн | DominatorParts',
    metaDescription:
      'Амортизатор передній Daewoo Lanos, Nexia в наявності від 1035 грн (Magnum Technology). Доставка по Україні, оплата при отриманні.',
    intro: 'Передній амортизатор для Daewoo Lanos — газо-масляний, підходить і для Nexia з тією ж платформою.',
    matchGroups: [['амортизатор'], ['перед'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'lanos-amortyzatory-zadni',
    name: 'Амортизатор задній Daewoo Lanos',
    h1: 'Амортизатор задній Daewoo Lanos',
    metaTitle: 'Амортизатор задній Lanos від 602 грн | DominatorParts',
    metaDescription:
      'Амортизатор задній Daewoo Lanos, Nexia, Sens в наявності від 602 грн (RAISO). Оригінал і аналоги, доставка по Україні.',
    intro: 'Задній амортизатор для Daewoo Lanos — газовий, в наявності декілька виробників на вибір.',
    matchGroups: [['амортизатор'], ['зад'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'lanos-vtulky-stabilizatora',
    name: 'Втулки стабілізатора Daewoo Lanos',
    h1: 'Втулки стабілізатора Daewoo Lanos',
    metaTitle: 'Втулки стабілізатора Lanos від 12 грн | DominatorParts',
    metaDescription:
      'Втулки стабілізатора передньої підвіски Daewoo Lanos в наявності від 12 грн (BCGUMA). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Недорога, але часто зношувана деталь — стук і "гуляння" керма на нерівностях зазвичай означає, що втулки стабілізатора Lanos пора міняти.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
    parentCategorySlug: 'vtulky-stabilizatora',
  },
  {
    slug: 'lanos-komplekt-grm',
    name: 'Комплект ГРМ Daewoo Lanos',
    h1: 'Комплект ГРМ Daewoo Lanos',
    metaTitle: 'Комплект ГРМ Lanos від 1968 грн | DominatorParts',
    metaDescription:
      'Комплект ГРМ (ремінь + ролики) для Daewoo Lanos в наявності від 1968 грн (Michelin). Доставка по Україні, оплата при отриманні.',
    intro: 'Комплект ГРМ для Daewoo Lanos — ремінь і ролики одразу, за регламентом виробника міняються разом.',
    matchGroups: [['грм'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
    parentCategorySlug: 'remeni-rolyky-grm',
  },
  {
    slug: 'lanos-stseplennia',
    name: 'Комплект зчеплення Daewoo Lanos',
    h1: 'Комплект зчеплення Daewoo Lanos',
    metaTitle: 'Комплект зчеплення Lanos від 2970 грн | DominatorParts',
    metaDescription:
      'Комплект зчеплення (диск + кошик + вижимний) Daewoo Lanos 1.5 в наявності від 2970 грн (KONNER). Доставка по Україні.',
    intro: 'Повний комплект зчеплення для Daewoo Lanos 1.5 — диск, кошик і вижимний підшипник одним набором.',
    matchGroups: [['зчеплен'], ['lanos', 'ланос']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
  },

  // ---- Toyota Camry (підтверджено в наявності) ----
  {
    slug: 'camry-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Toyota Camry',
    h1: 'Гальмівні колодки передні Toyota Camry',
    metaTitle: 'Колодки передні Camry від 1242 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові передні Toyota Camry в наявності від 1242 грн (TASHIKO). Оригінал і аналоги, доставка по Україні.',
    intro: 'Передні гальмівні колодки для Toyota Camry різних поколінь — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед'], ['camry', 'камрі', 'камри']],
    tecdocVehicle: { make: 'TOYOTA', models: ['CAMRY Stufenheck (AVV5_, XV5_)', 'CAMRY Stufenheck (MCV3_, ACV3_, _XV3_)', 'CAMRY Stufenheck (_CV2_, _XV2_)', 'CAMRY Stufenheck (_V1_)', 'CAMRY Stufenheck (_V2_)', 'CAMRY Stufenheck (_XV4_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-camry',
    modelLabel: 'Toyota Camry',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'camry-povitrianyi-filtr',
    name: 'Повітряний фільтр Toyota Camry',
    h1: 'Повітряний фільтр Toyota Camry',
    metaTitle: 'Повітряний фільтр Camry від 302 грн | DominatorParts',
    metaDescription:
      'Повітряний фільтр двигуна Toyota Camry в наявності від 302 грн (HENGST FILTER). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Повітряний фільтр двигуна для Toyota Camry — недорога деталь планового ТО, впливає на витрату палива і тягу.',
    matchGroups: [
      ['фільтр', 'фильтр'],
      ['повітр', 'воздушн'],
      ['camry', 'камрі', 'камри'],
    ],
    tecdocVehicle: { make: 'TOYOTA', models: ['CAMRY Stufenheck (AVV5_, XV5_)', 'CAMRY Stufenheck (MCV3_, ACV3_, _XV3_)', 'CAMRY Stufenheck (_CV2_, _XV2_)', 'CAMRY Stufenheck (_V1_)', 'CAMRY Stufenheck (_V2_)', 'CAMRY Stufenheck (_XV4_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-camry',
    modelLabel: 'Toyota Camry',
    parentCategorySlug: 'povitryani-filtry',
  },

  // ---- VW Passat B5 / Golf 4 (підтверджено в наявності) ----
  {
    slug: 'passat-b5-reshitka-bampera',
    name: 'Решітка бампера VW Passat B5',
    h1: 'Решітка бампера передня права VW Passat B5',
    metaTitle: 'Решітка бампера Passat B5 від 445 грн | DominatorParts',
    metaDescription:
      'Решітка бампера передня права VW Passat B5 в наявності від 445 грн (POLCAR). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Решітка переднього бампера для VW Passat B5 (до 2000 р.) — права сторона, в наявності.',
    matchGroups: [['решітк'], ['бампер'], ['passat b5', 'пассат б5']],
    tecdocVehicle: { make: 'VW', models: ['PASSAT Stufenheck (3B2)', 'PASSAT Stufenheck (3B3)', 'PASSAT Variant (3B5)', 'PASSAT Variant (3B6)'] },
    hideFromIndex: true,
    modelGroup: 'vw-passat-b5',
    modelLabel: 'VW Passat B5',
  },
  {
    slug: 'golf-4-reika-kermova',
    name: 'Рейка кермова VW Golf 4',
    h1: 'Рейка кермова VW Golf 4',
    metaTitle: 'Рейка кермова Golf 4 від 10708 грн | DominatorParts',
    metaDescription:
      'Рейка кермова в зборі з наконечниками VW Golf 4 в наявності від 10708 грн (Kimiko). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Рульова (кермова) рейка в зборі з наконечниками для VW Golf 4 — в наявності від Kimiko.',
    matchGroups: [['рейк'], ['керм'], ['golf 4', 'golf iv', 'гольф 4']],
    tecdocVehicle: { make: 'VW', models: ['GOLF Mk IV (1J1)', 'GOLF Mk IV Estate (1J5)'] },
    hideFromIndex: true,
    modelGroup: 'vw-golf-4',
    modelLabel: 'VW Golf 4',
    parentCategorySlug: 'kermove-upravlinnya',
  },

  // ---- Волна 3: Toyota Corolla / Suzuki SX4 / Honda Accord VII ----
  // (підтверджено прямим запитом до бойової бази — див. сесію SEO
  // волни 3; частина запитаних зв'язок НЕ увійшла сюди, бо на момент
  // перевірки товару в наявності не було: Corolla E120/E150 повітряний
  // і оливний фільтр, SX4 паливний фільтр, Accord VII задні колодки)
  {
    slug: 'corolla-povitrianyi-filtr',
    name: 'Повітряний фільтр Toyota Corolla',
    h1: 'Повітряний фільтр Toyota Corolla',
    metaTitle: 'Повітряний фільтр Corolla від 99 грн | DominatorParts',
    metaDescription:
      'Повітряний фільтр Toyota Corolla (всі покоління) в наявності від 99 грн. Оригінал і аналоги, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Повітряний фільтр міняють при кожному ТО — забитий фільтр збільшує витрату палива і знижує тягу двигуна. У наявності варіанти під різні покоління Toyota Corolla.',
    matchGroups: [['фільтр', 'фильтр'], ['повітр', 'воздушн'], ['corolla']],
    hideFromIndex: true,
    modelGroup: 'toyota-corolla',
    modelLabel: 'Toyota Corolla',
    parentCategorySlug: 'povitryani-filtry',
  },
  {
    slug: 'corolla-e150-dysky-halmivni-zadni',
    name: 'Гальмівні диски задні Toyota Corolla E150',
    h1: 'Гальмівні диски задні Toyota Corolla E150',
    metaTitle: 'Диск задній Corolla E150 від 726 грн | DominatorParts',
    metaDescription:
      'Гальмівний диск задній Toyota Corolla E150 (2007-2013) в наявності від 726 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Задні гальмівні диски для Toyota Corolla покоління E150 (2007-2013 р.) — в наявності декілька варіантів.',
    // Явного тега "E150" в назвах товарів постачальники не пишуть —
    // покоління визначається за роками випуску/маркуванням кузова, які
    // реально зустрічаються в базі (перевірено вручну, не лише за
    // ключовими словами — див. сесію волни 3)
    matchGroups: [
      ['диск'],
      ['гальм', 'тормоз'],
      ['зад'],
      ['corolla 2.2d 07-', '1.33-1.8vvti 01.07-', 'corolla sedan 1.4,1.6 06.11-'],
    ],
    tecdocVehicle: { make: 'TOYOTA', models: ['ALTIS Stufenheck (E15_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-corolla-e150',
    modelLabel: 'Toyota Corolla E150',
    parentCategorySlug: 'halmivni-dysky',
  },
  {
    slug: 'corolla-e120-kolodky-halmivni-zadni',
    name: 'Гальмівні колодки задні Toyota Corolla E120',
    h1: 'Гальмівні колодки задні Toyota Corolla E120',
    metaTitle: 'Колодки задні Corolla E120 від 428 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові задні Toyota Corolla E120 (2002-2007) в наявності від 428 грн (DENCKERMANN). Доставка по Україні.',
    intro: 'Задні гальмівні колодки для Toyota Corolla покоління E120 (2002-2007 р.) — в наявності.',
    matchGroups: [['колодк'], ['зад'], ['corolla 02-07', 'corolla 02-']],
    tecdocVehicle: { make: 'TOYOTA', models: ['AXIO/ALTIS Stufenheck (_E12J_, _E12T_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-corolla-e120',
    modelLabel: 'Toyota Corolla E120',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'sx4-povitrianyi-filtr',
    name: 'Повітряний фільтр Suzuki SX4',
    h1: 'Повітряний фільтр Suzuki SX4',
    metaTitle: 'Повітряний фільтр SX4 від 118 грн | DominatorParts',
    metaDescription:
      'Повітряний фільтр Suzuki SX4 в наявності від 118 грн. Декілька варіантів різних виробників, доставка по всій Україні, оплата при отриманні.',
    intro: 'Повітряний фільтр для Suzuki SX4 — недорога деталь планового ТО, в наявності одразу декілька виробників.',
    matchGroups: [['фільтр', 'фильтр'], ['повітр', 'воздушн'], ['sx4', 'sx-4']],
    tecdocVehicle: { make: 'SUZUKI', models: ['SX4 (EY, GY)', 'SX4 Stufenheck (GY)'] },
    hideFromIndex: true,
    modelGroup: 'suzuki-sx4',
    modelLabel: 'Suzuki SX4',
    parentCategorySlug: 'povitryani-filtry',
  },
  {
    slug: 'sx4-halmivni-kolodky',
    name: 'Гальмівні колодки Suzuki SX4',
    h1: 'Гальмівні колодки Suzuki SX4',
    metaTitle: 'Гальмівні колодки SX4 від 353 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Suzuki SX4 в наявності від 353 грн (RAISO). Оригінал і аналоги, доставка по всій Україні, оплата при отриманні.',
    intro: 'Гальмівні колодки для Suzuki SX4 — в наявності, підходять і для Suzuki Swift з тією ж платформою.',
    matchGroups: [['колодк'], ['sx4', 'sx-4']],
    tecdocVehicle: { make: 'SUZUKI', models: ['SX4 (EY, GY)', 'SX4 Stufenheck (GY)'] },
    hideFromIndex: true,
    modelGroup: 'suzuki-sx4',
    modelLabel: 'Suzuki SX4',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'accord-7-kolodky-peredni',
    name: 'Гальмівні колодки передні Honda Accord VII',
    h1: 'Гальмівні колодки передні Honda Accord VII',
    metaTitle: 'Колодки передні Accord VII від 657 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові передні Honda Accord VII (2003-2008) в наявності від 657 грн (STELLOX). Доставка по всій Україні.',
    intro: 'Передні гальмівні колодки для Honda Accord 7-го покоління (CL/CM, 2003-2008 р.) — в наявності.',
    // "accord vii" свідомо НЕ додано як запасний варіант — це підрядок
    // "accord viii" (восьме покоління, інший ринок), матч по ньому б
    // підтягнув чужі товари (перевірено на практиці — саме так сталося
    // з попереднім варіантом сторінки повітряного фільтра нижче)
    matchGroups: [['колодк'], ['перед'], ['cl_, cm_']],
    tecdocVehicle: { make: 'HONDA', models: ['ACCORD Mk VII (CG, CK)', 'ACCORD Mk VII Coupe (CG)', 'ACCORD Mk VII Kombi (CF)', 'ACCORD Mk VII Schrägheck (CH)', 'ACCORD VII Tourer (CM)'] },
    hideFromIndex: true,
    modelGroup: 'honda-accord-7',
    modelLabel: 'Honda Accord VII',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'accord-7-povitrianyi-filtr',
    name: 'Повітряний фільтр Honda Accord VII',
    h1: 'Повітряний фільтр Honda Accord VII',
    metaTitle: 'Фільтр повітряний Accord VII від 183 грн | DominatorParts',
    metaDescription:
      'Повітряний фільтр Honda Accord VII (2002-2008), в т.ч. дизель 2.2 CTDi, в наявності від 183 грн. Доставка по Україні.',
    intro: 'Повітряний фільтр для Honda Accord 7-го покоління (2002-2008 р.), включно з дизельним двигуном 2.2 CTDi.',
    // "accord vii" НЕ додано — це підрядок "accord viii" (восьме
    // покоління/американський ринок, зовсім інша деталь), і саме через
    // це в чернетці сюди підтягнувся чужий товар (SHAFER SX49041,
    // Accord VIII USA 08-15) — побачили на живій перевірці й прибрали
    matchGroups: [['фільтр', 'фильтр'], ['повітр', 'воздушн'], ['2.2i-ctdi 02.10-']],
    tecdocVehicle: { make: 'HONDA', models: ['ACCORD Mk VII (CG, CK)', 'ACCORD Mk VII Coupe (CG)', 'ACCORD Mk VII Kombi (CF)', 'ACCORD Mk VII Schrägheck (CH)', 'ACCORD VII Tourer (CM)'] },
    hideFromIndex: true,
    modelGroup: 'honda-accord-7',
    modelLabel: 'Honda Accord VII',
    parentCategorySlug: 'povitryani-filtry',
  },

  // ---- Волна 4: Pajero II / Mazda 6 GG / Prado 120 / Mazda CX-5 ----
  // (Civic 4D і Lexus RX350 перевірені, але жодна категорія не набрала
  // мінімум 3 шт у наявності — сторінок під них немає. "pajero ii "/
  // "pajero ii," (з комою чи пробілом одразу після "II") — навмисно НЕ
  // просто "pajero ii": підрядок "pajero ii" сам по собі входить у
  // "pajero iii" (той самий "суфіксний" баг, що і з accord vii/viii
  // вище) — з пробілом чи комою одразу після колізії з III/IV нема)
  {
    slug: 'pajero-2-kulovi-opory',
    name: 'Кульові опори Mitsubishi Pajero II',
    h1: 'Кульові опори Mitsubishi Pajero II',
    metaTitle: 'Кульова опора Pajero II від 297 грн | DominatorParts',
    metaDescription:
      'Кульові опори передньої підвіски Mitsubishi Pajero II в наявності від 297 грн (DENCKERMANN). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Кульові опори для рамного позашляховика Mitsubishi Pajero II — деталь, яка часто зношується через навантаження позашляхового ходу підвіски.',
    matchGroups: [['куль', 'шаров'], ['опор'], ['pajero ii ', 'pajero ii,']],
    // tecdocVehicle тут НЕ впливає на добір товарів (сторінка й далі
    // працює через matchGroups вище, це підтверджено робочим рішенням) —
    // додано ЛИШЕ як ідентифікатор для дедуплікації фільтра марка/
    // модель/рік/двигун на широких сторінках категорій (findNarrowPageForVehicle
    // нижче): якщо покупець на /category/kulovi-opory обере Mitsubishi +
    // цю саму модель у фільтрі, його переспрямує сюди, а не покаже ті ж
    // товари вдруге за іншою адресою
    tecdocVehicle: {
      make: 'MITSUBISHI',
      models: ['SHOGUN II (V3_W, V2_W, V4_W)', 'SHOGUN II Geländewagen offen (V2_W, V4_W)', 'PAJERO/SHOGUN CLASSIC (V2_W)'],
    },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-pajero-2',
    modelLabel: 'Mitsubishi Pajero II',
    parentCategorySlug: 'kulovi-opory',
  },
  {
    slug: 'pajero-2-amortyzatory',
    name: 'Амортизатори Mitsubishi Pajero II',
    h1: 'Амортизатори Mitsubishi Pajero II',
    metaTitle: 'Амортизатор Pajero II від 611 грн | DominatorParts',
    metaDescription:
      'Амортизатори передні та задні Mitsubishi Pajero II в наявності від 611 грн (RAISO). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Амортизатори для Mitsubishi Pajero II — в наявності передні та задні, газові.',
    // "амортизатор " (з пробілом одразу після) — а не просто
    // "амортизатор": без пробілу підрядок збігається і з "опора
    // стійки АМОРТИЗАТОРА" (кріплення, а не сама стійка) — саме так
    // на живій перевірці сюди підтягнувся MONROE MK358 для іншої
    // моделі; з пробілом ловиться лише "Амортизатор ..." на початку
    // назви товару
    matchGroups: [['амортизатор '], ['pajero ii ', 'pajero ii,']],
    tecdocVehicle: { make: 'MITSUBISHI', models: ['SHOGUN II Stufenheck (V3_W, V2_W)', 'SHOGUN II (V3_W, V2_W)', 'SHOGUN II Schrägheck (V2_W)'] },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-pajero-2',
    modelLabel: 'Mitsubishi Pajero II',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'mazda6-gg-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Mazda 6 GG',
    h1: 'Гальмівні колодки передні Mazda 6 GG',
    metaTitle: 'Колодки передні Mazda 6 GG від 468 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові передні Mazda 6 (кузов GG, 2002-2007) в наявності від 468 грн (RAISO). Доставка по всій Україні.',
    intro: 'Передні гальмівні колодки для Mazda 6 першого поколінна (кузов GG, 2002-2007) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед'], ['mazda 6', 'mazda6'], ['02-07']],
    tecdocVehicle: { make: 'MAZDA', models: ['ATENZA (GG)', 'ATENZA Schrägheck (GG)'] },
    hideFromIndex: true,
    modelGroup: 'mazda6-gg',
    modelLabel: 'Mazda 6 (GG)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'mazda6-gg-amortyzatory',
    name: 'Амортизатори Mazda 6 GG',
    h1: 'Амортизатори Mazda 6 GG',
    metaTitle: 'Амортизатор Mazda 6 GG від 962 грн | DominatorParts',
    metaDescription:
      'Амортизатори передні та задні Mazda 6 (кузов GG, 2002-2007) в наявності від 962 грн (TASHIKO). Доставка по всій Україні.',
    intro: 'Амортизатори для Mazda 6 першого поколінна (GG, 2002-2007) — передні та задні, в наявності.',
    // "амортизатор " з пробілом — див. коментар біля Pajero II вище:
    // без пробілу підрядок збігається і з "опора стійки АМОРТИЗАТОРА"
    matchGroups: [['амортизатор '], ['mazda 6', 'mazda6'], ['02-07', 'gg, gy']],
    tecdocVehicle: { make: 'MAZDA', models: ['ATENZA (GG)', 'ATENZA Schrägheck (GG)'] },
    hideFromIndex: true,
    modelGroup: 'mazda6-gg',
    modelLabel: 'Mazda 6 (GG)',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'mazda6-gg-pruzhyny',
    name: 'Пружини підвіски Mazda 6 GG',
    h1: 'Пружини підвіски Mazda 6 GG',
    metaTitle: 'Пружина підвіски Mazda 6 GG від 673 грн | DominatorParts',
    metaDescription:
      'Пружини підвіски Mazda 6 (кузов GG, 2002-2007) в наявності від 673 грн (RAISO). Доставка по всій Україні.',
    intro: 'Пружини підвіски для Mazda 6 GG (2002-2007) — в наявності.',
    matchGroups: [['пружин'], ['mazda 6', 'mazda6'], ['02-07']],
    tecdocVehicle: { make: 'MAZDA', models: ['ATENZA (GG)', 'ATENZA Schrägheck (GG)'] },
    hideFromIndex: true,
    modelGroup: 'mazda6-gg',
    modelLabel: 'Mazda 6 (GG)',
  },
  {
    slug: 'prado-120-pruzhyny',
    name: 'Пружини підвіски Toyota Land Cruiser Prado 120',
    h1: 'Пружини підвіски Toyota Land Cruiser Prado 120',
    metaTitle: 'Пружина підвіски Prado 120 від 919 грн | DominatorParts',
    metaDescription:
      'Пружини підвіски (передні та задні) Toyota Land Cruiser Prado 120 в наявності від 919 грн (RAISO). Доставка по всій Україні.',
    intro: 'Пружини підвіски для Toyota Land Cruiser Prado 120 — передні та задні, в наявності.',
    // ['зад','передн'] тут — не про покоління, а щоб відсікти зовсім
    // іншу деталь з тим самим словом "пружина": пружину БАРАБАННОГО
    // ГАЛЬМА (дрібна пружинка всередині гальмівного барабана, а не
    // пружина підвіски) — вона теж згадує "Prado 120", але не містить
    // слова "зад"/"передн", тому в підбірку не потрапляє
    matchGroups: [['пружин'], ['зад', 'передн'], ['prado 120', '(j120)']],
    tecdocVehicle: { make: 'TOYOTA', models: ['LAND CRUISER PRADO (KDJ12_, GRJ12_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-prado-120',
    modelLabel: 'Toyota Land Cruiser Prado 120',
  },
  {
    slug: 'cx5-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Mazda CX-5',
    h1: 'Гальмівні колодки передні Mazda CX-5',
    metaTitle: 'Колодки передні Mazda CX-5 від 614 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки дискові передні Mazda CX-5 в наявності від 614 грн (Q-TOP). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Mazda CX-5 — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед'], ['cx-5', 'cx5', 'cx 5']],
    tecdocVehicle: { make: 'MAZDA', models: ['CX-5 (KE, GH)'] },
    hideFromIndex: true,
    modelGroup: 'mazda-cx5',
    modelLabel: 'Mazda CX-5',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'cx5-kilca-porshnevi',
    name: 'Кільця поршневі Mazda CX-5',
    h1: 'Кільця поршневі Mazda CX-5',
    metaTitle: 'Кільця поршневі CX-5 від 817 грн | DominatorParts',
    metaDescription:
      'Кільця поршневі (комплект на мотор) Mazda CX-5 в наявності від 817 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Комплект поршневих кілець для двигуна Mazda CX-5 — стандартний та ремонтний розмір, в наявності.',
    matchGroups: [['кільц', 'кольц'], ['порш'], ['cx-5', 'cx5']],
    tecdocVehicle: { make: 'MAZDA', models: ['CX-5 (KE, GH)'] },
    hideFromIndex: true,
    modelGroup: 'mazda-cx5',
    modelLabel: 'Mazda CX-5',
  },
  {
    slug: 'cx5-sailentbloky',
    name: 'Сайлентблоки Mazda CX-5',
    h1: 'Сайлентблоки Mazda CX-5',
    metaTitle: 'Сайлентблок CX-5 від 321 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки переднього важеля Mazda CX-5 в наявності від 321 грн (APLUS). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Сайлентблоки переднього важеля підвіски для Mazda CX-5 — типова причина стуку в передній підвісці при зношуванні.',
    matchGroups: [['сайлентблок'], ['cx-5', 'cx5']],
    tecdocVehicle: { make: 'MAZDA', models: ['CX-5 (KE, GH)'] },
    hideFromIndex: true,
    modelGroup: 'mazda-cx5',
    modelLabel: 'Mazda CX-5',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },

  // ============================================================
  // ХВИЛЯ 6 — бэклог з хвилі 5: "Гальмівні колодки" і "Комплект
  // прокладок двигуна" по моделях, де вже давно ≥3 шт у наявності,
  // але сторінки не було. На відміну від хвиль 1-4, тут matchGroups
  // визначає ЛИШЕ ТИП деталі ("колодк"/"прокладк") — модель авто НЕ
  // шукається підрядком у назві (постачальники цих товарів модель у
  // назві не пишуть, напр. "Колодки гальмівні дискові передні STELLOX"
  // без слова "Passat"), а підбирається через tecdocVehicle — join по
  // бренду+артикулу до tecdoc_compatibility (див. buildCategoryWhereClause
  // в кінці цього файлу). Перелік товарів під кожною сторінкою
  // перевірено вручну прямим запитом до бойової бази перед деплоєм.
  // ============================================================

  // ---- Гальмівні колодки (нові моделі) ----
  {
    slug: 'passat-b5-halmivni-kolodky',
    name: 'Гальмівні колодки VW Passat B5',
    h1: 'Гальмівні колодки VW Passat B5',
    metaTitle: 'Колодки гальмівні Passat B5 від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки VW Passat B5 в наявності від 621 грн (LPR). Оригінал і перевірені аналоги, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для VW Passat B5 — передні та задні варіанти різних виробників, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: {
      make: 'VW',
      models: ['PASSAT Stufenheck (3B2)', 'PASSAT Stufenheck (3B3)', 'PASSAT Variant (3B5)', 'PASSAT Variant (3B6)'],
    },
    hideFromIndex: true,
    modelGroup: 'vw-passat-b5',
    modelLabel: 'VW Passat B5',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'golf-4-halmivni-kolodky',
    name: 'Гальмівні колодки VW Golf 4',
    h1: 'Гальмівні колодки VW Golf 4',
    metaTitle: 'Колодки гальмівні Golf 4 від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки VW Golf 4 в наявності від 621 грн (LPR). Оригінал і перевірені аналоги, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для VW Golf 4 — передні та задні варіанти різних виробників, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: { make: 'VW', models: ['GOLF Mk IV (1J1)', 'GOLF Mk IV Estate (1J5)'] },
    hideFromIndex: true,
    modelGroup: 'vw-golf-4',
    modelLabel: 'VW Golf 4',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'pajero-2-halmivni-kolodky',
    name: 'Гальмівні колодки Mitsubishi Pajero II',
    h1: 'Гальмівні колодки Mitsubishi Pajero II',
    metaTitle: 'Колодки гальмівні Pajero II від 427 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки Mitsubishi Pajero II в наявності від 427 грн (STELLOX). Дискові та барабанні, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для Mitsubishi Pajero II — дискові (передні/задні) та барабанні варіанти, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: {
      make: 'MITSUBISHI',
      models: ['SHOGUN II (V3_W, V2_W, V4_W)', 'SHOGUN II Geländewagen offen (V2_W, V4_W)', 'PAJERO/SHOGUN CLASSIC (V2_W)'],
    },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-pajero-2',
    modelLabel: 'Mitsubishi Pajero II',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'civic-4d-halmivni-kolodky',
    name: 'Гальмівні колодки Honda Civic 4D',
    h1: 'Гальмівні колодки Honda Civic 4D',
    metaTitle: 'Колодки гальмівні Civic 4D від 423 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки Honda Civic 4D (седан) в наявності від 423 грн (STELLOX). Дискові та барабанні, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для Honda Civic 4D (седан, кузов FD/FA) — дискові та барабанні варіанти, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: { make: 'HONDA', models: ['BALLADE VIII Stufenheck (FD, FA)'] },
    hideFromIndex: true,
    modelGroup: 'honda-civic-4d',
    modelLabel: 'Honda Civic 4D',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'rx350-halmivni-kolodky',
    name: 'Гальмівні колодки Lexus RX350',
    h1: 'Гальмівні колодки Lexus RX350',
    metaTitle: 'Колодки гальмівні Lexus RX350 від 733 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки Lexus RX350 в наявності від 733 грн (STELLOX, BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для Lexus RX350 — в наявності декілька виробників, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: { make: 'LEXUS', models: ['RX (MHU3_, GSU3_, MCU3_)', 'RX (GYL1_, GGL15, AGL10)'] },
    hideFromIndex: true,
    modelGroup: 'lexus-rx350',
    modelLabel: 'Lexus RX350',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ---- Комплект прокладок двигуна (повністю нова категорія деталі) ----
  {
    // parentCategorySlug — раніше НЕ був заданий (єдиний пропуск серед
    // усіх вузьких категорій "по машині" у файлі, перевірено окремим
    // аналізом) — через це detectCategoryForProductName() (яка явно
    // виключає вузькі категорії з parentCategorySlug) помилково брала
    // ЦЮ категорію як ШИРОКУ, і перший товар з "прокладк" у назві
    // отримував H1 "...Daewoo Lanos" незалежно від його реальної марки
    // (знайдено на прикладі AJUSA 11059300 — товар для CITROËN)
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'lanos-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Daewoo Lanos',
    h1: 'Комплект прокладок двигуна Daewoo Lanos',
    metaTitle: 'Прокладки двигуна Lanos від 67 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Daewoo Lanos в наявності від 67 грн (FA1): головки блоку, випускного колектора та інші. Доставка по всій Україні.',
    intro:
      'Прокладки двигуна для Daewoo Lanos — головки блоку циліндрів, випускного колектора та інших вузлів, в наявності декілька виробників.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'DAEWOO', models: ['LANOS / SENS (KLAT)', 'Lanos / Sens Stufenheck (KLAT)'] },
    hideFromIndex: true,
    modelGroup: 'daewoo-lanos',
    modelLabel: 'Daewoo Lanos',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'camry-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Toyota Camry',
    h1: 'Комплект прокладок двигуна Toyota Camry',
    metaTitle: 'Прокладки двигуна Camry від 82 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Toyota Camry в наявності від 82 грн (FA1): впускного та випускного колектора, клапанної кришки. Доставка по Україні.',
    intro:
      'Прокладки двигуна для Toyota Camry — впускний і випускний колектор, клапанна кришка та інші вузли, в наявності декілька виробників.',
    matchGroups: [['прокладк']],
    tecdocVehicle: {
      make: 'TOYOTA',
      models: [
        'CAMRY Stufenheck (AVV5_, XV5_)',
        'CAMRY Stufenheck (MCV3_, ACV3_, _XV3_)',
        'CAMRY Stufenheck (_CV2_, _XV2_)',
        'CAMRY Stufenheck (_V1_)',
        'CAMRY Stufenheck (_V2_)',
        'CAMRY Stufenheck (_XV4_)',
      ],
    },
    hideFromIndex: true,
    modelGroup: 'toyota-camry',
    modelLabel: 'Toyota Camry',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'passat-b5-komplekt-prokladok',
    name: 'Комплект прокладок двигуна VW Passat B5',
    h1: 'Комплект прокладок двигуна VW Passat B5',
    metaTitle: 'Прокладки двигуна Passat B5 від 34 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна VW Passat B5 в наявності від 34 грн (ELRING): головки блоку, колекторів, термостата. Доставка по всій Україні.',
    intro:
      'Прокладки двигуна для VW Passat B5 — головка блоку циліндрів, впускний/випускний колектор, термостат та інші вузли двигуна.',
    matchGroups: [['прокладк']],
    tecdocVehicle: {
      make: 'VW',
      models: ['PASSAT Stufenheck (3B2)', 'PASSAT Stufenheck (3B3)', 'PASSAT Variant (3B5)', 'PASSAT Variant (3B6)'],
    },
    hideFromIndex: true,
    modelGroup: 'vw-passat-b5',
    modelLabel: 'VW Passat B5',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'golf-4-komplekt-prokladok',
    name: 'Комплект прокладок двигуна VW Golf 4',
    h1: 'Комплект прокладок двигуна VW Golf 4',
    metaTitle: 'Прокладки двигуна Golf 4 від 34 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна VW Golf 4 в наявності від 34 грн (ELRING): головки блоку, колекторів, піддону картера. Доставка по всій Україні.',
    intro:
      'Прокладки двигуна для VW Golf 4 — головка блоку циліндрів, колектори, піддон картера та інші вузли двигуна.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'VW', models: ['GOLF Mk IV (1J1)', 'GOLF Mk IV Estate (1J5)'] },
    hideFromIndex: true,
    modelGroup: 'vw-golf-4',
    modelLabel: 'VW Golf 4',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'corolla-e120-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Toyota Corolla E120',
    h1: 'Комплект прокладок двигуна Toyota Corolla E120',
    metaTitle: 'Прокладки двигуна Corolla E120 від 86 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Toyota Corolla E120 (2001-2007) в наявності від 86 грн. Клапанної кришки, колекторів та інші. Доставка по Україні.',
    intro:
      'Прокладки двигуна для Toyota Corolla покоління E120 (2001-2007) — клапанна кришка, колектори та інші вузли, декілька виробників.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'TOYOTA', models: ['AXIO/ALTIS Stufenheck (_E12J_, _E12T_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-corolla-e120',
    modelLabel: 'Toyota Corolla E120',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'corolla-e150-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Toyota Corolla E150',
    h1: 'Комплект прокладок двигуна Toyota Corolla E150',
    metaTitle: 'Прокладки двигуна Corolla E150 від 120 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Toyota Corolla E150 (2006-2013) в наявності від 120 грн. Колекторів, клапанної кришки та інші. Доставка по Україні.',
    intro:
      'Прокладки двигуна для Toyota Corolla покоління E150 (2006-2013) — впускний/випускний колектор, клапанна кришка та інші вузли.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'TOYOTA', models: ['ALTIS Stufenheck (E15_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-corolla-e150',
    modelLabel: 'Toyota Corolla E150',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'sx4-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Suzuki SX4',
    h1: 'Комплект прокладок двигуна Suzuki SX4',
    metaTitle: 'Прокладки двигуна SX4 від 27 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Suzuki SX4 в наявності від 27 грн (ELRING): зливної пробки, впускного колектора, клапанної кришки. Доставка по Україні.',
    intro: 'Прокладки двигуна для Suzuki SX4 — впускний колектор, клапанна кришка та інші вузли, декілька виробників.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'SUZUKI', models: ['SX4 (EY, GY)', 'SX4 Stufenheck (GY)'] },
    hideFromIndex: true,
    modelGroup: 'suzuki-sx4',
    modelLabel: 'Suzuki SX4',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'accord-7-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Honda Accord VII',
    h1: 'Комплект прокладок двигуна Honda Accord VII',
    metaTitle: 'Прокладки двигуна Accord VII від 47 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Honda Accord VII в наявності від 47 грн (FA1): колекторів, клапанної кришки, вихлопної труби. Доставка по Україні.',
    intro: 'Прокладки двигуна для Honda Accord 7-го покоління — колектори, клапанна кришка, вихлопна труба та інші вузли.',
    matchGroups: [['прокладк']],
    tecdocVehicle: {
      make: 'HONDA',
      models: [
        'ACCORD Mk VII (CG, CK)',
        'ACCORD Mk VII Coupe (CG)',
        'ACCORD Mk VII Kombi (CF)',
        'ACCORD Mk VII Schrägheck (CH)',
        'ACCORD VII Tourer (CM)',
      ],
    },
    hideFromIndex: true,
    modelGroup: 'honda-accord-7',
    modelLabel: 'Honda Accord VII',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'pajero-2-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Mitsubishi Pajero II',
    h1: 'Комплект прокладок двигуна Mitsubishi Pajero II',
    metaTitle: 'Прокладки двигуна Pajero II від 99 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Mitsubishi Pajero II в наявності від 99 грн (AJUSA): головки блоку, впускного колектора та інші. Доставка по Україні.',
    intro: 'Прокладки двигуна для Mitsubishi Pajero II — головка блоку циліндрів, впускний колектор та інші вузли двигуна.',
    matchGroups: [['прокладк']],
    tecdocVehicle: {
      make: 'MITSUBISHI',
      models: ['SHOGUN II (V3_W, V2_W, V4_W)', 'SHOGUN II Geländewagen offen (V2_W, V4_W)', 'PAJERO/SHOGUN CLASSIC (V2_W)'],
    },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-pajero-2',
    modelLabel: 'Mitsubishi Pajero II',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'mazda6-gg-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Mazda 6 GG',
    h1: 'Комплект прокладок двигуна Mazda 6 GG',
    metaTitle: 'Прокладки двигуна Mazda 6 GG від 194 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Mazda 6 (кузов GG) в наявності від 194 грн. Впускного колектора, клапанної кришки та інші. Доставка по Україні.',
    intro: 'Прокладки двигуна для Mazda 6 першого покоління (GG, 2002-2007) — впускний колектор, клапанна кришка та інші вузли.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'MAZDA', models: ['ATENZA (GG)', 'ATENZA Schrägheck (GG)'] },
    hideFromIndex: true,
    modelGroup: 'mazda6-gg',
    modelLabel: 'Mazda 6 (GG)',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'civic-4d-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Honda Civic 4D',
    h1: 'Комплект прокладок двигуна Honda Civic 4D',
    metaTitle: 'Прокладки двигуна Civic 4D від 92 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Honda Civic 4D (седан) в наявності від 92 грн (FA1): головки блоку, колектора, клапанної кришки. Доставка по Україні.',
    intro: 'Прокладки двигуна для Honda Civic 4D (седан, кузов FD/FA) — головка блоку, колектор, клапанна кришка та інші вузли.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'HONDA', models: ['BALLADE VIII Stufenheck (FD, FA)'] },
    hideFromIndex: true,
    modelGroup: 'honda-civic-4d',
    modelLabel: 'Honda Civic 4D',
  },
  {
    // parentCategorySlug — див. коментар у lanos-komplekt-prokladok вище
    parentCategorySlug: 'prokladky-dvyhuna',
    slug: 'prado-120-komplekt-prokladok',
    name: 'Комплект прокладок двигуна Toyota Land Cruiser Prado 120',
    h1: 'Комплект прокладок двигуна Toyota Land Cruiser Prado 120',
    metaTitle: 'Прокладки двигуна Prado 120 від 198 грн | DominatorParts',
    metaDescription:
      'Прокладки двигуна Toyota Land Cruiser Prado 120 в наявності від 198 грн (AJUSA): колекторів, клапанної кришки. Доставка по Україні.',
    intro: 'Прокладки двигуна для Toyota Land Cruiser Prado 120 — випускний колектор, клапанна кришка та інші вузли двигуна.',
    matchGroups: [['прокладк']],
    tecdocVehicle: { make: 'TOYOTA', models: ['LAND CRUISER PRADO (KDJ12_, GRJ12_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-prado-120',
    modelLabel: 'Toyota Land Cruiser Prado 120',
  },

  // ============================================================
  // ХВИЛЯ 7 — Mitsubishi Lancer X, Nissan Qashqai J10, Nissan X-Trail
  // T31, Mazda 3. Як і в хвилях 1-4 (і на відміну від хвилі 6), тут
  // постачальники САМІ пишуть модель прямо в назві товару ("Mitsubishi
  // Lancer 10", "Qashqai (J10)", "Mazda 3 BK") — тому модель шукається
  // підрядком у matchGroups, а не через tecdocVehicle: у
  // tecdoc_compatibility ці конкретні товари майже не заведені, з
  // tecdocVehicle сторінки вийшли б порожніми. Перелік товарів під
  // кожною сторінкою перевірено вручну прямим запитом до бойової бази
  // перед деплоєм.
  //
  // Mitsubishi Lancer: попередня позначка залишку як "Lancer 9" була
  // неточною — амортизаторів під Lancer 9 (Cedia, CS_A) у наявності
  // немає взагалі (тільки опори/стійки кріплення, це інша деталь),
  // реальний залишок — під Lancer X (10-е покоління, кузови CX/CY).
  //
  // Nissan X-Trail T31 "колодки ручника": окремої деталі під таким
  // описом не існує — на T31 стоянкове гальмо механічно вбудоване в
  // задній гальмівний супорт, тому відповідь на цей запит — звичайні
  // задні гальмівні колодки (уточнення додано в metaDescription/intro).
  //
  // Mazda 3: свідомо БЕЗ розбивки по кузову (BK/BL/BM) — на відміну
  // від Lancer/Qashqai/X-Trail тут покупець сам обирає потрібний рік
  // зі списку товарів на сторінці, а не з назви/URL сторінки (як і на
  // сторінках Suzuki SX4, Lexus RX350 вище). 'mazda 3 '/'mazda 3,' з
  // пробілом чи комою одразу після цифри — щоб підрядок НЕ збігався з
  // "Mazda 323" (інша, попередня модель).
  // ============================================================
  {
    slug: 'lancer-x-amortyzatory-zadni',
    name: 'Амортизатори задні Mitsubishi Lancer X',
    h1: 'Амортизатори задні Mitsubishi Lancer X',
    metaTitle: 'Амортизатори задні Lancer X від 1143 грн | DominatorParts',
    metaDescription:
      'Амортизатори задні Mitsubishi Lancer X (10-е покоління, 2007-2017) в наявності від 1143 грн (TASHIKO). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Задні амортизатори для Mitsubishi Lancer X (10-е покоління, кузови CX/CY, 2007-2017) — газові, в наявності декілька виробників.',
    matchGroups: [['амортизатор '], ['зад'], ['lancer x', 'lancer 10', 'лансер x', 'лансер 10']],
    hideFromIndex: true,
    modelGroup: 'mitsubishi-lancer-x',
    modelLabel: 'Mitsubishi Lancer X',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'qashqai-j10-amortyzatory-peredni',
    name: 'Амортизатори передні Nissan Qashqai J10',
    h1: 'Амортизатори передні Nissan Qashqai J10',
    metaTitle: 'Амортизатори передні Qashqai J10 від 1356 грн | DominatorParts',
    metaDescription:
      'Амортизатори передні Nissan Qashqai J10 (1-е покоління, 2007-2013) в наявності від 1356 грн (RAISO). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні амортизатори для Nissan Qashqai першого покоління (J10, 2007-2013) — газові, підходять і для X-Trail T31 та Renault Koleos з тією ж платформою.',
    matchGroups: [['амортизатор '], ['перед'], ['qashqai', 'кашкай']],
    hideFromIndex: true,
    modelGroup: 'nissan-qashqai-j10',
    modelLabel: 'Nissan Qashqai J10',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'xtrail-t31-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Nissan X-Trail T31',
    h1: 'Гальмівні колодки задні Nissan X-Trail T31',
    metaTitle: 'Колодки задні X-Trail T31 від 362 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Nissan X-Trail T31 (2007-2013) в наявності від 362 грн (ASAM) — цей же супорт відповідає і за стоянкове гальмо (ручник). Доставка по Україні.',
    intro:
      'Задні гальмівні колодки для Nissan X-Trail T31 (2007-2013) — підходять і для Qashqai J10, Murano з тим самим заднім супортом. На T31 стоянкове гальмо (ручник) механічно вбудоване в задній супорт — окремої деталі "колодки ручника" не існує, саме ці колодки відповідають і за стоянкове гальмування.',
    matchGroups: [['колодк'], ['зад'], ['x-trail', 'xtrail', 'x trail', 'х-трейл']],
    hideFromIndex: true,
    modelGroup: 'nissan-xtrail-t31',
    modelLabel: 'Nissan X-Trail T31',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'mazda-3-amortyzatory-zadni',
    name: 'Амортизатори задні Mazda 3',
    h1: 'Амортизатори задні Mazda 3',
    metaTitle: 'Амортизатори задні Mazda 3 від 646 грн | DominatorParts',
    metaDescription:
      'Амортизатори задні Mazda 3 (кузови BK, BL, BM) в наявності від 646 грн. Оберіть виробника і рік свого кузова зі списку товарів. Доставка по всій Україні.',
    intro:
      'Задні амортизатори для Mazda 3 всіх поколінь (BK 2003-2009, BL 2009-2013, BM 2013-) — уточнюйте кузов і рік вашого авто в описі товару перед покупкою.',
    matchGroups: [['амортизатор '], ['зад'], ['mazda 3 ', 'mazda 3,', 'mazda 3/5', 'мазда 3 ', 'мазда 3,', 'мазда 3/5']],
    hideFromIndex: true,
    modelGroup: 'mazda-3',
    modelLabel: 'Mazda 3',
    parentCategorySlug: 'amortyzatory',
  },
  {
    slug: 'mazda-3-stiyka-amortyzatora-peredni',
    name: 'Стійки амортизатора передні Mazda 3',
    h1: 'Стійки амортизатора передні Mazda 3',
    metaTitle: 'Стійки амортизатора передні Mazda 3 від 1476 грн | DominatorParts',
    metaDescription:
      'Стійки амортизатора передні Mazda 3 (кузови BK, BL, BM) в наявності від 1476 грн (TASHIKO), ліва і права. Оберіть рік свого кузова зі списку товарів. Доставка по Україні.',
    intro:
      'Передні стійки амортизатора (газові) для Mazda 3 всіх поколінь — ліва і права сторона окремо, уточнюйте кузов і рік вашого авто перед покупкою.',
    matchGroups: [
      ['стійк'],
      ['амортизатор'],
      ['перед'],
      ['mazda 3 ', 'mazda 3,', 'mazda 3/5', 'мазда 3 ', 'мазда 3,', 'мазда 3/5'],
    ],
    hideFromIndex: true,
    modelGroup: 'mazda-3',
    modelLabel: 'Mazda 3',
    parentCategorySlug: 'amortyzatory',
  },

  // ============================================================
  // ХВИЛЯ 8 — Toyota Avensis T25. Honda CR-V II (RD, 2001-2006) із
  // цієї ж хвилі НЕ додана: весь наявний залишок амортизаторів Honda
  // CR-V — це 1-е покоління (RD1/RD3, 1995-2002) або 3-4-5-е
  // (перевірено і по назві товару, і окремо по tecdoc_compatibility
  // для позицій без року в назві) — під 2-е покоління (RD4-RD7,
  // 2003-2008), на яке є підтверджений попит, у наявності 0.
  //
  // Avensis T25: в наявності лише 3 задні амортизатори (рівно поріг),
  // переднього під це покоління зараз немає — тому сторінка саме
  // "задні", без переднього. Відсіяно Avensis Verso (інша модель),
  // T22 (роки "97-03" — попереднє покоління) і T27 (2008-2018 —
  // наступне). ZZT250 — заводський код кузова T25.
  // ============================================================
  {
    slug: 'avensis-t25-amortyzatory-zadni',
    name: 'Амортизатори задні Toyota Avensis T25',
    h1: 'Амортизатори задні Toyota Avensis T25',
    metaTitle: 'Амортизатори задні Avensis T25 від 856 грн | DominatorParts',
    metaDescription:
      'Амортизатори задні Toyota Avensis T25 (2003-2008) в наявності від 856 грн (RAISO). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Задні амортизатори для Toyota Avensis T25 (2003-2008, кузов ZZT250) — газові, в наявності декілька виробників.',
    matchGroups: [
      ['амортизатор '],
      ['зад'],
      ['avensis', 'авенсіс', 'авенсис'],
      ['t25', 'zzt25', '03-08', '03-09', '2003-2008', '2003-2009'],
    ],
    hideFromIndex: true,
    modelGroup: 'toyota-avensis-t25',
    modelLabel: 'Toyota Avensis T25',
    parentCategorySlug: 'amortyzatory',
  },

  // ============================================================
  // ХВИЛЯ 9 — Nissan Primera P11 і Nissan Qashqai J11. На відміну
  // від хвиль 7-8, тут попит спершу перевірено безпосередньо в
  // Google Ads Планувальнику ключових слів (акаунт DOMINATOR) — з
  // 6 кандидатів, підібраних лише за залишком, попит підтвердився
  // тільки в цих двох (решта — Subaru Impreza GC/GF, Nissan Sentra
  // N16, Toyota Corolla E11 (старий кузов), Mitsubishi Galant E3_A —
  // 0-10 запитів/міс за всіма формулюваннями, як і Honda Fit/Toyota
  // Yaris в попередніх хвилях — сторінки НЕ створено).
  //
  // Qashqai J11: на відміну від J10 (хвиля 7, де TecDoc взагалі не
  // має даних), для J11 TecDoc-покриття є — тому тут, як і в хвилі 6,
  // модель підбирається через tecdocVehicle (join по бренду+артикулу),
  // а matchGroups визначає лише тип деталі. Це навмисно ловить і
  // товари з порожньою/загальною назвою на кшталт "Тормозные колодки,
  // задние" — без tecdocVehicle такі товари взагалі не потрапили б на
  // сторінку.
  //
  // Primera P11: навпаки, постачальники самі пишуть "Nissan Primera"
  // в назві (tecdoc для частини цих SKU не заведений), тому модель —
  // підрядком, як у хвилях 1-4/7-8. Деякі товари одночасно підходять
  // і під P10 (спільна деталь на обидва кузови по каталогу
  // виробника) — це нормальна крос-сумісність, а не помилка підбору.
  // ============================================================
  {
    slug: 'primera-p11-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Nissan Primera P11',
    h1: 'Гальмівні колодки передні Nissan Primera P11',
    metaTitle: 'Колодки передні Primera P11 від 387 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Nissan Primera P11 (1996-2002) в наявності від 387 грн (NIPPON). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Nissan Primera P11 (1996-2002) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед'], ['primera', 'примера']],
    hideFromIndex: true,
    modelGroup: 'nissan-primera-p11',
    modelLabel: 'Nissan Primera P11',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'qashqai-j11-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Nissan Qashqai J11',
    h1: 'Гальмівні колодки задні Nissan Qashqai J11',
    metaTitle: 'Колодки задні Qashqai J11 від 686 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Nissan Qashqai J11 (2013-2021) в наявності від 686 грн (JAPANPARTS). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Задні гальмівні колодки для Nissan Qashqai II (J11, 2013-2021) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: { make: 'NISSAN', models: ['QASHQAI (J11, J11_)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-qashqai-j11',
    modelLabel: 'Nissan Qashqai J11',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 10 — Toyota Carina E і Mitsubishi Carisma. Кандидатів
  // спершу знайдено по залишку (широке покриття категорій деталей —
  // ознака "живої" моделі), потім усі 6 перевірено в тому ж
  // Google Ads Планувальнику (акаунт DOMINATOR). Важливий нюанс:
  // латиницею ("toyota carina e", "mitsubishi carisma") попит
  // показував 0-10/міс — і тільки коли ввела ті самі запити
  // кирилицею ("тойота каріна е", "мітсубісі карізма"), Планувальник
  // сам розширив пошук і показав "10-100/міс, Високий" — тобто
  // реальний попит є, просто люди шукають кирилицею, а не назвою
  // бренду. Avensis T22, Primera P10 і Civic EJ/EK перевірені і
  // латиницею, і кирилицею — 0-10/міс скрізь, сторінки НЕ створено.
  //
  // Обидва товари в основному приходять від постачальника з
  // загальними назвами на кшталт "Тормозные колодки, дисковые" (без
  // моделі авто в тексті) — тому, як і в хвилі 6/Qashqai J11,
  // модель підбирається через tecdocVehicle, а не підрядком.
  // ============================================================
  {
    slug: 'carina-e-halmivni-kolodky',
    name: 'Гальмівні колодки Toyota Carina E',
    h1: 'Гальмівні колодки Toyota Carina E',
    metaTitle: 'Колодки гальмівні Carina E від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки Toyota Carina E (1992-1997) в наявності від 621 грн (BENDIX). Дискові та барабанні, доставка по всій Україні.',
    intro:
      'Гальмівні колодки для Toyota Carina E (T19, 1992-1997) — дискові передні/задні та барабанні варіанти, підібрані за офіційним індексом сумісності запчастин TecDoc.',
    matchGroups: [['колодк']],
    tecdocVehicle: {
      make: 'TOYOTA',
      models: ['CARINA E Schrägheck (_T19_)', 'CARINA E Stufenheck (_T19_)', 'CARINA E Sportswagon (_T19_)'],
    },
    hideFromIndex: true,
    modelGroup: 'toyota-carina-e',
    modelLabel: 'Toyota Carina E',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'carisma-halmivni-kolodky',
    name: 'Гальмівні колодки Mitsubishi Carisma',
    h1: 'Гальмівні колодки Mitsubishi Carisma',
    metaTitle: 'Колодки гальмівні Carisma від 566 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки Mitsubishi Carisma (1995-2004) в наявності від 566 грн (STELLOX). Передні та задні, доставка по всій Україні, оплата при отриманні.',
    intro:
      'Гальмівні колодки для Mitsubishi Carisma (DA_, 1995-2004) — передні та задні варіанти різних виробників, підходять і для Volvo S40/V40 з тією ж платформою.',
    matchGroups: [['колодк']],
    tecdocVehicle: { make: 'MITSUBISHI', models: ['CARISMA (DA_)', 'CARISMA Stufenheck (DA_)'] },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-carisma',
    modelLabel: 'Mitsubishi Carisma',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 11 — німецько-чеська/французька група (Audi/Skoda/VW/
  // Citroën), без перевірки попиту в Google Ads (пропущено за
  // прямою вказівкою — "да делай" без окремого запиту на перевірку
  // Планувальником, на відміну від хвиль 9/10).
  //
  // ВАЖЛИВИЙ НЮАНС, знайдений під час збору: майже всі товари тут —
  // це ті самі універсальні BENDIX/STELLOX колодки, що фізично
  // підходять одразу до десятків моделей платформи (наприклад,
  // BENDIX 571984B одночасно "Audi A3, TT; Seat Leon; Skoda Octavia;
  // VW Golf, Polo, Bora"). Це означає, що передні гальмівні колодки
  // НЕ відрізняються між кузовами седан/універсал одного покоління —
  // тому, на відміну від деяких попередніх хвиль, тут НЕ зроблено
  // окремих сторінок на кожен кузов (це був би дублікат контенту
  // з однаковим списком товарів під різним H1). Замість цього —
  // один tecdocVehicle.models з обома кузовами разом, той самий
  // підхід, що вже використано для CAMRY Stufenheck вище (кілька
  // поколінь в одному масиві на одній сторінці).
  {
    slug: 'audi-a4-b5-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Audi A4 (B5)',
    h1: 'Гальмівні колодки передні Audi A4 (B5)',
    metaTitle: 'Колодки передні Audi A4 B5 від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Audi A4 B5 (1994-2001, седан і універсал) в наявності від 621 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Audi A4 B5 (1994-2001) — підходять і на седан (Stufenheck), і на універсал (Avant), в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'AUDI', models: ['A4 Stufenheck (8D2, B5)', 'A4 Avant (8D5, B5)'] },
    hideFromIndex: true,
    modelGroup: 'audi-a4-b5',
    modelLabel: 'Audi A4 (B5)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'audi-a6-c5-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Audi A6 (C5)',
    h1: 'Гальмівні колодки передні Audi A6 (C5)',
    metaTitle: 'Колодки передні Audi A6 C5 від 828 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Audi A6 C5 (1997-2005, седан і універсал) в наявності від 828 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Audi A6 C5 (1997-2005) — підходять і на седан (Stufenheck), і на універсал (Avant), в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'AUDI', models: ['A6 Stufenheck (4B2, C5)', 'A6 Avant (4B5, C5)'] },
    hideFromIndex: true,
    modelGroup: 'audi-a6-c5',
    modelLabel: 'Audi A6 (C5)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'octavia-1u-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Škoda Octavia (1U)',
    h1: 'Гальмівні колодки передні Škoda Octavia (1U)',
    metaTitle: 'Колодки передні Octavia 1U від 828 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Škoda Octavia 1U (1996-2010, седан і Combi) в наявності від 828 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Škoda Octavia 1U (1996-2010) — підходять і на седан/хетчбек, і на Combi, в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'SKODA', models: ['OCTAVIA (1U2)', 'OCTAVIA Combi (1U5)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-octavia-1u',
    modelLabel: 'Škoda Octavia (1U)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'fabia-6y-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Škoda Fabia (6Y)',
    h1: 'Гальмівні колодки передні Škoda Fabia (6Y)',
    metaTitle: 'Колодки передні Fabia 6Y від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Škoda Fabia 6Y (1999-2008, хетчбек і Combi) в наявності від 621 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Škoda Fabia 6Y (1999-2008) — підходять і на хетчбек, і на Combi, в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'SKODA', models: ['FABIA (6Y2)', 'FABIA Combi (6Y5)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-fabia-6y',
    modelLabel: 'Škoda Fabia (6Y)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'polo-9n-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні VW Polo (9N)',
    h1: 'Гальмівні колодки передні VW Polo (9N)',
    metaTitle: 'Колодки передні Polo 9N від 438 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні VW Polo 9N (2001-2012) в наявності від 438 грн (STELLOX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для VW Polo 9N (2001-2012) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'VW', models: ['POLO (9N_)'] },
    hideFromIndex: true,
    modelGroup: 'vw-polo-9n',
    modelLabel: 'VW Polo (9N)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'jetta-4-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні VW Jetta IV',
    h1: 'Гальмівні колодки передні VW Jetta IV',
    metaTitle: 'Колодки передні Jetta IV від 880 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні VW Jetta IV (1998-2005) в наявності від 880 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для VW Jetta IV (1998-2005) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'VW', models: ['JETTA IV (1J2)'] },
    hideFromIndex: true,
    modelGroup: 'vw-jetta-4',
    modelLabel: 'VW Jetta IV',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'berlingo-mf-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Citroën Berlingo (MF)',
    h1: 'Гальмівні колодки передні Citroën Berlingo (MF)',
    metaTitle: 'Колодки передні Berlingo MF від 530 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Citroën Berlingo MF (1996-2005) в наявності від 530 грн (STELLOX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Citroën Berlingo MF (1996-2005) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'CITROËN', models: ['BERLINGO (MF)'] },
    hideFromIndex: true,
    modelGroup: 'citroen-berlingo-mf',
    modelLabel: 'Citroën Berlingo (MF)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'xsara-n1-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Citroën Xsara (N1)',
    h1: 'Гальмівні колодки передні Citroën Xsara (N1)',
    metaTitle: 'Колодки передні Xsara N1 від 530 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Citroën Xsara N1 (1997-2005) в наявності від 530 грн (STELLOX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Citroën Xsara N1 (1997-2005) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'CITROËN', models: ['XSARA (N1)'] },
    hideFromIndex: true,
    modelGroup: 'citroen-xsara-n1',
    modelLabel: 'Citroën Xsara (N1)',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 12 — не-VAG моделі (Subaru/Mitsubishi/Ford/Mercedes/Mazda/
  // Opel), знову без перевірки Google Ads. На цей раз навмисно
  // обрано моделі ПОЗА платформою Audi/Skoda/VW/Seat з хвилі 11 —
  // там частина "кандидатів" виявилась тими самими BENDIX-колодками,
  // що й уже опубліковані сторінки (реальний дублікат контенту).
  // Тут перевірено окремо: жодна модель нижче не показує той самий
  // набір товарів, що інша модель з цієї чи попередніх хвиль.
  //
  // Kolodky TEIKIN (поршні) навмисно ПРОПУЩЕНО за прямою вказівкою:
  // бренд відсутній у tecdoc_compatibility взагалі (жодного рядка),
  // а в назвах товару моделі/двигуна майже завжди немає — коректно
  // підібрати сторінку під конкретну модель зараз неможливо.
  {
    slug: 'subaru-impreza-gc-gf-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Subaru Impreza (GC/GF)',
    h1: 'Гальмівні колодки передні Subaru Impreza (GC/GF)',
    metaTitle: 'Колодки передні Subaru Impreza від 430 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Subaru Impreza GC/GF (1992-2000, седан і універсал) в наявності від 430 грн (STELLOX). Доставка по всій Україні.',
    intro:
      'Передні гальмівні колодки для Subaru Impreza GC/GF (1992-2000) — підходять і на седан, і на універсал, в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'SUBARU', models: ['IMPREZA Stufenheck (GC)', 'IMPREZA Station Wagon (GF)'] },
    hideFromIndex: true,
    modelGroup: 'subaru-impreza-gc-gf',
    modelLabel: 'Subaru Impreza (GC/GF)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'mitsubishi-l400-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Mitsubishi L400 / Space Gear',
    h1: 'Гальмівні колодки передні Mitsubishi L400 / Space Gear',
    metaTitle: 'Колодки передні Mitsubishi L400 від 556 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Mitsubishi L400 / Space Gear (1995-2005) в наявності від 556 грн (STELLOX). Доставка по всій Україні.',
    intro:
      'Передні гальмівні колодки для мікроавтобуса Mitsubishi L400 / Space Gear (1995-2005) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: {
      make: 'MITSUBISHI',
      models: ['L 400 / SPACE GEAR Bus (PD_W, PC_W, PA_V, PB_V)', 'L 400 Kasten (PD_W, PC_W, PB_V, PA_W, PA_V)'],
    },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-l400',
    modelLabel: 'Mitsubishi L400 / Space Gear',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'ford-sierra-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Ford Sierra',
    h1: 'Гальмівні колодки передні Ford Sierra',
    metaTitle: 'Колодки передні Ford Sierra від 414 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Ford Sierra (1982-1987) в наявності від 414 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Ford Sierra (1982-1987) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'FORD', models: ['SIERRA Schrägheck (GBC)'] },
    hideFromIndex: true,
    modelGroup: 'ford-sierra',
    modelLabel: 'Ford Sierra',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'mercedes-e-class-c124-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Mercedes-Benz E-Class Coupe (C124)',
    h1: 'Гальмівні колодки задні Mercedes-Benz E-Class Coupe (C124)',
    metaTitle: 'Колодки задні E-Class C124 від 673 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Mercedes-Benz E-Class Coupe C124 (1993-1997) в наявності від 673 грн (BENDIX). Доставка по всій Україні.',
    intro:
      'Задні гальмівні колодки для Mercedes-Benz E-Class Coupe C124 (1993-1997) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: { make: 'MERCEDES-BENZ', models: ['E-CLASS Coupe (C124)'] },
    hideFromIndex: true,
    modelGroup: 'mercedes-e-class-c124',
    modelLabel: 'Mercedes-Benz E-Class Coupe (C124)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'mazda-626-mk3-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Mazda 626 Mk III',
    h1: 'Гальмівні колодки задні Mazda 626 Mk III',
    metaTitle: 'Колодки задні Mazda 626 від 629 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Mazda 626 Mk III (1987-1997, кузови GD/GV) в наявності від 629 грн (ABE). Доставка по всій Україні.',
    intro:
      'Задні гальмівні колодки для Mazda 626 Mk III (1987-1997) — підходять на купе (GD) і комбі (GV), в наявності декілька виробників.',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: { make: 'MAZDA', models: ['626 Mk III Coupe (GD)', '626 Mk III Kombi (GV)'] },
    hideFromIndex: true,
    modelGroup: 'mazda-626-mk3',
    modelLabel: 'Mazda 626 Mk III',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'opel-vectra-c-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Opel Vectra C',
    h1: 'Гальмівні колодки задні Opel Vectra C',
    metaTitle: 'Колодки задні Opel Vectra C від 739 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Opel Vectra C (2002-2008) в наявності від 739 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Задні гальмівні колодки для Opel Vectra C (2002-2008) — в наявності декілька постачальників.',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: { make: 'OPEL', models: ['VECTRA C'] },
    hideFromIndex: true,
    modelGroup: 'opel-vectra-c',
    modelLabel: 'Opel Vectra C',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 13 — без перевірки Google Ads. Цього разу під час підбору
  // ДВІЧІ спрацювало правило "спершу звірити товарний список,
  // а вже потім будувати сторінку": Subaru Legacy II (BD, BG) і
  // Mercedes C-Class Stufenheck (W202) відсіяні — обидва показали
  // повний піднабір того самого товарного списку, що вже є на
  // опублікованих сторінках Subaru Impreza (хвиля 12) і Mercedes
  // E-Class Coupe C124 (хвиля 12) відповідно — тобто були б чистим
  // дублікатом контенту з іншим H1. Причина та сама, що й з
  // Opel/Vauxhall/Saab/Mazda Telstar у хвилі 11-12: один запчастинний
  // пул під кількома назвами моделі в TecDoc.
  {
    slug: 'nissan-sentra-n15-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Nissan Sentra (N15)',
    h1: 'Гальмівні колодки передні Nissan Sentra (N15)',
    metaTitle: 'Колодки передні Nissan Sentra N15 від 621 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Nissan Sentra N15 в наявності від 621 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Nissan Sentra N15 — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'NISSAN', models: ['SENTRA I (N15)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-sentra-n15',
    modelLabel: 'Nissan Sentra (N15)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'nissan-sentra-n16-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Nissan Sentra (N16)',
    h1: 'Гальмівні колодки передні Nissan Sentra (N16)',
    metaTitle: 'Колодки передні Nissan Sentra N16 від 673 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Nissan Sentra N16 в наявності від 673 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Передні гальмівні колодки для Nissan Sentra N16 — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'NISSAN', models: ['SENTRA II (N16)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-sentra-n16',
    modelLabel: 'Nissan Sentra (N16)',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'touareg-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні VW Touareg',
    h1: 'Гальмівні колодки задні VW Touareg',
    metaTitle: 'Колодки задні VW Touareg від 1139 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні VW Touareg (перше покоління) в наявності від 1139 грн (BENDIX). Доставка по всій Україні.',
    intro: 'Задні гальмівні колодки для VW Touareg (7L) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: { make: 'VW', models: ['TOUAREG (7LA, 7L6, 7L7)'] },
    hideFromIndex: true,
    modelGroup: 'vw-touareg',
    modelLabel: 'VW Touareg',
    parentCategorySlug: 'halmivni-kolodky',
  },
  {
    slug: 'sprinter-lt-halmivni-kolodky-zadni',
    name: 'Гальмівні колодки задні Mercedes-Benz Sprinter / VW LT',
    h1: 'Гальмівні колодки задні Mercedes-Benz Sprinter / VW LT',
    metaTitle: 'Колодки задні Sprinter / VW LT від 777 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки задні Mercedes-Benz Sprinter / VW LT (1995-2006, усі вантажопідйомності й кузови) в наявності від 777 грн (BENDIX). Доставка по всій Україні.',
    intro:
      'Задні гальмівні колодки для Mercedes-Benz Sprinter та VW LT (1995-2006) — обидва фургони збудовані на одній платформі й використовують ті самі колодки, незалежно від вантажопідйомності (2-4т) чи кузова (Bus/Kasten/Pritsche).',
    matchGroups: [['колодк'], ['зад']],
    tecdocVehicle: {
      make: 'MERCEDES-BENZ',
      models: [
        'SPRINTER 2-t Bus (901, 902)', 'SPRINTER 2-t Kasten (901, 902)', 'SPRINTER 2-t Pritsche/Fahrgestell (901, 902)',
        'SPRINTER 3-t Bus (903)', 'SPRINTER 3-t Kasten (903)', 'SPRINTER 3-t Pritsche/Fahrgestell (903)',
        'SPRINTER 4-t Bus (904)', 'SPRINTER 4-t Kasten (904)',
      ],
    },
    hideFromIndex: true,
    modelGroup: 'mercedes-sprinter-vw-lt',
    modelLabel: 'Mercedes-Benz Sprinter / VW LT',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 14 — лише 1 сторінка. Це навмисно: цього разу перевірка
  // на дублікат контенту (за реальним списком артикулів, а не на
  // око) відсіяла майже всіх кандидатів:
  //   - VW Jetta III (1H2) — усі 9 товарів уже показані на сторінках
  //     Seat Ibiza Mk II/Cordoba (ця хвиля) і Audi A4 B5 (хвиля 11);
  //   - VW Polo (6N1) — усі 6 товарів уже на сторінках Ibiza Mk II
  //     і Fabia/Polo 9N (хвиля 11);
  //   - Seat Cordoba Stufenheck (6K1, 6K2) — точний піднабір Seat
  //     Ibiza Mk II (той самий кузов-платформа), тому об'єднано
  //     в одну сторінку нижче, а не дубльовано;
  //   - Opel/Vauxhall Vectra Mk II (C), Signum, Saab 9-3 — той
  //     самий запчастинний пул, що вже опублікований Opel Vectra C
  //     (хвиля 12);
  //   - Mazda Telstar III/IV, 323 IV, Etude IV — той самий пул, що
  //     Mazda 626 Mk III (хвиля 12);
  //   - Mercedes C-Class Stufenheck (W202) — той самий пул, що
  //     E-Class Coupe C124 (хвиля 12, вже відсіяно раніше);
  //   - BMW 3 E90/E91 (стійки амортизатора передні) — формально
  //     3 SKU, але фактично лише ОДНА пара стійок KYB (ліва+права)
  //     плюс одна опора амортизатора, яка підходить одразу на 6
  //     різних поколінь BMW E46-E61 — це не "вибір з кількох
  //     виробників", а один товар у двох частинах, сторінку не
  //     зроблено;
  //   - Dodge Caliber (амортизатори передні) — 3 SKU, але дуже
  //     дорогі (6825 грн+) і нішеві для України, попит малоймовірний.
  //
  // Категорії "Повітряний/Салонний/Оливний фільтр" на порозі
  // "≥3 SKU і ≥15 шт в наявності" взагалі не дали жодної нової
  // моделі — фільтри в цьому каталозі не концентруються навколо
  // конкретних моделей так само щільно, як колодки.
  {
    slug: 'seat-ibiza-2-cordoba-halmivni-kolodky-peredni',
    name: 'Гальмівні колодки передні Seat Ibiza Mk II / Cordoba',
    h1: 'Гальмівні колодки передні Seat Ibiza Mk II / Cordoba',
    metaTitle: 'Колодки передні Seat Ibiza / Cordoba від 363 грн | DominatorParts',
    metaDescription:
      'Гальмівні колодки передні Seat Ibiza Mk II / Cordoba (1993-1999) в наявності від 363 грн (BENDIX). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Передні гальмівні колодки для Seat Ibiza Mk II та Cordoba (1993-1999, спільна платформа) — в наявності декілька виробників.',
    matchGroups: [['колодк'], ['перед']],
    tecdocVehicle: { make: 'SEAT', models: ['IBIZA Mk II (6K1)', 'CORDOBA Stufenheck (6K1, 6K2)'] },
    hideFromIndex: true,
    modelGroup: 'seat-ibiza-2-cordoba',
    modelLabel: 'Seat Ibiza Mk II / Cordoba',
    parentCategorySlug: 'halmivni-kolodky',
  },

  // ============================================================
  // ХВИЛЯ 15 — перший вихід за межі гальмівних колодок: сайлентблоки
  // важеля, втулки стабілізатора, кульові опори, підшипники маточини
  // (за прямою вказівкою). Підшипники маточини не дали жодного
  // нового кандидата з порогом "≥3 SKU і ≥15 шт" — розділ пропущено.
  //
  // Тут виявився ще жорсткіший варіант проблеми з хвиль 11-14:
  // одні й ті самі артикули (переважно TRW/DELPHI/FEBEST/GSP/YAMATO)
  // повторюються НЕ ТІЛЬКИ між кузовами однієї моделі, а й між
  // РІЗНИМИ БРЕНДАМИ одразу (наприклад, Renault Clio III і Nissan
  // Micra K12 показують ідентичний товарний список — очевидно,
  // це узагальнені "автомобільні" сайлентблоки одного постачальника,
  // а не щось специфічне для конкретної моделі). Це не привід
  // відмовитись від сторінки — покупець з конкретним авто шукає
  // саме свою марку/модель, а не постачальника деталі — але це
  // привід ОБ'ЄДНАТИ кузови/бейджі однієї й тієї ж фізичної моделі
  // в одну сторінку, як і в попередніх хвилях:
  //   - Nissan Micra C+C і March III — одна модель (K12) під двома
  //     назвами (JDM "March" = експортна "Micra");
  //   - Renault Clio III (седан/хетчбек) і Clio Grandtour (універсал)
  //     — той самий кузов-платформа;
  //   - Toyota Vitz (SCP1_/NLP1_/NCP1_) і Echo Verso — той самий
  //     Vitz-платформ мінівен під іншою назвою для деяких ринків;
  //   - Mitsubishi Legnum VI і Aspire VI — той самий кузов EA_ під
  //     різними бейджами.
  // Nissan Armada (R51) і Nissan NP300 (D40) відсіяні повністю —
  // обидва показали 100% той самий список, що вже опублікований
  // Nissan Frontier (D40) нижче.
  {
    slug: 'nissan-micra-march-k12-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Nissan Micra / March (K12)',
    h1: 'Сайлентблоки важеля Nissan Micra / March (K12)',
    metaTitle: 'Сайлентблоки Nissan Micra / March K12 від 192 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Nissan Micra / March K12 (2003-2010) в наявності від 192 грн (DELPHI). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Nissan Micra / March K12 (2003-2010, одна й та сама модель під різними назвами) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'NISSAN', models: ['MICRA C+C (K12)', 'MARCH III (K12)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-micra-march-k12',
    modelLabel: 'Nissan Micra / March (K12)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'renault-clio-3-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Renault Clio III',
    h1: 'Сайлентблоки важеля Renault Clio III',
    metaTitle: 'Сайлентблоки Renault Clio III від 192 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Renault Clio III (2005-2010, хетчбек і універсал) в наявності від 192 грн (DELPHI). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Renault Clio III (2005-2010) — підходять і на хетчбек, і на універсал (Grandtour), в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'RENAULT', models: ['EURO CLIO III (BR0/1, CR0/1)', 'CLIO Grandtour (KR0/1_)'] },
    hideFromIndex: true,
    modelGroup: 'renault-clio-3',
    modelLabel: 'Renault Clio III',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'renault-modus-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Renault Modus',
    h1: 'Сайлентблоки важеля Renault Modus',
    metaTitle: 'Сайлентблоки Renault Modus від 192 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Renault Modus / Grand Modus (з 2004) в наявності від 192 грн (DELPHI). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Renault Modus / Grand Modus (з 2004) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'RENAULT', models: ['MODUS / GRAND MODUS (F/JP0_)'] },
    hideFromIndex: true,
    modelGroup: 'renault-modus',
    modelLabel: 'Renault Modus',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'nissan-murano-z51-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Nissan Murano (Z51)',
    h1: 'Сайлентблоки важеля Nissan Murano (Z51)',
    metaTitle: 'Сайлентблоки Nissan Murano Z51 від 326 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Nissan Murano Z51 (з 2007) в наявності від 326 грн (FEBEST). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Nissan Murano Z51 (з 2007) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'NISSAN', models: ['MURANO (Z51)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-murano-z51',
    modelLabel: 'Nissan Murano (Z51)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'nissan-quest-e52-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Nissan Quest (E52)',
    h1: 'Сайлентблоки важеля Nissan Quest (E52)',
    metaTitle: 'Сайлентблоки Nissan Quest E52 від 326 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Nissan Quest E52 (з 2010) в наявності від 326 грн (FEBEST). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Nissan Quest E52 (з 2010) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'NISSAN', models: ['QUEST (E52)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-quest-e52',
    modelLabel: 'Nissan Quest (E52)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'nissan-maxima-j32-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Nissan Maxima (J32)',
    h1: 'Сайлентблоки важеля Nissan Maxima (J32)',
    metaTitle: 'Сайлентблоки Nissan Maxima J32 від 1043 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Nissan Maxima J32 (з 2008, у СНД також відома як Teana) в наявності від 1043 грн (FEBEST). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Nissan Maxima J32 (з 2008; той самий кузов на деяких ринках продавався як Nissan Teana) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'NISSAN', models: ['MAXIMA V (J32)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-maxima-j32',
    modelLabel: 'Nissan Maxima (J32)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'mitsubishi-galant-4-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Mitsubishi Galant Mk IV',
    h1: 'Сайлентблоки важеля Mitsubishi Galant Mk IV',
    metaTitle: 'Сайлентблоки Mitsubishi Galant IV від 167 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Mitsubishi Galant Mk IV (1987-1992) в наявності від 167 грн (YAMATO). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Mitsubishi Galant Mk IV (1987-1992, той самий кузов продавався в Японії і як Mitsubishi Eterna) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'MITSUBISHI', models: ['GALANT Mk IV Stufenheck (E3_A)', 'ETERNA IV (E3_A)'] },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-galant-4',
    modelLabel: 'Mitsubishi Galant Mk IV',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'toyota-vitz-echo-verso-vtulky-stabilizatora',
    name: 'Втулки стабілізатора Toyota Vitz / Echo Verso',
    h1: 'Втулки стабілізатора Toyota Vitz / Echo Verso',
    metaTitle: 'Втулки стабілізатора Toyota Vitz від 51 грн | DominatorParts',
    metaDescription:
      'Втулки стабілізатора Toyota Vitz / Echo Verso (1999-2005) в наявності від 51 грн (GSP). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Втулки стабілізатора поперечної стійкості для Toyota Vitz / Echo Verso (1999-2005, спільна платформа) — в наявності декілька виробників.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз']],
    tecdocVehicle: { make: 'TOYOTA', models: ['VITZ (SCP1_, NLP1_, NCP1_)', 'ECHO VERSO (_NLP2_, _NCP2_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-vitz-echo-verso',
    modelLabel: 'Toyota Vitz / Echo Verso',
    parentCategorySlug: 'vtulky-stabilizatora',
  },
  {
    slug: 'toyota-vitz-2-vtulky-stabilizatora',
    name: 'Втулки стабілізатора Toyota Vitz (2 покоління)',
    h1: 'Втулки стабілізатора Toyota Vitz (2 покоління)',
    metaTitle: 'Втулки стабілізатора Toyota Vitz від 62 грн | DominatorParts',
    metaDescription:
      'Втулки стабілізатора Toyota Vitz 2 покоління (з 2005) в наявності від 62 грн (YAMATO). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Втулки стабілізатора поперечної стійкості для Toyota Vitz 2 покоління (з 2005) — в наявності декілька виробників.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз']],
    tecdocVehicle: { make: 'TOYOTA', models: ['VITZ (SCP9_, NSP9_, KSP9_, NCP9_, ZSP9_)'] },
    hideFromIndex: true,
    modelGroup: 'toyota-vitz-2',
    modelLabel: 'Toyota Vitz (2 покоління)',
    parentCategorySlug: 'vtulky-stabilizatora',
  },
  {
    slug: 'mitsubishi-legnum-aspire-vtulky-stabilizatora',
    name: 'Втулки стабілізатора Mitsubishi Legnum / Aspire',
    h1: 'Втулки стабілізатора Mitsubishi Legnum / Aspire',
    metaTitle: 'Втулки стабілізатора Mitsubishi Legnum від 90 грн | DominatorParts',
    metaDescription:
      'Втулки стабілізатора Mitsubishi Legnum / Aspire (1996-2003) в наявності від 90 грн (GSP). Доставка по всій Україні, оплата при отриманні.',
    intro:
      'Втулки стабілізатора поперечної стійкості для Mitsubishi Legnum / Aspire (1996-2003, той самий кузов під різними бейджами) — в наявності декілька виробників.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз']],
    tecdocVehicle: { make: 'MITSUBISHI', models: ['LEGNUM VI Station Wagon (EA_)', 'ASPIRE VI (EA_)'] },
    hideFromIndex: true,
    modelGroup: 'mitsubishi-legnum-aspire',
    modelLabel: 'Mitsubishi Legnum / Aspire',
    parentCategorySlug: 'vtulky-stabilizatora',
  },
  {
    slug: 'honda-edix-vtulky-stabilizatora',
    name: 'Втулки стабілізатора Honda Edix',
    h1: 'Втулки стабілізатора Honda Edix',
    metaTitle: 'Втулки стабілізатора Honda Edix від 69 грн | DominatorParts',
    metaDescription:
      'Втулки стабілізатора Honda Edix (2004-2006) в наявності від 69 грн (GSP). Доставка по всій Україні, оплата при отриманні.',
    intro: 'Втулки стабілізатора поперечної стійкості для Honda Edix (2004-2006) — в наявності декілька виробників.',
    matchGroups: [['втулк'], ['стабіліз', 'стабилиз']],
    tecdocVehicle: { make: 'HONDA', models: ['EDIX (BE)'] },
    hideFromIndex: true,
    modelGroup: 'honda-edix',
    modelLabel: 'Honda Edix',
    parentCategorySlug: 'vtulky-stabilizatora',
  },
  {
    slug: 'nissan-frontier-d40-kulovi-opory',
    name: 'Кульові опори Nissan Frontier (D40)',
    h1: 'Кульові опори Nissan Frontier (D40)',
    metaTitle: 'Кульова опора Nissan Frontier D40 від 707 грн | DominatorParts',
    metaDescription:
      'Кульові опори підвіски Nissan Frontier / Navara D40 (2004-2008) в наявності від 707 грн (MOOG). Доставка по всій Україні.',
    intro:
      'Кульові опори підвіски для Nissan Frontier / Navara D40 (2004-2008; той самий пікап продавався і як Nissan NP300) — в наявності декілька виробників.',
    matchGroups: [
      ['куль', 'шаров'],
      ['опор'],
    ],
    tecdocVehicle: { make: 'NISSAN', models: ['CAMIONES / FRONTIER (D40)', 'NP300 Pritsche/Fahrgestell (D40)'] },
    hideFromIndex: true,
    modelGroup: 'nissan-frontier-d40',
    modelLabel: 'Nissan Frontier (D40)',
    parentCategorySlug: 'kulovi-opory',
  },
  {
    slug: 'lexus-ls-kulovi-opory',
    name: 'Кульові опори Lexus LS',
    h1: 'Кульові опори Lexus LS',
    metaTitle: 'Кульова опора Lexus LS від 1144 грн | DominatorParts',
    metaDescription:
      'Кульові опори підвіски Lexus LS (з 2006) в наявності від 1144 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Кульові опори підвіски для Lexus LS (з 2006) — в наявності декілька виробників.',
    matchGroups: [
      ['куль', 'шаров'],
      ['опор'],
    ],
    tecdocVehicle: { make: 'LEXUS', models: ['LS Stufenheck (UVF4_, USF4_)'] },
    hideFromIndex: true,
    modelGroup: 'lexus-ls',
    modelLabel: 'Lexus LS',
    parentCategorySlug: 'kulovi-opory',
  },

  // ============================================================
  // ХВИЛЯ 16 — сайлентблоки для рекламної кампанії Google Ads.
  // На відміну від хвилі 15 (нішеві моделі), тут — марки з
  // найбільшим реальним залишком по сайлентблокам: VW, SEAT, BMW,
  // AUDI, SKODA, FORD (перевірено прямим SQL-запитом по складу).
  // Причина: рекламу на ці марки без своєї сторінки довелось би
  // вести на загальний каталожний розділ без згадки конкретної
  // марки — та сама помилка, що вже знайдена в кампанії на гальмівні
  // колодки Brembo/Ferodo.
  //
  // Дублі об'єднано за тим самим правилом, що і в попередніх
  // хвилях: кузови/покоління з ідентичним або підмножинним списком
  // артикулів — одна сторінка; різні модельні назви (навіть на
  // спільній платформі) — окремі сторінки.
  {
    slug: 'vw-golf-4-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля VW Golf IV',
    h1: 'Сайлентблоки важеля VW Golf IV',
    metaTitle: 'Сайлентблоки VW Golf IV від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски VW Golf IV (1997-2006, хетчбек і універсал) в наявності від 157 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Volkswagen Golf IV (1997-2006) — підходять і на хетчбек, і на універсал, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'VW', models: ['GOLF Mk IV (1J1)', 'GOLF Mk IV Estate (1J5)'] },
    hideFromIndex: true,
    modelGroup: 'vw-golf-4',
    modelLabel: 'VW Golf IV',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'vw-jetta-4-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля VW Jetta IV',
    h1: 'Сайлентблоки важеля VW Jetta IV',
    metaTitle: 'Сайлентблоки VW Jetta IV від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски VW Jetta IV (1998-2005, седан і універсал) в наявності від 157 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Volkswagen Jetta IV / Bora (1998-2005) — підходять і на седан, і на універсал, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'VW', models: ['JETTA IV (1J2)', 'JETTA IV Wagon (1J6)'] },
    hideFromIndex: true,
    modelGroup: 'vw-jetta-4',
    modelLabel: 'VW Jetta IV',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'vw-golf-3-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля VW Golf III',
    h1: 'Сайлентблоки важеля VW Golf III',
    metaTitle: 'Сайлентблоки VW Golf III від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски VW Golf III (1991-1997) в наявності від 157 грн (LEMFORDER). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Volkswagen Golf III (1991-1997) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'VW', models: ['GOLF Mk III (1H1)'] },
    hideFromIndex: true,
    modelGroup: 'vw-golf-3',
    modelLabel: 'VW Golf III',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'vw-polo-sedan-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля VW Polo Classic (седан)',
    h1: 'Сайлентблоки важеля VW Polo Classic (седан)',
    metaTitle: 'Сайлентблоки VW Polo Classic від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски VW Polo Classic седан (1995-2002) в наявності від 157 грн (LEMFORDER). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Volkswagen Polo Classic седан (1995-2002, кузов 6KV2) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'VW', models: ['POLO Stufenheck (6KV2)'] },
    hideFromIndex: true,
    modelGroup: 'vw-polo-sedan',
    modelLabel: 'VW Polo Classic (седан)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'vw-touareg-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля VW Touareg',
    h1: 'Сайлентблоки важеля VW Touareg',
    metaTitle: 'Сайлентблоки VW Touareg від 321 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски VW Touareg (2002-2010) в наявності від 321 грн (LEMFORDER). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Volkswagen Touareg (2002-2010) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'VW', models: ['TOUAREG (7LA, 7L6, 7L7)'] },
    hideFromIndex: true,
    modelGroup: 'vw-touareg',
    modelLabel: 'VW Touareg',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'seat-ibiza-2-cordoba-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Seat Ibiza Mk II / Cordoba',
    h1: 'Сайлентблоки важеля Seat Ibiza Mk II / Cordoba',
    metaTitle: 'Сайлентблоки Seat Ibiza / Cordoba від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Seat Ibiza Mk II / Cordoba (1993-2002) в наявності від 157 грн (LEMFORDER). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Seat Ibiza Mk II та Cordoba (1993-2002, спільна платформа) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SEAT', models: ['IBIZA Mk II (6K1)', 'IBIZA Mk III (6K1)', 'CORDOBA Stufenheck (6K1, 6K2)', 'CORDOBA (6K2)'] },
    hideFromIndex: true,
    modelGroup: 'seat-ibiza-2-cordoba',
    modelLabel: 'Seat Ibiza Mk II / Cordoba',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'seat-leon-1-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Seat Leon I',
    h1: 'Сайлентблоки важеля Seat Leon I',
    metaTitle: 'Сайлентблоки Seat Leon I від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Seat Leon I (1999-2006) в наявності від 157 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Сайлентблоки важеля підвіски для Seat Leon I (1999-2006) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SEAT', models: ['LEON (1M1)'] },
    hideFromIndex: true,
    modelGroup: 'seat-leon-1',
    modelLabel: 'Seat Leon I',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'seat-toledo-2-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Seat Toledo II',
    h1: 'Сайлентблоки важеля Seat Toledo II',
    metaTitle: 'Сайлентблоки Seat Toledo II від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Seat Toledo II (1998-2006) в наявності від 157 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Сайлентблоки важеля підвіски для Seat Toledo II (1998-2006) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SEAT', models: ['TOLEDO Mk II (1M2)'] },
    hideFromIndex: true,
    modelGroup: 'seat-toledo-2',
    modelLabel: 'Seat Toledo II',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'bmw-5-e39-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля BMW 5-Series (E39)',
    h1: 'Сайлентблоки важеля BMW 5-Series (E39)',
    metaTitle: 'Сайлентблоки BMW 5 E39 від 530 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски BMW 5-Series E39 (1995-2004, седан і Touring) в наявності від 530 грн (DELPHI). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для BMW 5-Series E39 (1995-2004) — підходять і на седан, і на універсал Touring, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'BMW', models: ['5 Stufenheck (E39)', '5 Touring (E39)'] },
    hideFromIndex: true,
    modelGroup: 'bmw-5-e39',
    modelLabel: 'BMW 5-Series (E39)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'bmw-7-e38-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля BMW 7-Series (E38)',
    h1: 'Сайлентблоки важеля BMW 7-Series (E38)',
    metaTitle: 'Сайлентблоки BMW 7 E38 від 530 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски BMW 7-Series E38 (1994-2001) в наявності від 530 грн (DELPHI). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для BMW 7-Series E38 (1994-2001) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'BMW', models: ['7 Stufenheck (E38)'] },
    hideFromIndex: true,
    modelGroup: 'bmw-7-e38',
    modelLabel: 'BMW 7-Series (E38)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'bmw-5-e60-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля BMW 5-Series (E60/E61)',
    h1: 'Сайлентблоки важеля BMW 5-Series (E60/E61)',
    metaTitle: 'Сайлентблоки BMW 5 E60 від 530 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски BMW 5-Series E60/E61 (2003-2010, седан і Touring) в наявності від 530 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для BMW 5-Series E60/E61 (2003-2010) — підходять і на седан, і на універсал Touring, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'BMW', models: ['5 Stufenheck (E60)', '5 Touring (E61)'] },
    hideFromIndex: true,
    modelGroup: 'bmw-5-e60',
    modelLabel: 'BMW 5-Series (E60/E61)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'bmw-7-e65-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля BMW 7-Series (E65/E66)',
    h1: 'Сайлентблоки важеля BMW 7-Series (E65/E66)',
    metaTitle: 'Сайлентблоки BMW 7 E65 від 530 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски BMW 7-Series E65/E66/E67 (2001-2008) в наявності від 530 грн. Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для BMW 7-Series E65/E66/E67 (2001-2008) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'BMW', models: ['7 Stufenheck (E65, E66, E67)'] },
    hideFromIndex: true,
    modelGroup: 'bmw-7-e65',
    modelLabel: 'BMW 7-Series (E65/E66)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'bmw-x5-e53-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля BMW X5 (E53)',
    h1: 'Сайлентблоки важеля BMW X5 (E53)',
    metaTitle: 'Сайлентблоки BMW X5 E53 від 244 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски BMW X5 E53 (1999-2006) в наявності від 244 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Сайлентблоки важеля підвіски для BMW X5 E53 (1999-2006) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'BMW', models: ['X5 (E53)'] },
    hideFromIndex: true,
    modelGroup: 'bmw-x5-e53',
    modelLabel: 'BMW X5 (E53)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'audi-a3-8p-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Audi A3 (8P)',
    h1: 'Сайлентблоки важеля Audi A3 (8P)',
    metaTitle: 'Сайлентблоки Audi A3 8P від 245 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Audi A3 8P (2003-2012, хетчбек, Sportback і кабріолет) в наявності від 245 грн (LEMFORDER). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Audi A3 8P (2003-2012) — підходять на всі кузови покоління: хетчбек, Sportback і кабріолет, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'AUDI', models: ['A3 Sportback (8PA)', 'A3 (8P1)', 'A3 Cabriolet (8P7)'] },
    hideFromIndex: true,
    modelGroup: 'audi-a3-8p',
    modelLabel: 'Audi A3 (8P)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'audi-q7-4l-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Audi Q7 (4L)',
    h1: 'Сайлентблоки важеля Audi Q7 (4L)',
    metaTitle: 'Сайлентблоки Audi Q7 від 321 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Audi Q7 4L (2005-2015) в наявності від 321 грн (LEMFORDER). Доставка по всій Україні.',
    intro: 'Сайлентблоки важеля підвіски для Audi Q7 4L (2005-2015) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'AUDI', models: ['Q7 (4L)'] },
    hideFromIndex: true,
    modelGroup: 'audi-q7-4l',
    modelLabel: 'Audi Q7 (4L)',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'audi-a1-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Audi A1',
    h1: 'Сайлентблоки важеля Audi A1',
    metaTitle: 'Сайлентблоки Audi A1 від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Audi A1 (2010-2018, 3-дверний і Sportback) в наявності від 157 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Audi A1 (2010-2018) — підходять і на 3-дверний хетчбек, і на Sportback, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'AUDI', models: ['A1 (8X1, 8XF)', 'A1 Sportback (8XA, 8XK)'] },
    hideFromIndex: true,
    modelGroup: 'audi-a1',
    modelLabel: 'Audi A1',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'skoda-octavia-1-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Skoda Octavia I',
    h1: 'Сайлентблоки важеля Skoda Octavia I',
    metaTitle: 'Сайлентблоки Skoda Octavia I від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Skoda Octavia I (1996-2010, хетчбек і Combi) в наявності від 157 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Skoda Octavia I (1996-2010) — підходять і на хетчбек, і на універсал Combi, в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SKODA', models: ['OCTAVIA Combi (1U5)', 'OCTAVIA (1U2)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-octavia-1',
    modelLabel: 'Skoda Octavia I',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'skoda-octavia-2-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Skoda Octavia II',
    h1: 'Сайлентблоки важеля Skoda Octavia II',
    metaTitle: 'Сайлентблоки Skoda Octavia II від 245 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Skoda Octavia II Combi (2004-2013) в наявності від 245 грн (LEMFORDER). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Skoda Octavia II Combi (2004-2013; на деяких ринках продавалась як Skoda Laura) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SKODA', models: ['OCTAVIA Combi (1Z5)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-octavia-2',
    modelLabel: 'Skoda Octavia II',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'skoda-superb-2-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Skoda Superb II',
    h1: 'Сайлентблоки важеля Skoda Superb II',
    metaTitle: 'Сайлентблоки Skoda Superb II від 245 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Skoda Superb II (2008-2015) в наявності від 245 грн. Доставка по всій Україні, оплата при отриманні.',
    intro: 'Сайлентблоки важеля підвіски для Skoda Superb II (2008-2015) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SKODA', models: ['SUPERB (3T4)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-superb-2',
    modelLabel: 'Skoda Superb II',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'skoda-fabia-praktik-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Skoda Fabia / Praktik',
    h1: 'Сайлентблоки важеля Skoda Fabia / Praktik',
    metaTitle: 'Сайлентблоки Skoda Fabia від 157 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Skoda Fabia / Praktik (2000-2014) в наявності від 157 грн. Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Skoda Fabia та фургона Praktik на її базі (2000-2014, спільна платформа) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'SKODA', models: ['FABIA', 'PRAKTIK (5J)'] },
    hideFromIndex: true,
    modelGroup: 'skoda-fabia-praktik',
    modelLabel: 'Skoda Fabia / Praktik',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },
  {
    slug: 'ford-focus-2-cmax-sailentbloky-vazhelia',
    name: 'Сайлентблоки важеля Ford Focus II / C-MAX',
    h1: 'Сайлентблоки важеля Ford Focus II / C-MAX',
    metaTitle: 'Сайлентблоки Ford Focus II від 436 грн | DominatorParts',
    metaDescription:
      'Сайлентблоки важеля підвіски Ford Focus II / C-MAX (2004-2011) в наявності від 436 грн (LEMFORDER). Доставка по всій Україні.',
    intro:
      'Сайлентблоки важеля підвіски для Ford Focus II (хетчбек, універсал) та компактвена C-MAX на його базі (2004-2011) — в наявності декілька виробників.',
    matchGroups: [['сайлентблок']],
    tecdocVehicle: { make: 'FORD', models: ['FOCUS II (DA_)', 'FOCUS II Station Wagon (DA_)', 'FOCUS C-MAX', 'C-MAX (DM2)'] },
    hideFromIndex: true,
    modelGroup: 'ford-focus-2-cmax',
    modelLabel: 'Ford Focus II / C-MAX',
    parentCategorySlug: 'sailentbloky-vazhelia',
  },

  // ============================================================
  // ДОДАНО 2026-09: широкі категорії під "Розділи" на Головній
  // (components/CategoryGridSection.tsx, lib/departments.ts), у яких
  // categorySlugs був порожнім масивом — не тому, що товарів немає,
  // а тому, що для них просто ще не завели категорію. Перевірено
  // прямим запитом до бази: під кожним з цих розділів реально є
  // тисячі товарів (find нижче не для матчгруп, а для перевірки:
  // "SELECT COUNT(*) FROM products WHERE name ILIKE '%генератор%'..."
  // і т.п.) — раніше ці розділи вели тільки в заявку "Підбір за VIN",
  // хоча товар для прямого пошуку в каталозі вже був
  // ============================================================
  {
    slug: 'generatory-startery',
    name: 'Генератори та стартери',
    h1: 'Генератори та стартери — купити з доставкою по Україні',
    metaTitle: 'Генератори та стартери купити — оригінал і аналоги | DominatorParts',
    metaDescription:
      'Генератори та стартери для іномарок в наявності: нові, відновлені (реставровані) та б/в. Доставка по всій Україні.',
    intro:
      'Генератор і стартер — деталі, без яких авто просто не заведеться або сяде акумулятор. У наявності нові, відновлені та контрактні варіанти під різні марки — знайдіть за артикулом або маркою авто.',
    matchGroups: [['генератор', 'стартер']],
  },
  {
    slug: 'prokladky-dvyhuna',
    name: 'Прокладки та кільця двигуна',
    h1: 'Прокладки та кільця двигуна — купити з доставкою по Україні',
    metaTitle: 'Прокладки та кільця двигуна купити | DominatorParts',
    metaDescription:
      'Прокладки ГБЦ, клапанної кришки, впускного колектора, поршневі кільця та комплекти прокладок двигуна для іномарок. Доставка по всій Україні.',
    intro:
      'Прокладки та ущільнювальні кільця двигуна — від прокладки головки блока циліндрів до комплекту прокладок на весь двигун. У наявності деталі під різні марки й моделі.',
    matchGroups: [['прокладк', 'кільц', 'кольц', 'поршнев']],
    // "кільце"/"кольцо" — дуже загальне слово (ущільнювальні кільця є
    // і в вихлопній системі, і в кондиціонері) — прибираємо очевидні
    // чужі системи, знайдені прямим запитом до бази
    excludeWords: ['глушник', 'глушитель', 'кондиціонер', 'кондиционер'],
  },
  {
    slug: 'palyvna-systema',
    name: 'Паливна система',
    h1: 'Паливна система — запчастини з доставкою по Україні',
    metaTitle: 'Запчастини паливної системи купити | DominatorParts',
    metaDescription:
      'Форсунки, паливні насоси та інші деталі паливної системи для іномарок в наявності. Доставка по всій Україні.',
    intro:
      'Форсунки, паливні насоси, паливні фільтри та інші деталі паливної системи — знайдіть потрібну деталь за артикулом або маркою авто.',
    matchGroups: [['паливн', 'топливн', 'форсунк', 'бензонасос']],
    // "Форсунка склоомивача" — форсунка (сопло) омивача лобового скла,
    // а не паливна форсунка — інша деталь, що лиш збігається словом
    excludeWords: ['склоомивач', 'стеклоомыват', 'омивача скла', 'омывателя стекла'],
  },
  {
    slug: 'systema-oholodzhennya',
    name: 'Система охолодження',
    h1: 'Система охолодження — запчастини з доставкою по Україні',
    metaTitle: 'Запчастини системи охолодження купити | DominatorParts',
    metaDescription:
      'Радіатори, водяні помпи, термостати та вентилятори системи охолодження двигуна для іномарок. Доставка по всій Україні.',
    intro:
      'Радіатор охолодження, водяна помпа, термостат, вентилятор — деталі, які відповідають за температуру двигуна. У наявності під різні марки авто.',
    matchGroups: [['радіатор охолодж', 'радиатор охлажд', 'помпа', 'термостат', 'вентилятор охолодж', 'вентилятор охлажд']],
  },
  {
    slug: 'systema-vypusku',
    name: 'Система випуску',
    h1: 'Система випуску — запчастини з доставкою по Україні',
    metaTitle: 'Запчастини системи випуску купити | DominatorParts',
    metaDescription: 'Глушники, каталізатори та резонатори для іномарок в наявності. Доставка по всій Україні.',
    intro: 'Глушник, каталізатор, резонатор та інші деталі системи випуску вихлопних газів — під різні марки авто.',
    matchGroups: [['глушник', 'глушитель', 'каталізат', 'катализат', 'резонатор']],
  },
  {
    slug: 'opalennya-klimat',
    name: 'Опалення і клімат',
    h1: 'Опалення і клімат — запчастини з доставкою по Україні',
    metaTitle: 'Запчастини опалення та клімат-контролю купити | DominatorParts',
    metaDescription: 'Пічки, радіатори опалювача та моторчики обдуву салону для іномарок в наявності. Доставка по всій Україні.',
    intro: 'Пічка (радіатор опалювача), моторчик обдуву салону та інші деталі системи опалення й клімат-контролю.',
    matchGroups: [['пічк', 'печк', 'моторчик обдув', 'радіатор опаленн', 'радиатор отопител']],
  },
  {
    slug: 'transmisiya-kpp',
    name: 'Трансмісія і КПП',
    h1: 'Трансмісія і КПП — запчастини з доставкою по Україні',
    metaTitle: 'Запчастини трансмісії та КПП купити | DominatorParts',
    metaDescription: 'Комплекти зчеплення, маховики та деталі коробки передач для іномарок в наявності. Доставка по всій Україні.',
    intro: 'Зчеплення, маховик, деталі коробки передач — запчастини трансмісії під різні марки й моделі авто.',
    matchGroups: [['зчеплення', 'сцепление', 'маховик', 'коробк']],
  },
  {
    slug: 'kuzov-detali',
    name: 'Деталі кузова',
    h1: 'Деталі кузова — запчастини з доставкою по Україні',
    metaTitle: 'Деталі кузова купити | DominatorParts',
    metaDescription: 'Бампери, крила, капоти та дверна фурнітура для іномарок в наявності. Доставка по всій Україні.',
    intro: 'Бампер, крило, капот, ручки та замки дверей — кузовні деталі під різні марки авто.',
    matchGroups: [['бампер', 'крило', 'крыло', 'капот', 'двер']],
    // Курйозний, але реальний збіг: слово "крило" літера в літеру
    // входить підрядком у слово "акрилова" (наприклад, "Фарба
    // акрилова спрей...") — через це балончики фарби потрапляли в
    // деталі кузова. excludeWords тут прибирає фарбу/лаки цілком —
    // вони й так не "деталь", а витратний матеріал
    excludeWords: ['фарба', 'акрил', 'лак'],
  },
  {
    slug: 'kriplennya-kronshteiny',
    name: 'Кріплення і кронштейни',
    h1: 'Кріплення і кронштейни — з доставкою по Україні',
    metaTitle: 'Кріплення та кронштейни купити | DominatorParts',
    metaDescription: 'Кронштейни, подушки та опори двигуна й КПП для іномарок в наявності. Доставка по всій Україні.',
    intro: 'Кронштейни, подушки та опори двигуна й коробки передач — кріпильні деталі під різні марки авто.',
    matchGroups: [['кронштейн', 'подушка двигун', 'опора двигун', 'подушка кпп']],
  },
];

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

// Визначає ШИРОКУ категорію товару за його назвою (той самий принцип
// matchGroups, що й у buildCategoryWhereClause вище, але для ОДНОГО
// рядка в JS, а не для SQL-фільтра списку) — потрібно для хлібних
// крихт на сторінці товару (lib/productDetail.ts): раніше крихти йшли
// одразу "Головна / Марка / Товар" без категорії деталі взагалі,
// хоча самі сторінки категорій ("Гальмівні колодки") вже існують.
// Перевіряються лише ШИРОКІ категорії (без parentCategorySlug) — так
// крихта веде на "Гальмівні колодки", а не на вузьку сторінку під
// конкретну модель авто
export function detectCategoryForProductName(name: string | null | undefined): CategoryDef | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return CATEGORIES.find(
    (c) =>
      !c.parentCategorySlug &&
      c.matchGroups.every((group) => group.some((word) => lower.includes(word.toLowerCase()))) &&
      !(c.excludeWords ?? []).some((word) => lower.includes(word.toLowerCase()))
  );
}

// ------------------------------------------------------------
// ВУЗЬКА КАТЕГОРІЯ "ПО МАШИНІ" ДЛЯ H1/TITLE ОДНОГО ТОВАРУ
// (lib/productDetail.ts, buildSeoProductName) — ЗНАЙДЕНИЙ БАГ
// ------------------------------------------------------------
// Кілька вузьких категорій ("Комплект прокладок двигуна Daewoo
// Lanos", "...Toyota Camry" тощо) мали ОДНАКОВИЙ matchGroups
// [['прокладк']] — самого тільки слова "прокладка" в назві товару
// достатньо, щоб пройти цей фільтр, БЕЗ жодної перевірки марки/моделі
// авто. detectCategoryForProductName() бере ПЕРШУ категорію, що
// підходить за порядком у масиві — тому будь-який товар зі словом
// "прокладка" у назві (незалежно від його реальної марки) отримував
// H1 із жорстко зашитим "Daewoo Lanos" (перша така категорія у
// списку). Перевірено: AJUSA 11059300 (car_make=CITROËN) та ELRING
// 123482 (car_make=MAZDA) обидва показували "...Daewoo Lanos".
//
// Виправлення — двошарове:
//   1. Усі 12 категорій "Комплект прокладок двигуна {Модель}" тепер
//      мають parentCategorySlug: 'prokladky-dvyhuna' — це ВИКЛЮЧАЄ їх
//      із detectCategoryForProductName() (яка й так свідомо шукає
//      лише широкі категорії — !c.parentCategorySlug), як і всі інші
//      вузькі категорії "по машині" у файлі.
//   2. detectCategoryForProductH1() нижче — окрема функція САМЕ для
//      H1/title: спершу пробує вузькі категорії (з tecdocVehicle), але
//      ЛИШЕ якщо марка/модель ТОВАРУ (car_make/car_model) реально
//      збігаються з нею (narrowCategoryMatchesVehicle) — інакше
//      відкат на звичайну широку категорію через
//      detectCategoryForProductName() вище.

// Перше "слово" моделі з офіційного запису TecDoc (напр. "LANOS /
// SENS (KLAT)" -> "LANOS", "CAMRY Stufenheck (AVV5_, XV5_)" ->
// "CAMRY") — наближений ключ для зіставлення з вільним текстом
// car_model постачальника, який рідко співпадає з TecDoc дослівно
function tecdocModelKeyword(model: string): string {
  return model.split(/[\s([/]/)[0].trim().toUpperCase();
}

// Чи зустрічається keyword у text як ОКРЕМЕ слово (не частина іншого
// слова) — щоб "GOLF" не спрацював на "GOLFO" абощо. Ключі коротші за
// 3 символи свідомо ігноруємо — занадто велика ймовірність випадкового
// збігу
function containsWholeWord(text: string, keyword: string): boolean {
  if (keyword.length < 3) return false;
  const pattern = new RegExp(`(?:^|[^A-ZА-ЯЁІЇЄ0-9])${keyword}(?:[^A-ZА-ЯЁІЇЄ0-9]|$)`, 'i');
  return pattern.test(text);
}

// Марка — ТОЧНИЙ збіг (car_make у базі й tecdocVehicle.make — той
// самий "сирий" код постачальника, напр. "TOYOTA", "VW", "CITROEN").
// Модель — НАБЛИЖЕНИЙ збіг (ключове слово з TecDoc-запису як ціле
// слово десь у сирому car_model) — це не 100%-точна перевірка (TecDoc
// і постачальники називають моделі по-різному), але вона консервативна:
// у сумнівному випадку функція поверне false, і сторінка просто
// покаже безпечнішу широку категорію замість чужої моделі авто
export function narrowCategoryMatchesVehicle(
  category: CategoryDef,
  carMake: string | null | undefined,
  carModel: string | null | undefined
): boolean {
  if (!category.tecdocVehicle || !carMake || !carModel) return false;
  if (category.tecdocVehicle.make.toUpperCase() !== carMake.trim().toUpperCase()) return false;
  const upperModel = carModel.toUpperCase();
  return category.tecdocVehicle.models.some((m) => containsWholeWord(upperModel, tecdocModelKeyword(m)));
}

export function detectCategoryForProductH1(
  name: string | null | undefined,
  carMake: string | null | undefined,
  carModel: string | null | undefined
): CategoryDef | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const matchesNameFilter = (c: CategoryDef) =>
    c.matchGroups.every((group) => group.some((word) => lower.includes(word.toLowerCase()))) &&
    !(c.excludeWords ?? []).some((word) => lower.includes(word.toLowerCase()));

  const narrow = CATEGORIES.find(
    (c) => c.tecdocVehicle && matchesNameFilter(c) && narrowCategoryMatchesVehicle(c, carMake, carModel)
  );
  if (narrow) return narrow;

  return detectCategoryForProductName(name);
}

// ------------------------------------------------------------
// КРОС-ЛІНКИ МІЖ СТОРІНКАМИ (components/CategoryCrossLinks.tsx)
// ------------------------------------------------------------
// Інші вузькі сторінки під ТУ Ж САМУ машину (напр. з "Pajero II
// кульові опори" — на "Pajero II амортизатори") — блок "Інші
// запчастини для {modelLabel}". Порожній масив, якщо у категорії
// немає modelGroup (широкі категорії) або вона єдина у своїй групі
export function getRelatedByModel(category: CategoryDef): CategoryDef[] {
  if (!category.modelGroup) return [];
  return CATEGORIES.filter((c) => c.modelGroup === category.modelGroup && c.slug !== category.slug);
}

// Зворотній напрямок: усі вузькі варіанти ОДНОГО типу деталі (напр.
// для "halmivni-kolodky" — усі "...кolodky..." під конкретні машини) —
// блок "Популярні моделі" на сторінці широкої категорії
export function getNarrowVariants(parentSlug: string): CategoryDef[] {
  return CATEGORIES.filter((c) => c.parentCategorySlug === parentSlug);
}

// ------------------------------------------------------------
// ДЕДУПЛІКАЦІЯ ФІЛЬТРА МАРКА/МОДЕЛЬ/РІК/ДВИГУН (components/CategoryVehicleFilter.tsx)
// ------------------------------------------------------------
// Якщо покупець на широкій сторінці ("Кульові опори") обирає у фільтрі
// марку+модель, під яку вже ІСНУЄ готова вузька SEO-сторінка ("Кульові
// опори Mitsubishi Pajero II") — показувати ті самі товари ще раз за
// іншою адресою (/category/kulovi-opory?marka=...&model=...) означало
// б дублювати контент для Google. Замість цього сторінка категорії
// (app/category/[slug]/page.tsx) робить permanentRedirect() на готову
// вузьку сторінку. Зіставлення йде ЛИШЕ по tecdocVehicle (make + точне
// значення model з tecdoc_compatibility — те саме, що повертає
// /api/products/car-options?field=model, яким заповнюється й сам
// випадаючий список фільтра) — старі вузькі сторінки хвиль 1-4 без
// tecdocVehicle у дедуплікації участі не беруть (для них це поле
// просто не заповнене й не обов'язкове)
export function findNarrowPageForVehicle(
  parentSlug: string,
  make: string,
  model: string
): CategoryDef | undefined {
  const makeUpper = make.trim().toUpperCase();
  return CATEGORIES.find(
    (c) =>
      c.parentCategorySlug === parentSlug &&
      c.tecdocVehicle !== undefined &&
      c.tecdocVehicle.make.toUpperCase() === makeUpper &&
      c.tecdocVehicle.models.includes(model)
  );
}

// Той самий пошук, що й findNarrowPageForVehicle вище, але БЕЗ
// прив'язки до конкретної широкої категорії (parentSlug) — потрібен
// там, де заздалегідь невідомо, під яку саме широку категорію шукати
// вузьку сторінку, а відомі лише марка + модель (напр. блок
// "Запчастина підходить для авто" на сторінці товару,
// components/ProductDetailContent.tsx — товар може мати вузьку
// сторінку під зовсім іншу деталь, ніж він сам). Повертає ПЕРШУ
// знайдену вузьку сторінку цієї моделі — для переходу з бейджа
// застосовності досить будь-якої, а не обов'язково "тієї самої" деталі
export function findAnyNarrowPageForVehicle(make: string, model: string): CategoryDef | undefined {
  const makeUpper = make.trim().toUpperCase();
  return CATEGORIES.find(
    (c) =>
      c.tecdocVehicle !== undefined &&
      c.tecdocVehicle.make.toUpperCase() === makeUpper &&
      c.tecdocVehicle.models.includes(model)
  );
}

// ------------------------------------------------------------
// МОДЕЛІ МАРКИ (для блоку "Моделі {марка}" на /marky/[make])
// ------------------------------------------------------------
// Курований список моделей, для яких уже є готові вузькі SEO-сторінки
// (tecdocVehicle+modelGroup) під цю марку — по одній посадковій
// сторінці на модель (перша категорія в її modelGroup). Раніше на
// /marky/[make] не було ЖОДНОГО посилання на ці вже готові сторінки
// моделей — Google міг знайти їх лише через sitemap, а не через
// внутрішні посилання зі сторінки марки
export interface ModelLanding {
  modelGroup: string;
  modelLabel: string;
  slug: string;
}

export function getModelLandingsForMake(makeDbValues: string[]): ModelLanding[] {
  const upperValues = makeDbValues.map((v) => v.toUpperCase());
  const seen = new Map<string, ModelLanding>();

  for (const category of CATEGORIES) {
    if (!category.tecdocVehicle || !category.modelGroup || !category.modelLabel) continue;
    if (!upperValues.includes(category.tecdocVehicle.make.toUpperCase())) continue;
    if (seen.has(category.modelGroup)) continue;

    seen.set(category.modelGroup, {
      modelGroup: category.modelGroup,
      modelLabel: category.modelLabel,
      slug: category.slug,
    });
  }

  return Array.from(seen.values());
}

// ------------------------------------------------------------
// КАТЕГОРІЇ ПЛАНОВОГО ТО (для /marky/[make]/to)
// ------------------------------------------------------------
// Не всі категорії деталей стосуються РЕГЛЯРНОГО техобслуговування —
// амортизатори, сайлентблоки, кульові опори тощо міняють за станом
// (коли зносились), а не за розкладом ТО. Тут — тільки те, що
// перевіряють/міняють на кожному плановому ТО, у порядку, в якому
// зазвичай іде чек-лист на СТО: спершу рідини й фільтри, потім
// свічки та ремінь ГРМ, наприкінці — гальмівна система (її теж
// перевіряють на кожному ТО, навіть якщо міняють не завжди)
export const TO_CATEGORY_SLUGS = [
  'motorni-olyvy',
  'oliyni-filtry',
  'povitryani-filtry',
  'salonni-filtry',
  'svichky-zapaliuvannia',
  'remeni-rolyky-grm',
  'halmivni-kolodky',
  'halmivni-dysky',
] as const;

export function getToCategories(): CategoryDef[] {
  return TO_CATEGORY_SLUGS.map((slug) => getCategoryBySlug(slug)).filter(
    (c): c is CategoryDef => Boolean(c)
  );
}

// Перетворює matchGroups категорії на SQL-умову вигляду
//   (p.name ILIKE ANY($1)) AND (p.name ILIKE ANY($2)) ...
// і повертає готовий масив параметрів (%слово%) для кожної групи —
// одним рухом підставляється в pool.query(...). Розраховано на запит
// виду "FROM products p" — саме тому з префіксом p., а не голим name
// (щоб не було неоднозначності з products.name/suppliers.name, коли
// сторінка ще й приєднує JOIN suppliers за delivery_time)
//
// Якщо в категорії задано tecdocVehicle — додається ЩЕ ОДНА умова
// (через AND): товар має бути присутній у tecdoc_compatibility для
// вказаних make+models (зіставлення по бренду+артикулу). Це і є
// "підбір моделі через TecDoc" з коментаря біля поля tecdocVehicle
// вище — на відміну від matchGroups (підрядок у назві), тут модель
// авто визначається зі structured-довідника, а не з тексту назви
// товару. params після цього — вже не суто string[][], а суміш
// (string[] для ILIKE ANY, string і string[] для самого tecdocVehicle),
// тому тип params розширено до unknown[]; кожен виклик, що далі робить
// ...params у pool.query(...), як і раніше, просто розкладає їх по
// порядку в позиційні $1, $2... — сумісність зі старими викликами не
// ламається
export function buildCategoryWhereClause(
  category: CategoryDef,
  startParamIndex: number
): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  // Приховані (is_active=false) товари — тестові/сміттєві записи
  // (напр. постачальник "Тестовий постачальник") — не повинні
  // потрапляти в жоден список категорій/марок
  const conditions: string[] = ['p.is_active = true'];
  conditions.push(...category.matchGroups.map((group, i) => {
    params.push(group.map((word) => `%${word}%`));
    return `p.name ILIKE ANY($${startParamIndex + i})`;
  }));

  if (category.excludeWords && category.excludeWords.length > 0) {
    const excludeParamIdx = startParamIndex + params.length;
    params.push(category.excludeWords.map((word) => `%${word}%`));
    conditions.push(`NOT (p.name ILIKE ANY($${excludeParamIdx}))`);
  }

  if (category.tecdocVehicle) {
    const makeParamIdx = startParamIndex + params.length;
    params.push(category.tecdocVehicle.make);
    const modelsParamIdx = startParamIndex + params.length;
    params.push(category.tecdocVehicle.models);

    conditions.push(`
      EXISTS (
        SELECT 1 FROM tecdoc_compatibility tc
        WHERE UPPER(translate(tc.brand, 'ÄÖÜäöüÉÈéè', 'AOUaoueEee')) = UPPER(p.brand) AND tc.article = p.article
          AND tc.make = $${makeParamIdx} AND tc.model = ANY($${modelsParamIdx}::text[])
      )
    `);
  }

  return { clause: conditions.join(' AND '), params };
}

// ------------------------------------------------------------
// РОЗПІЗНАВАННЯ КАТЕГОРІЇ У ВІЛЬНОМУ ТЕКСТІ ПОШУКУ
// ------------------------------------------------------------
// Потрібно для запитів на кшталт "ремінь грм на мазду 626 1992 року"
// (lib/searchCarText.ts, app/api/products/route.ts) — покупець описує
// одразу і деталь, і авто, одним реченням, без точного артикула.
// matchGroups тут ідеально підходять і для цього: та сама логіка "усі
// групи мають знайтись" (лише замість перевірки p.name перевіряємо
// текст самого запиту)

// Усі слова-корені з усіх категорій одним плоским списком — потрібні,
// щоб відрізнити "назву деталі" від "назви моделі авто" у залишку
// тексту (напр. "ремінь грм 626" → прибрати "ремінь" і "грм" як
// відомі слова про деталь, лишити тільки "626")
const ALL_MATCH_TERMS: string[] = Array.from(new Set(CATEGORIES.flatMap((c) => c.matchGroups.flat())));

// Категорія підходить, якщо в тексті є ХОЧА Б ОДНЕ слово з КОЖНОЇ її
// групи matchGroups — та сама умова "І" між групами, "АБО" всередині
// групи, що й у buildCategoryWhereClause вище, тільки застосована до
// тексту запиту, а не до назви товару в базі
// Проверяет, подходит ли ОДНА конкретная категория под текст (та же
// логика "И между групп, ИЛИ внутри группы", что и в
// detectCategoryInText, только не перебирает все категории подряд, а
// проверяет заданную). Используется app/api/suppliers/parse-excel/route.ts
// для правил наценки (supplier_markup_rules.category_slug) — там нужно
// узнать именно "подходит ли товар ПОД ЭТУ категорию", а не какая
// категория подходит первой
export function productMatchesCategory(category: CategoryDef, text: string): boolean {
  const lower = text.toLowerCase();
  return category.matchGroups.every((group) => group.some((term) => lower.includes(term)));
}

export function detectCategoryInText(text: string): CategoryDef | null {
  const lower = text.toLowerCase();
  return CATEGORIES.find((category) => category.matchGroups.every((group) => group.some((term) => lower.includes(term)))) ?? null;
}

// Прибирає з тексту слова, що є "словником запчастин" (ремінь, грм,
// колодки, фільтр...), лишаючи тільки те, що НЕ про деталь — типово
// це і є назва моделі авто ("626", "camry", "gs"). Використовується
// в lib/searchCarText.ts ПІСЛЯ того, як з тексту вже прибрано марку
// авто й рік — усе, що лишається "невідомим" словом, і є моделлю
export function stripPartVocabularyWords(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => word.trim().length > 0)
    .filter((word) => !ALL_MATCH_TERMS.some((term) => word.toLowerCase().includes(term)))
    .join(' ')
    .trim();
}
