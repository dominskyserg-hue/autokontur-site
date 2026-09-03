// Єдине місце з адресою бойового сайту — використовується в усіх
// canonical-тегах, sitemap'ах, Schema.org (lib/structuredData.ts) і
// robots.txt, щоб усюди був ОДИН і той самий домен, а не localhost
// чи адреса прев'ю-деплою.
//
// Саме www, а не голий домен — перевірено прямим запитом до бойового
// хостингу: https://dominatorparts.com.ua (без www) робить 308 redirect
// на https://www.dominatorparts.com.ua, а не навпаки. Якщо тут
// поставити версію без www — усі canonical-теги, товари в sitemap і
// Product/Offer у мікророзмітці вели б на URL, який одразу редиректить
// в інший — Google це переживе, але це не best practice, і краще
// одразу вказувати кінцеву адресу
export const SITE_URL = 'https://www.dominatorparts.com.ua';
