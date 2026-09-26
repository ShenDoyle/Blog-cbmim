/**
 * cover-overlay.js — 封面「蒙版 + 文字」层
 *
 * 依赖：/covermeta.json（由 scripts/covermeta.js 生成）
 *
 * ── 核心规则 ──────────────────────────────────────
 *   covertitle / coverset / coverdim 三处全空 → 完全不介入，原封面图原样显示
 *   三处任意一处有值 → 叠蒙版（未填强度时默认 0.46），有文字则渲染文字层
 *
 *   文章顶图（#page-header.post-bg）不叠加任何东西，只保留背景原图。
 *
 * ── 文字取值 ──────────────────────────────────────
 *   副标题：未填时默认 "CBM.IM"（位置 / 字体 / 样式与源文件一致，不做调整）
 *   主标题：强制单行。原样放得下就显示原文；
 *           放不下（或没填）→ 显示 "CBM.IM"，不截断、不折行
 *           这样在置顶小卡、最近发布一类小尺寸位置不会出现半截标题
 *
 * 为什么不用像素图里的字：封面在首页卡片 / 置顶小卡 / 侧栏 / 归档等位置
 * 被不同尺寸裁切，烘焙进像素的文字无法随容器缩放，小尺寸下必然糊掉或被切掉。
 * 改为 DOM 渲染后，字号、卡片尺寸、能否放下都能跟随容器实时计算。
 */

(function () {
  'use strict';

  // 子路径部署时改为 '/blog/covermeta.json'
  var META_URL = '/covermeta.json';

  // 默认蒙版强度，与 Cover.psd 中 dim 图层一致（#000 / 46%）
  var DEFAULT_DIM = 0.46;

  // 品牌兜底文案：副标题默认值，也是主标题放不下 / 未填时的替代文案
  var BRAND = 'CBM.IM';

  // 基准画布（Cover.psd 原始尺寸），所有比例以此为参照
  var BASE_W = 760;
  var BASE_H = 332;

  // 档位参数：宽度阈值 + 缩放指数 + 最小字号 + 字数上限
  // tLen 已不再用于主标题（改由「单行是否放得下」实测决定），保留供文档参考
  // sLen 仍用于副标题截断
  var TIERS = [
    { id: 'xs', max: 170, r: 0.72, tMin: 13, sMin: 0,  tLen: 6,  sLen: 0,  skew: 0,  cardW: 92, gap: 0.10, showSub: false },
    { id: 'sm', max: 300, r: 0.72, tMin: 16, sMin: 11, tLen: 10, sLen: 0,  skew: -6, cardW: 86, gap: 0.12, showSub: false },
    { id: 'md', max: 560, r: 0.72, tMin: 20, sMin: 11, tLen: 14, sLen: 24, skew: -9, cardW: 80, gap: 0.16, showSub: true },
    { id: 'lg', max: Infinity, r: 0.72, tMin: 34, sMin: 13, tLen: 0, sLen: 0, skew: -12, cardW: 73, gap: 0.18, showSub: true }
  ];

  // 覆盖电池/暗色管的文字保护：蒙版太浅时自动加深，保证可读
  var DIM_FLOOR = 0.32;

  // 锚点：以 img 为单位，overlay 挂到其父元素
  var TARGETS = [
    '.post_cover img.post_bg',
    '.article-sort-item-img img',
    '.aside-list-item img',
    '.top-group-item img.post_bg',
    '.blog-slider__img img'
  ];
  // 文章页头图：按需求不叠加蒙版与文字，只保留背景原图，故不纳入渲染

  /* ── 渐变兜底 ────────────────────────────────────
     参数取自封面生成器 cover-editor.html（Cover.psd 原始参数）：
     四个色块 + 渐变角度。区别在于这里的随机数由文章路径哈希生成，
     保证「同一篇文章每次都一样、不同文章互不相同」。
     用途：① 文章没配头图 ② 图片加载失败（CDN 挂、文件名改了）── */

  var meta = null;   // covermeta.json 原文
  var COVERS = {};   // 封面文字层数据：{ 文章路径: { t, s, d } }
  var GRADS = {};    // 渐变兜底数据：{ 文章路径: { c: [4 色], a: 角度 } }
  var DEFAULTS = []; // 主题默认封面 / 破图占位图地址
  var ro = null;
  var timer = null;

  function norm(p) {
    return String(p || '')
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\/index\.html?$/i, '')
      .replace(/\.html?$/i, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  }

  function tierOf(w) {
    for (var i = 0; i < TIERS.length; i++) {
      if (w < TIERS[i].max) return TIERS[i];
    }
    return TIERS[TIERS.length - 1];
  }

  // 非线性缩放：w=760 → base；w=380 → 0.607×base；w=150 → 0.311×base
  function scale(w, base, r) {
    return base * Math.pow(w / BASE_W, r);
  }

  function clip(s, n) {
    if (!n || !s) return s || '';
    var chars = Array.from(s);
    if (chars.length <= n) return s;
    return chars.slice(0, n).join('') + '…';
  }

  function findLink(el) {
    var p = el;
    for (var i = 0; i < 5 && p; i++) {
      if (p.tagName === 'A' && p.getAttribute('href')) return p;
      var a = p.querySelector && p.querySelector('a[href]');
      if (a) return a;
      p = p.parentElement;
    }
    return null;
  }

  function ensureHost(host, dim) {
    if (host.dataset.coHost === '1') return;
    host.dataset.coHost = '1';

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (getComputedStyle(host).overflow !== 'hidden') host.style.overflow = 'hidden';

    // 蒙版：铺满整个封面并压暗，让原图（含其中已烘焙的文字）退到背景层
    if (typeof dim !== 'number') dim = DEFAULT_DIM;
    if (dim > 0 && dim < DIM_FLOOR) dim = DIM_FLOOR;

    var mask = document.createElement('span');
    mask.className = 'co-dim';
    mask.style.setProperty('--co-dim', String(dim));
    host.insertBefore(mask, host.firstChild);
  }

  function buildOverlay(host, item) {
    var ov = host.querySelector('.co-wrap');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'co-wrap';

      var card = document.createElement('div');
      card.className = 'co-card';

      var s = document.createElement('span');
      s.className = 'co-sub';
      var t = document.createElement('span');
      t.className = 'co-title';

      card.appendChild(s);
      card.appendChild(t);
      ov.appendChild(card);
      host.appendChild(ov);
    }
    ov.dataset.topic = item.t || '';
    ov.dataset.sub = item.s || '';
    return ov;
  }

  function render(ov) {
    var host = ov.parentElement;
    var w = host.clientWidth || host.offsetWidth || 0;
    if (!w) return;
    var h = host.clientHeight || host.offsetHeight || Math.round(w * BASE_H / BASE_W);
    var tr = tierOf(w);
    if (ov.dataset.tier !== tr.id) ov.dataset.tier = tr.id;

    var tSize = Math.max(scale(w, 58, tr.r), tr.tMin);
    var sSize = Math.max(scale(w, 20, tr.r), tr.sMin);

    var tEl = ov.querySelector('.co-title');
    var sEl = ov.querySelector('.co-sub');

    // 先写尺寸变量，再测文字是否放得下（字号影响测量结果）
    ov.style.setProperty('--co-card-w', tr.cardW + '%');
    ov.style.setProperty('--co-gap', tr.gap + 'em');
    ov.style.setProperty('--co-t-size', tSize.toFixed(1) + 'px');
    ov.style.setProperty('--co-s-size', sSize.toFixed(1) + 'px');
    ov.style.setProperty('--co-skew', tr.skew + 'deg');
    ov.style.setProperty('--co-h', h + 'px');

    var rawTitle = ov.dataset.topic || '';
    var rawSub = ov.dataset.sub || '';

    // 只填了蒙版强度、没有标题也没有副标题 → 隐藏卡片，只保留蒙版
    var card = ov.querySelector('.co-card');
    if (!rawTitle && !rawSub) {
      if (card) card.style.display = 'none';
      tEl.textContent = '';
      sEl.textContent = '';
      return;
    }
    if (card) card.style.display = '';

    /* 主标题：单行优先，放不下就整段换成品牌名（不截断、不折行） */
    var usedBrand = false;
    var fits = rawTitle ? put(tEl, rawTitle) : false;
    if (!fits) {
      usedBrand = put(tEl, BRAND);
      if (!usedBrand) tEl.textContent = '';
    }

    /* 副标题：未填则默认品牌名（位置、字体、样式与源文件一致） */
    var subText = rawSub || BRAND;
    // 主标题已退化成品牌名时，若副标题也是默认的品牌名就别重复显示
    var showSub = tr.showSub && (rawSub ? true : !usedBrand);
    if (showSub) {
      sEl.textContent = clip(subText, tr.sLen);
      sEl.style.display = '';
    } else {
      sEl.textContent = '';
      sEl.style.display = 'none';
    }
  }

  // 写入文案并判断单行能否放下（nowrap + width:100% 下 scrollWidth 即真实文本宽度）
  function put(el, text) {
    el.textContent = text;
    return el.scrollWidth <= el.clientWidth + 1;
  }

  // 渐变兜底层：铺在封面最底层（z-index 0），图片正常时看不见，
  // 图片缺失 / 加载失败时自然露出来
  function paintGrad(host, key) {
    var g = GRADS[key];
    if (!g || host.dataset.coGrad === '1') return;
    host.dataset.coGrad = '1';
    var el = document.createElement('span');
    el.className = 'co-grad';
    el.style.backgroundImage =
      'linear-gradient(' + g.a + 'deg,' + g.c.join(',') + ')';
    host.insertBefore(el, host.firstChild);
  }

  // 真实图片地址：懒加载时 src 是 1×1 占位图，真图在 data-lazy-src
  function srcOf(img) {
    return img.getAttribute('data-lazy-src') || img.getAttribute('src') || '';
  }

  // 命中「主题默认封面 / 破图占位图」= 这篇没配头图，或图挂了
  function isDefault(url) {
    for (var i = 0; i < DEFAULTS.length; i++) {
      if (url && url.indexOf(DEFAULTS[i]) > -1) return true;
    }
    return false;
  }

  // 没配头图 / 图片加载失败 → 隐藏图片，露出渐变兜底
  function guardImg(img, host, key) {
    if (img.dataset.coGuard === '1') return;
    img.dataset.coGuard = '1';

    var fail = function () {
      paintGrad(host, key);
      img.style.visibility = 'hidden';
      host.dataset.coBroken = '1';
    };
    var check = function () {
      if (isDefault(srcOf(img))) { fail(); return; }
      if (img.complete && !img.naturalWidth) fail();
    };

    // 无论当前是否已加载都挂监听：懒加载、pjax 换页都可能晚于本脚本
    img.addEventListener('error', fail);
    img.addEventListener('load', check);
    check();
  }

  function attach(host, item, key) {
    if (key) paintGrad(host, key);
    if (host.dataset.coDone === '1') return;
    host.dataset.coDone = '1';
    ensureHost(host, item.d);
    var ov = buildOverlay(host, item);
    render(ov);
    if (ro) ro.observe(host);
  }

  /* 没有头图的文章：主题不会渲染封面位，这里补一个渐变封面块 */
  function injectNoCover() {
    var cards = document.querySelectorAll(
      '.recent-post-item, .article-sort-item, .top-group-item, .aside-list-item'
    );
    Array.prototype.forEach.call(cards, function (card) {
      if (card.dataset.coNo === '1') return;
      if (card.querySelector('img.post_bg, img.entered, img')) return;

      var key = '';
      var links = card.querySelectorAll('a[href]');
      for (var i = 0; i < links.length && !key; i++) {
        var k = norm(links[i].getAttribute('href'));
        if (GRADS[k]) key = k;
      }
      if (!key) return;
      card.dataset.coNo = '1';

      var box = document.createElement('div');
      box.className = 'post_cover co-nocover';
      var a = document.createElement('a');
      a.setAttribute('href', '/' + key + '/');
      a.setAttribute('aria-hidden', 'true');
      a.style.cssText = 'display:flex;height:100%;width:100%';
      box.appendChild(a);
      card.insertBefore(box, card.firstChild);
      paintGrad(a, key);
    });
  }

  function process() {
    // 列表 / 置顶 / 侧栏中的封面 img：用链接 href 匹配
    // 文章页头图不参与（按需求只保留背景原图）
    var imgs = document.querySelectorAll(TARGETS.join(','));
    Array.prototype.forEach.call(imgs, function (img) {
      var host = img.parentElement;
      if (!host) return;

      var a = findLink(img);
      var key = a ? norm(a.getAttribute('href')) : '';
      if (!key) return;

      // 渐变兜底层给所有封面都铺上（图片正常时看不见，破了才露出来）
      paintGrad(host, key);
      guardImg(img, host, key);

      var it = COVERS[key];
      if (!it) return;                          // 三处全空 → 不叠文字层

      attach(host, it, key);
    });

    injectNoCover();
  }

  function boot() {
    if (!meta) return;
    if (typeof ResizeObserver !== 'undefined' && !ro) {
      ro = new ResizeObserver(function (entries) {
        Array.prototype.forEach.call(entries, function (e) {
          var ov = e.target.querySelector('.co-wrap');
          if (ov) render(ov);
        });
      });
    }
    process();
  }

  function load() {
    if (meta) { boot(); return; }
    fetch(META_URL, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) {
        meta = j || {};
        // 兼容旧格式（纯 covers 映射）；新格式为 { covers, grads }
        COVERS = meta.covers || meta || {};
        GRADS = meta.grads || {};
        DEFAULTS = meta.defaults || [];
        boot();
      })
      .catch(function () { meta = {}; });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(load, 60);
  }

  document.addEventListener('DOMContentLoaded', schedule);
  document.addEventListener('pjax:complete', schedule);
  document.addEventListener('pjax:success', schedule);
  window.addEventListener('load', schedule);

  // 图片 / 字体加载完成后容器尺寸可能变化，补一次重算
  window.addEventListener('resize', function () {
    if (!meta) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.co-wrap'), function (ov) {
        render(ov);
      });
    }, 120);
  });
})();
