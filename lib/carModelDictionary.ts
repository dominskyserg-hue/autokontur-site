// ============================================================
// Собственный словарь моделей авто — замена применимости TecDoc, этап 1
// (пока НЕ подключён к сайту, используется только в замере
// scripts/vehicle-coverage/measure.mts).
//
// Модель ищется в названии товара (и в car_model из прайса): поставщики
// пишут "Амортизатор Toyota Camry 01-06", "Колодки CAMRY ACV30",
// "Сайлентблок Mazda 6 GG". Словарь составлен вручную по общеизвестным
// названиям моделей — это НЕ данные TecDoc.
//
// Правила, чтобы не ловить мусор:
//   - шаблон — целое слово (латиница и кириллица), не часть другого;
//   - короткие и общие названия ("3", "6", "Rio", "Partner", коды BMW
//     "E46") засчитываются только рядом с маркой (поле ctx);
//   - поколение (для хабов) — по коду кузова ("ACV30", "ZZE120", "J10")
//     или по году НАЧАЛА выпуска сразу после названия модели
//     ("Camry 06-11" -> 2006 -> XV40)
// ============================================================

export interface GenerationDef {
  // slug хаба из lib/modelHubs.ts (у нас поколения нужны только для хабов)
  hubSlug: string;
  // код кузова или явная пометка поколения в тексте
  codes: RegExp;
  // год начала выпуска детали должен попасть в [startFrom, startTo]
  startFrom: number;
  startTo: number;
}

interface ModelDef {
  make: string; // slug марки (lib/carMakes.ts; для марок без своей страницы — свой slug)
  model: string; // название для показа
  pattern: string; // регулярное выражение (без границ слова — они добавляются)
  ctx?: string; // обязательное слово марки рядом (для коротких названий)
  generations?: GenerationDef[];
}

const L = '[a-zа-яіїєґё0-9]';
const TOYOTA = 'toyota|тойот\\S*';
const MAZDA = 'mazda|мазд\\S*';
const KIA = 'kia|кіа|киа';
const BMW = 'bmw|бмв';
const PEUGEOT = 'peugeot|пежо';
const AUDI = 'audi|ауд[иі]';
const VW = 'vw|volkswagen|фольксваген';
const LEXUS = 'lexus|лексус';
const NISSAN = 'nissan|н[иі]с+ан';
const MB = 'mercedes\\S*|мерседес\\S*|mb|db';

const MODELS: ModelDef[] = [
  // ---------- Toyota ----------
  {
    make: 'toyota', model: 'Camry', pattern: 'camry|камр[иі]',
    generations: [
      { hubSlug: 'camry-xv30', codes: /(?:xv|acv|mcv)3\d/i, startFrom: 2000, startTo: 2005 },
      { hubSlug: 'camry-xv40', codes: /(?:xv|acv|gsv|ahv)4\d/i, startFrom: 2005, startTo: 2010 },
    ],
  },
  {
    make: 'toyota', model: 'Corolla', pattern: 'corolla|корол+а|altis|runx',
    generations: [
      { hubSlug: 'corolla-e120', codes: /(?:zze|nze|cde|zde|nde)12\d|(?<![a-z0-9])e12\d?(?![0-9])/i, startFrom: 2000, startTo: 2006 },
      { hubSlug: 'corolla-e150', codes: /(?:zre|zze|nre|nde|ade)15\d|(?<![a-z0-9])e15\d?(?![0-9])/i, startFrom: 2005, startTo: 2012 },
    ],
  },
  { make: 'toyota', model: 'Avensis', pattern: 'avensis|авенс[иі]с' },
  { make: 'toyota', model: 'RAV4', pattern: 'rav\\s?-?4|рав\\s?-?4' },
  { make: 'toyota', model: 'Land Cruiser Prado', pattern: 'prado|прадо' },
  { make: 'toyota', model: 'Land Cruiser', pattern: 'land\\s?cruiser|ленд\\s?крузер|lc\\s?(?:70|80|100|105|200|300)' },
  { make: 'toyota', model: 'Auris', pattern: 'auris|аур[иі]с' },
  { make: 'toyota', model: 'Yaris', pattern: 'yaris|яр[иі]с' },
  { make: 'toyota', model: 'Hilux', pattern: 'hilux|хайлюкс' },
  { make: 'toyota', model: 'Highlander', pattern: 'highlander|хайлендер' },
  { make: 'toyota', model: 'Carina', pattern: 'carina|кар[иі]на' },
  { make: 'toyota', model: 'Celica', pattern: 'celica' },
  { make: 'toyota', model: 'Previa', pattern: 'previa|прев[иі]я' },
  { make: 'toyota', model: 'Venza', pattern: 'venza' },
  { make: 'toyota', model: 'C-HR', pattern: 'c-?hr', ctx: TOYOTA },
  { make: 'lexus', model: 'RX', pattern: 'rx\\s?(?:300|330|350|400h|450h)?', ctx: LEXUS },
  { make: 'lexus', model: 'GS', pattern: 'gs\\s?(?:300|350|430|450h)?', ctx: LEXUS },
  { make: 'lexus', model: 'IS', pattern: 'is\\s?(?:200|220d|250|300)', ctx: LEXUS },
  { make: 'lexus', model: 'LX', pattern: 'lx\\s?(?:470|570)?', ctx: LEXUS },
  { make: 'lexus', model: 'ES', pattern: 'es\\s?(?:250|300|330|350)', ctx: LEXUS },
  { make: 'lexus', model: 'NX', pattern: 'nx\\s?(?:200t?|300h?)?', ctx: LEXUS },
  // ---------- Nissan ----------
  {
    make: 'nissan', model: 'Qashqai', pattern: 'qashqai|кашка[йи]|dualis',
    generations: [{ hubSlug: 'qashqai-j10', codes: /j?j10/i, startFrom: 2006, startTo: 2012 }],
  },
  {
    make: 'nissan', model: 'X-Trail', pattern: 'x-?\\s?trail|х-?\\s?трейл|ікс-?\\s?трейл|икс-?\\s?трейл',
    generations: [{ hubSlug: 'x-trail-t31', codes: /t31/i, startFrom: 2006, startTo: 2013 }],
  },
  { make: 'nissan', model: 'Almera', pattern: 'almera|альмера' },
  { make: 'nissan', model: 'Primera', pattern: 'primera|пр[иі]мера' },
  { make: 'nissan', model: 'Micra', pattern: 'micra|м[иі]кра' },
  { make: 'nissan', model: 'Note', pattern: 'note(?=\\s?e1[12])|ноут', ctx: NISSAN },
  { make: 'nissan', model: 'Tiida', pattern: 'tiida|т[иі]{1,2}да' },
  { make: 'nissan', model: 'Juke', pattern: 'juke' },
  { make: 'nissan', model: 'Teana', pattern: 'teana|теана' },
  { make: 'nissan', model: 'Pathfinder', pattern: 'pathfinder|патфайндер' },
  { make: 'nissan', model: 'Navara', pattern: 'navara|навара' },
  { make: 'nissan', model: 'Murano', pattern: 'murano|мурано' },
  { make: 'nissan', model: 'Patrol', pattern: 'patrol|патрол' },
  { make: 'nissan', model: 'Maxima', pattern: 'maxima|максима' },
  { make: 'nissan', model: 'Sunny', pattern: 'sunny' },
  { make: 'nissan', model: 'Leaf', pattern: 'leaf', ctx: NISSAN },
  { make: 'nissan', model: 'Terrano', pattern: 'terrano|террано' },
  // ---------- Mitsubishi ----------
  { make: 'mitsubishi', model: 'Pajero Sport', pattern: 'pajero\\s?sport|паджеро\\s?спорт' },
  {
    make: 'mitsubishi', model: 'Pajero', pattern: 'pajero(?!\\s?sport)|паджеро(?!\\s?спорт)|montero|shogun',
    generations: [
      { hubSlug: 'pajero-2', codes: /pajero\s?(?:ii|2)(?![0-9])|pajero\s?classic|(?<![a-z0-9])v[234]\d[a-z]?(?![0-9])/i, startFrom: 1990, startTo: 1999 },
    ],
  },
  { make: 'mitsubishi', model: 'Outlander', pattern: 'outlander|аутл[еэ]ндер' },
  { make: 'mitsubishi', model: 'Lancer', pattern: 'lancer|лансер' },
  { make: 'mitsubishi', model: 'L200', pattern: 'l\\s?200|л\\s?200' },
  { make: 'mitsubishi', model: 'ASX', pattern: 'asx' },
  { make: 'mitsubishi', model: 'Colt', pattern: 'colt|кольт' },
  { make: 'mitsubishi', model: 'Galant', pattern: 'galant|галант' },
  { make: 'mitsubishi', model: 'Carisma', pattern: 'carisma|кар[иі]зма' },
  { make: 'mitsubishi', model: 'Grandis', pattern: 'grandis' },
  { make: 'mitsubishi', model: 'Space Star', pattern: 'space\\s?star' },
  // ---------- Honda ----------
  {
    make: 'honda', model: 'Accord', pattern: 'accord|аккорд',
    generations: [{ hubSlug: 'accord-7', codes: /accord\s?(?:vii|7)(?![0-9])|(?<![a-z0-9])(?:cl[79]|cm[1-3]|cn[12])(?![0-9])/i, startFrom: 2002, startTo: 2007 }],
  },
  {
    make: 'honda', model: 'Civic', pattern: 'civic|с[иі]в[иі]к',
    generations: [{ hubSlug: 'civic-8', codes: /civic\s?(?:viii|8)(?![0-9])|(?<![a-z0-9])(?:fd[1-9]|fn[1-4]|fk[1-3])(?![0-9])/i, startFrom: 2004, startTo: 2010 }],
  },
  { make: 'honda', model: 'CR-V', pattern: 'cr-?\\s?v|срв' },
  { make: 'honda', model: 'Jazz', pattern: 'jazz|джаз' },
  { make: 'honda', model: 'HR-V', pattern: 'hr-?v' },
  { make: 'honda', model: 'Pilot', pattern: 'pilot', ctx: 'honda|хонда' },
  { make: 'honda', model: 'FR-V', pattern: 'fr-?v' },
  { make: 'honda', model: 'Stream', pattern: 'stream', ctx: 'honda|хонда' },
  // ---------- Mazda ----------
  {
    make: 'mazda', model: 'Mazda 6', pattern: '(?:mazda|мазда)\\s?6(?![0-9])|atenza|атенза',
    generations: [{ hubSlug: '6-gg', codes: /(?<![a-z0-9])(?:gg|gy)(?![a-z0-9])/i, startFrom: 2001, startTo: 2007 }],
  },
  {
    make: 'mazda', model: 'Mazda 3', pattern: '(?:mazda|мазда)\\s?3(?![0-9])|axela|аксела',
    generations: [{ hubSlug: '3-bk', codes: /(?<![a-z0-9])bk(?![a-z0-9])/i, startFrom: 2002, startTo: 2008 }],
  },
  {
    make: 'mazda', model: 'CX-5', pattern: 'cx-?\\s?5',
    generations: [{ hubSlug: 'cx-5-ke', codes: /(?<![a-z0-9])ke(?![a-z0-9])/i, startFrom: 2010, startTo: 2016 }],
  },
  { make: 'mazda', model: 'CX-7', pattern: 'cx-?\\s?7' },
  { make: 'mazda', model: 'CX-9', pattern: 'cx-?\\s?9' },
  { make: 'mazda', model: '626', pattern: '626' },
  { make: 'mazda', model: '323', pattern: '323', ctx: MAZDA },
  { make: 'mazda', model: 'Mazda 5', pattern: '(?:mazda|мазда)\\s?5(?![0-9])|premacy' },
  { make: 'mazda', model: 'Mazda 2', pattern: '(?:mazda|мазда)\\s?2(?![0-9])|demio' },
  { make: 'mazda', model: 'MPV', pattern: 'mpv', ctx: MAZDA },
  { make: 'mazda', model: 'BT-50', pattern: 'bt-?\\s?50' },
  { make: 'mazda', model: 'Tribute', pattern: 'tribute' },
  // ---------- Hyundai / Kia ----------
  { make: 'hyundai', model: 'Sonata', pattern: 'sonata|соната' },
  { make: 'hyundai', model: 'Elantra', pattern: 'elantra|[еэ]лантра' },
  { make: 'hyundai', model: 'Accent', pattern: 'accent|акцент' },
  { make: 'hyundai', model: 'Tucson', pattern: 'tucson|туксон|тусон' },
  { make: 'hyundai', model: 'Santa Fe', pattern: 'santa\\s?-?fe|санта\\s?-?фе' },
  { make: 'hyundai', model: 'i30', pattern: 'i\\s?30' },
  { make: 'hyundai', model: 'ix35', pattern: 'ix\\s?35' },
  { make: 'hyundai', model: 'Getz', pattern: 'getz|гетц' },
  { make: 'hyundai', model: 'Matrix', pattern: 'matrix', ctx: 'hyundai|хюндай|хендай' },
  // Только "H-1" с дефисом: "H1/ПОРШНЕВЫЕ КОЛЬЦА" — код группы товаров у поставщика, не модель
  { make: 'hyundai', model: 'H-1 / Starex', pattern: 'starex|старекс|h-1(?![0-9])' },
  { make: 'hyundai', model: 'Creta', pattern: 'creta|крета' },
  { make: 'kia', model: 'Sportage', pattern: 'sportage|спортейдж|спортаж' },
  { make: 'kia', model: 'Sorento', pattern: 'sorento|соренто' },
  { make: 'kia', model: 'Cerato', pattern: 'cerato|церато' },
  { make: 'kia', model: 'Rio', pattern: 'rio|р[иі]о', ctx: KIA },
  { make: 'kia', model: 'Ceed', pattern: "c['`]?eed" },
  { make: 'kia', model: 'Picanto', pattern: 'picanto|пиканто|піканто' },
  { make: 'kia', model: 'Carnival', pattern: 'carnival|карнавал' },
  { make: 'kia', model: 'Soul', pattern: 'soul', ctx: KIA },
  { make: 'kia', model: 'Optima', pattern: 'optima|оптима' },
  { make: 'kia', model: 'Magentis', pattern: 'magentis' },
  { make: 'kia', model: 'Carens', pattern: 'carens' },
  // ---------- Suzuki / Subaru ----------
  {
    make: 'suzuki', model: 'SX4', pattern: 'sx-?\\s?4(?!\\s?s-?\\s?cross)',
    generations: [{ hubSlug: 'sx4', codes: /sx-?\s?4/i, startFrom: 2006, startTo: 2013 }],
  },
  { make: 'suzuki', model: 'Grand Vitara', pattern: 'grand\\s?vitara|гранд\\s?в[иі]тара' },
  { make: 'suzuki', model: 'Vitara', pattern: '(?<!grand\\s?)vitara' },
  { make: 'suzuki', model: 'Swift', pattern: 'swift|св[иі]фт' },
  { make: 'suzuki', model: 'Jimny', pattern: 'jimny' },
  { make: 'suzuki', model: 'Liana', pattern: 'liana' },
  { make: 'subaru', model: 'Forester', pattern: 'forester|форестер' },
  { make: 'subaru', model: 'Outback', pattern: 'outback|аутбек' },
  { make: 'subaru', model: 'Impreza', pattern: 'impreza|[иі]мпреза' },
  { make: 'subaru', model: 'Legacy', pattern: 'legacy|легас[иі]' },
  // ---------- Ford ----------
  { make: 'ford', model: 'Transit Connect', pattern: 'transit\\s?connect|транз[иі]т\\s?коннект' },
  { make: 'ford', model: 'Transit', pattern: 'transit(?!\\s?connect)|транз[иі]т(?!\\s?коннект)' },
  { make: 'ford', model: 'Focus', pattern: 'focus|фокус' },
  { make: 'ford', model: 'Fiesta', pattern: 'fiesta|ф[иі]еста|фієста' },
  { make: 'ford', model: 'Mondeo', pattern: 'mondeo|мондео' },
  { make: 'ford', model: 'Fusion', pattern: 'fusion', ctx: 'ford|форд' },
  { make: 'ford', model: 'Kuga', pattern: 'kuga|куга' },
  { make: 'ford', model: 'C-Max', pattern: 'c-?\\s?max' },
  { make: 'ford', model: 'S-Max', pattern: 's-?\\s?max' },
  { make: 'ford', model: 'Galaxy', pattern: 'galaxy', ctx: 'ford|форд' },
  { make: 'ford', model: 'Escort', pattern: 'escort' },
  { make: 'ford', model: 'Sierra', pattern: 'sierra' },
  { make: 'ford', model: 'Ranger', pattern: 'ranger', ctx: 'ford|форд' },
  // ---------- Mercedes-Benz ----------
  { make: 'mercedes-benz', model: 'Sprinter', pattern: 'sprinter|спр[иі]нтер|w?90[1-6]' },
  { make: 'mercedes-benz', model: 'Vito / Viano', pattern: 'vito|viano|в[иі]то|w?63[89]' },
  { make: 'mercedes-benz', model: 'C-Class', pattern: 'w20[2-5]|c-?\\s?class' },
  { make: 'mercedes-benz', model: 'E-Class', pattern: 'w124|w21[012]|e-?\\s?class' },
  { make: 'mercedes-benz', model: 'S-Class', pattern: 'w22[01]|s-?\\s?class' },
  { make: 'mercedes-benz', model: 'ML / GLE', pattern: 'w16[346]|ml\\s?\\d{3}', ctx: MB },
  { make: 'mercedes-benz', model: 'A-Class', pattern: 'w16[89]' },
  // ---------- Daewoo / Chevrolet ----------
  { make: 'daewoo', model: 'Lanos', pattern: 'lanos|ланос' },
  { make: 'daewoo', model: 'Nexia', pattern: 'nexia|нексия|нексія' },
  { make: 'daewoo', model: 'Matiz', pattern: 'matiz|мат[иі]з' },
  { make: 'daewoo', model: 'Nubira', pattern: 'nubira' },
  { make: 'daewoo', model: 'Leganza', pattern: 'leganza' },
  { make: 'daewoo', model: 'Sens', pattern: 'sens|сенс', ctx: 'daewoo|део|деу|zaz|заз' },
  { make: 'chevrolet', model: 'Aveo', pattern: 'aveo|авео' },
  { make: 'chevrolet', model: 'Lacetti', pattern: 'lacetti|лачет+[иі]' },
  { make: 'chevrolet', model: 'Captiva', pattern: 'captiva|капт[иі]ва' },
  { make: 'chevrolet', model: 'Epica', pattern: 'epica|эп[иі]ка' },
  { make: 'chevrolet', model: 'Cruze', pattern: 'cruze|круз(?!ер)' },
  { make: 'chevrolet', model: 'Evanda', pattern: 'evanda' },
  { make: 'chevrolet', model: 'Tacuma', pattern: 'tacuma|rezzo' },
  { make: 'chevrolet', model: 'Niva', pattern: '(?:chevrolet|шевроле)\\s?n[iі]va|шевроле\\s?н[иі]ва' },
  // ---------- Renault ----------
  { make: 'renault', model: 'Logan', pattern: 'logan|логан' },
  { make: 'renault', model: 'Megane', pattern: 'megane|меган' },
  { make: 'renault', model: 'Kangoo', pattern: 'kangoo|кенго|канго' },
  { make: 'renault', model: 'Clio', pattern: 'clio|кл[иі]о' },
  { make: 'renault', model: 'Scenic', pattern: 'scenic|сценик' },
  { make: 'renault', model: 'Laguna', pattern: 'laguna|лагуна' },
  { make: 'renault', model: 'Duster', pattern: 'duster|дастер' },
  { make: 'renault', model: 'Trafic', pattern: 'trafic|траф[иі]к' },
  { make: 'renault', model: 'Master', pattern: 'master', ctx: 'renault|рено' },
  { make: 'renault', model: 'Sandero', pattern: 'sandero|сандеро' },
  { make: 'renault', model: 'Fluence', pattern: 'fluence' },
  // ---------- Volkswagen / Skoda / Audi / Seat ----------
  { make: 'volkswagen', model: 'Golf', pattern: 'golf|гольф' },
  { make: 'volkswagen', model: 'Passat', pattern: 'passat|пас+ат' },
  { make: 'volkswagen', model: 'Polo', pattern: 'polo', ctx: VW },
  { make: 'volkswagen', model: 'Jetta', pattern: 'jetta|джетта' },
  { make: 'volkswagen', model: 'Touran', pattern: 'touran|туран' },
  { make: 'volkswagen', model: 'Tiguan', pattern: 'tiguan|т[иі]гуан' },
  { make: 'volkswagen', model: 'Caddy', pattern: 'caddy|кад+[иі]' },
  { make: 'volkswagen', model: 'Transporter', pattern: 'transporter|транспортер|t[456](?![0-9])', ctx: VW },
  { make: 'volkswagen', model: 'Touareg', pattern: 'touareg|туарег' },
  { make: 'volkswagen', model: 'Sharan', pattern: 'sharan|шаран' },
  { make: 'volkswagen', model: 'Crafter', pattern: 'crafter|крафтер' },
  { make: 'volkswagen', model: 'LT', pattern: 'lt\\s?(?:28|35|46)', ctx: VW },
  { make: 'volkswagen', model: 'Bora', pattern: 'bora', ctx: VW },
  { make: 'skoda', model: 'Octavia', pattern: 'octavia|октав[иі]я' },
  { make: 'skoda', model: 'Fabia', pattern: 'fabia|фаб[иі]я' },
  { make: 'skoda', model: 'Superb', pattern: 'superb|суперб' },
  { make: 'skoda', model: 'Rapid', pattern: 'rapid', ctx: 'skoda|шкод\\S*' },
  { make: 'skoda', model: 'Yeti', pattern: 'yeti' },
  { make: 'skoda', model: 'Roomster', pattern: 'roomster' },
  { make: 'audi', model: 'A3', pattern: 'a3', ctx: AUDI },
  { make: 'audi', model: 'A4', pattern: 'a4', ctx: AUDI },
  { make: 'audi', model: 'A6', pattern: 'a6', ctx: AUDI },
  { make: 'audi', model: 'A8', pattern: 'a8', ctx: AUDI },
  { make: 'audi', model: 'Q5', pattern: 'q5', ctx: AUDI },
  { make: 'audi', model: 'Q7', pattern: 'q7', ctx: AUDI },
  { make: 'audi', model: '80 / 100', pattern: '(?:80|100)', ctx: AUDI },
  // ---------- Opel ----------
  { make: 'opel', model: 'Astra', pattern: 'astra|астра' },
  { make: 'opel', model: 'Vectra', pattern: 'vectra|вектра' },
  { make: 'opel', model: 'Omega', pattern: 'omega', ctx: 'opel|опель' },
  { make: 'opel', model: 'Corsa', pattern: 'corsa|корса' },
  { make: 'opel', model: 'Zafira', pattern: 'zafira|зафира|зафіра' },
  { make: 'opel', model: 'Meriva', pattern: 'meriva' },
  { make: 'opel', model: 'Insignia', pattern: 'insignia' },
  { make: 'opel', model: 'Vivaro', pattern: 'vivaro|в[иі]варо' },
  { make: 'opel', model: 'Movano', pattern: 'movano' },
  { make: 'opel', model: 'Combo', pattern: 'combo', ctx: 'opel|опель' },
  { make: 'opel', model: 'Kadett', pattern: 'kadett' },
  // ---------- BMW ----------
  { make: 'bmw', model: '3 Series', pattern: 'e3[06]|e46|e9[0-3]|f3[01]', ctx: BMW },
  { make: 'bmw', model: '5 Series', pattern: 'e3[49]|e6[01]|f1[01]', ctx: BMW },
  { make: 'bmw', model: '7 Series', pattern: 'e38|e6[5-8]|f0[12]', ctx: BMW },
  { make: 'bmw', model: 'X5', pattern: 'x5|e53|e70|f15', ctx: BMW },
  { make: 'bmw', model: 'X3', pattern: 'x3|e83|f25', ctx: BMW },
  { make: 'bmw', model: 'X1', pattern: 'x1|e84', ctx: BMW },
  { make: 'bmw', model: '1 Series', pattern: 'e8[1278]', ctx: BMW },
  // ---------- Peugeot / Citroen / Fiat ----------
  { make: 'peugeot', model: 'Partner', pattern: 'partner|партнер', ctx: PEUGEOT },
  { make: 'peugeot', model: 'Boxer', pattern: 'boxer|боксер' },
  { make: 'peugeot', model: 'Expert', pattern: 'expert', ctx: PEUGEOT },
  { make: 'peugeot', model: '206 / 207', pattern: '20[67]', ctx: PEUGEOT },
  { make: 'peugeot', model: '307 / 308', pattern: '30[78]', ctx: PEUGEOT },
  { make: 'peugeot', model: '406 / 407', pattern: '40[67]', ctx: PEUGEOT },
  { make: 'citroen', model: 'Berlingo', pattern: 'berlingo|берл[иі]нго' },
  { make: 'citroen', model: 'Jumper', pattern: 'jumper|джампер' },
  { make: 'citroen', model: 'Jumpy', pattern: 'jumpy|джампи' },
  { make: 'citroen', model: 'C4', pattern: 'c4', ctx: 'citro\\S*|с[іи]троен' },
  { make: 'citroen', model: 'C5', pattern: 'c5', ctx: 'citro\\S*|с[іи]троен' },
  { make: 'citroen', model: 'Xsara', pattern: 'xsara' },
  { make: 'fiat', model: 'Doblo', pattern: 'doblo|добло' },
  { make: 'fiat', model: 'Ducato', pattern: 'ducato|дукато' },
  { make: 'fiat', model: 'Scudo', pattern: 'scudo' },
  { make: 'fiat', model: 'Punto', pattern: 'punto|пунто' },
  { make: 'fiat', model: 'Stilo', pattern: 'stilo' },
  { make: 'fiat', model: 'Linea', pattern: 'linea', ctx: 'fiat|ф[иі]ат' },
  { make: 'fiat', model: 'Fiorino', pattern: 'fiorino' },
  // ---------- Прочие ----------
  { make: 'land-rover', model: 'Freelander', pattern: 'freelander|фрилендер' },
  { make: 'land-rover', model: 'Discovery', pattern: 'discovery', ctx: 'land\\s?rover|ленд\\s?ровер|lr' },
  { make: 'land-rover', model: 'Range Rover', pattern: 'range\\s?rover|рендж\\s?ровер' },
  { make: 'jeep', model: 'Grand Cherokee', pattern: 'grand\\s?cherokee' },
  { make: 'jeep', model: 'Cherokee', pattern: '(?<!grand\\s?)cherokee' },
  { make: 'jeep', model: 'Wrangler', pattern: 'wrangler' },
  { make: 'jeep', model: 'Compass', pattern: 'compass', ctx: 'jeep|джип' },
  { make: 'dodge', model: 'Caliber', pattern: 'caliber' },
  { make: 'dodge', model: 'Journey', pattern: 'journey', ctx: 'dodge|додж' },
  { make: 'ssangyong', model: 'Kyron', pattern: 'kyron|кайрон' },
  { make: 'ssangyong', model: 'Rexton', pattern: 'rexton|рекстон' },
  { make: 'ssangyong', model: 'Actyon', pattern: 'actyon|актион' },
  { make: 'ssangyong', model: 'Korando', pattern: 'korando|корандо' },
  { make: 'isuzu', model: 'D-Max', pattern: 'd-?\\s?max' },
  { make: 'isuzu', model: 'Trooper', pattern: 'trooper' },
  { make: 'daihatsu', model: 'Terios', pattern: 'terios' },
  { make: 'daihatsu', model: 'Sirion', pattern: 'sirion' },
];

interface CompiledModel extends ModelDef {
  re: RegExp;
  ctxRe: RegExp | null;
}

const COMPILED: CompiledModel[] = MODELS.map((m) => ({
  ...m,
  re: new RegExp(`(?<!${L})(?:${m.pattern})(?!${L})`, 'giu'),
  ctxRe: m.ctx ? new RegExp(`(?<!${L})(?:${m.ctx})(?!${L})`, 'iu') : null,
}));

// Быстрый предварительный фильтр: одно общее выражение из всех шаблонов.
// Большинство названий (~80%) модели не содержит — для них разбор по
// каждой модели не нужен (полный пересчёт каталога в 5+ раз быстрее)
const ANY_MODEL = new RegExp(`(?<!${L})(?:${MODELS.map((m) => m.pattern).join('|')})(?!${L})`, 'iu');

export interface DetectedModel {
  make: string;
  model: string;
  // slug хаба, если поколение удалось определить (для моделей из хабов)
  hubSlug: string | null;
  // модель из хаба найдена, но поколение не определено
  generationUnknown: boolean;
}

// Год начала выпуска сразу после названия модели: "06-11", "2006-2011",
// "08.01-", "(03-09)", "Civic 4D 06-11". Перед годом не допускаются цифра,
// точка, запятая и буква — чтобы не принять объём "1.6-2.0" или код за годы
const YEAR_AFTER = /^.{0,25}?(?<![\d.,a-zа-яіїє])(\d{2}|\d{4})(?:\.\d{2})?\s*[-–—]/iu;

function toYear(token: string): number {
  const n = parseInt(token, 10);
  if (token.length === 4) return n;
  return n >= 50 ? 1900 + n : 2000 + n;
}

function startYearNear(text: string, matchEnd: number): number | null {
  const after = text.slice(matchEnd, matchEnd + 40);
  const m = after.match(YEAR_AFTER);
  if (m) {
    const y = toYear(m[1]);
    if (y >= 1970 && y <= 2030) return y;
  }
  return null;
}

// Все модели, упомянутые в тексте (в названии товара бывает несколько:
// "Nissan Almera/Primera")
export function detectCarModels(rawText: string | null | undefined): DetectedModel[] {
  const text = (rawText ?? '').replace(/\s+/g, ' ');
  if (!text.trim()) return [];
  if (!ANY_MODEL.test(text)) return [];
  const found = new Map<string, DetectedModel>();

  for (const m of COMPILED) {
    if (m.ctxRe && !m.ctxRe.test(text)) continue;
    m.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = m.re.exec(text))) {
      let hubSlug: string | null = null;
      let generationUnknown = false;
      if (m.generations) {
        const start = startYearNear(text, match.index + match[0].length);
        const byCode = m.generations.find((g) => g.codes.test(text));
        const byYear = start !== null ? m.generations.find((g) => start >= g.startFrom && start <= g.startTo) : undefined;
        // Код кузова точнее года; год — только если кода нет
        const generation = byCode ?? byYear;
        // Модель без кода с годом вне всех поколений хабов — другое поколение
        if (generation) hubSlug = generation.hubSlug;
        else generationUnknown = start === null;
      }
      const key = `${m.make}|${m.model}|${hubSlug ?? ''}`;
      if (!found.has(key)) found.set(key, { make: m.make, model: m.model, hubSlug, generationUnknown });
      if (m.re.lastIndex === match.index) m.re.lastIndex++;
    }
  }
  return [...found.values()];
}

