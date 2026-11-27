"use strict";

const SWIPER_CDN_CSS = "https://npm.elemecdn.com/anzhiyu-theme-static@1.0.0/swiper/swiper.min.css";
const SWIPER_CDN_JS = "https://npm.elemecdn.com/anzhiyu-theme-static@1.0.0/swiper/swiper.min.js";
const SWIPER_LOCAL_CSS = "/pluginsSrc/swiper/swiper.min.css";
const SWIPER_LOCAL_JS = "/pluginsSrc/swiper/swiper-bundle.min.js";

function localizeSwiper(html) {
  if (typeof html !== "string" || !html.includes("swiper.min.")) return html;

  return html
    .replaceAll(SWIPER_CDN_CSS, SWIPER_LOCAL_CSS)
    .replaceAll(SWIPER_CDN_JS, SWIPER_LOCAL_JS)
    .replace(
      /<link rel="stylesheet" href="\/pluginsSrc\/swiper\/swiper\.min\.css" media="print" onload="this\.media='all'">/g,
      '<link rel="stylesheet" href="/pluginsSrc/swiper/swiper.min.css">'
    );
}

hexo.extend.filter.register("after_render:html", localizeSwiper, 20);
