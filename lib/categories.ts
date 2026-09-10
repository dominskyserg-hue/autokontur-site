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
];

export function getCategoryBySlug(slug: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
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
  const conditions = category.matchGroups.map((group, i) => {
    params.push(group.map((word) => `%${word}%`));
    return `p.name ILIKE ANY($${startParamIndex + i})`;
  });

  if (category.tecdocVehicle) {
    const makeParamIdx = startParamIndex + params.length;
    params.push(category.tecdocVehicle.make);
    const modelsParamIdx = startParamIndex + params.length;
    params.push(category.tecdocVehicle.models);

    conditions.push(`
      EXISTS (
        SELECT 1 FROM tecdoc_compatibility tc
        WHERE UPPER(tc.brand) = UPPER(p.brand) AND tc.article = p.article
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
