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
 *   小字：固定 "CBM.IM"（品牌署名，与 Cover.psd 默认版式一致，不可配置）
 *   大字：主题文案（covertitle），强制单行。原样放得下就显示原文；
 *         放不下（或没填）→ 显示 "CBM.IM"，不截断、不折行
 *         大字已退化成 CBM.IM 时小字不再重复出现
 *
 * ── 模糊框（半透明卡片）────────────────────────────
 *   尺寸固定为封面生成器 cover-editor.html 的默认参数，不随档位变化：
 *     宽 554/760 = 72.9%   高 162/332 = 48.8%   圆角 20/760 = 2.63%
 *     内边距 20.75/760 = 2.73%   主副标题间距 0.030 × 容器宽
 *   只有字号随容器缩放（保证小卡片可读），框体本身是默认尺寸的比例复刻。
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

  // 档位参数：宽度阈值 + 缩放指数 + 最小字号
  // 只影响字号与是否显示小字，不再影响框体尺寸（框体固定为默认比例）
  // r = 1：字号与框体同步等比缩放，整块封面就是默认版式的等比复刻，
  //        这样 8 字主题在首页卡片（约 513px 宽）也能单行放得下；
  //        只有卡片小到字号低于可读下限时，才由 tMin / sMin 兜底放大。
  var TIERS = [
    { id: 'xs', max: 170, r: 1, tMin: 13, sMin: 0,  skew: 0,   showSub: false },
    { id: 'sm', max: 300, r: 1, tMin: 16, sMin: 11, skew: -6,  showSub: false },
    { id: 'md', max: 560, r: 1, tMin: 20, sMin: 11, skew: -9,  showSub: true },
    { id: 'lg', max: Infinity, r: 1, tMin: 34, sMin: 13, skew: -12, showSub: true }
  ];

  // 模糊框的固定比例 —— 取自 cover-editor.html 默认参数（画布 760 × 332）
  //   卡片 554 × 162 / 圆角 20 / 内边距 20.75 / 主副标题间距约 22.8
  var BOX = {
    w: 554 / 760,      // 框宽 = 容器宽 × 0.729
    h: 162 / 332,      // 框高 = 容器高 × 0.488
    r: 20 / 760,       // 圆角 = 容器宽 × 0.0263
    pad: 20.75 / 760,  // 内边距 = 容器宽 × 0.0273
    gap: 22.8 / 760    // 主副标题间距 = 容器宽 × 0.030
  };

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

  var meta = null;        // covermeta.json 原文
  var COVERS = {};        // 封面文字层数据：{ 文章路径: { t, s, d } }
  var GRADS = {};         // 渐变兜底数据：{ 文章路径: { c: [4 色], a: 角度 } }
  var DEFAULTS = [];      // 主题默认封面（= 这篇没配头图）
  var PLACEHOLDERS = [];  // 懒加载占位图 / 破图占位图（≠ 没配头图，不能当无图处理）
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
      // pangu.js（盘古之白，主题全站开）会在「CBM.IM」与中文大字之间插空格，
      // 实现方式是往大字文本节点前面塞空格 → 引发临界溢出。
      // pangu 判定 canIgnoreNode 时会检查祖先的 g_editable 属性，
      // 这里借这个无副作用的属性让整个文字卡片对 pangu 免疫。
      card.setAttribute('g_editable', 'true');

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
    // 框体尺寸固定为默认比例，随容器等比缩放，不随档位变化
    ov.style.setProperty('--co-pad', px(w * BOX.pad, 3));
    ov.style.setProperty('--co-gap', px(w * BOX.gap, 2));
    ov.style.setProperty('--co-radius', px(w * BOX.r, 3));
    ov.style.setProperty('--co-t-size', tSize.toFixed(1) + 'px');
    ov.style.setProperty('--co-s-size', sSize.toFixed(1) + 'px');
    ov.style.setProperty('--co-skew', tr.skew + 'deg');
    ov.style.setProperty('--co-h', h + 'px');

    var rawTitle = String(ov.dataset.topic || '').trim();

    /* 大字 = 主题：在不低于档位可读下限（tMin）的范围内自动缩排，
       缩到下限仍放不下（或压根没填）→ 整段换成 CBM.IM，不截断、不折行 */
    var isTopic = false;
    var fitted = rawTitle ? fitSize(tEl, rawTitle, tSize, tr.tMin) : -1;
    if (fitted > 0) {
      isTopic = true;
    } else {
      fitSize(tEl, BRAND, tSize, tr.tMin);
    }

    /* 小字 = 固定品牌名。大字已退化成 CBM.IM 时不再重复显示小字 */
    var showSub = tr.showSub && isTopic;
    if (showSub) {
      sEl.textContent = BRAND;
      sEl.style.display = '';
    } else {
      sEl.textContent = '';
      sEl.style.display = 'none';
    }
  }

  function px(v, min) {
    return Math.max(min || 0, Math.round(v * 100) / 100).toFixed(2) + 'px';
  }

  /* 写入文案并把字号压到「单行放得下」为止：
     · 优先用计算字号 from，放不下就在 [min, from] 之间二分收缩
     · 收缩下限 = 档位可读下限（tMin），低于这个字号宁可换 CBM.IM
       这样小卡片不会出现「缩到看不清也要塞进去」的半截标题
     返回最终字号；返回 -1 表示连下限都放不下 */
  function fitSize(el, text, from, min) {
    var set = function (v) { el.style.fontSize = (Math.round(v * 100) / 100) + 'px'; };
    el.textContent = text;
    set(from);
    if (el.scrollWidth <= el.clientWidth) return from;

    var lo = Math.min(min, from), hi = from, i;
    for (i = 0; i < 14 && hi - lo > 0.3; i++) {
      var mid = (lo + hi) / 2;
      set(mid);
      if (el.scrollWidth <= el.clientWidth) lo = mid; else hi = mid;
    }
    // 留 3% 安全余量：避免测量与实际渲染的亚像素误差造成临界溢出
    set(lo * 0.97);
    return el.scrollWidth <= el.clientWidth ? lo * 0.97 : -1;
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

  function hit(url, list) {
    for (var i = 0; i < list.length; i++) {
      if (url && url.indexOf(list[i]) > -1) return true;
    }
    return false;
  }

  // 命中「主题默认封面」= 这篇压根没配头图
  function isDefault(url) { return hit(url, DEFAULTS); }
  // 命中「占位图」= 懒加载还没换上真图，不能据此判定无图
  function isPlaceholder(url) { return hit(url, PLACEHOLDERS); }

  /* 没配头图 / 图片真的加载失败 → 隐藏图片，露出渐变兜底
     判定顺序很关键：
       ① 真图地址命中默认封面 → 无图，走渐变
       ② 当前 src 还是占位图    → 图片在路上，什么都不做，等 load / error
       ③ 已加载完但 naturalWidth 为 0 → 真破了，走渐变
       ④ error 事件            → 走渐变
     之前把 loading.webp（占位图）也算成默认封面，导致所有有图的卡片
     在懒加载期间被判成「无图」，整站都渲染成渐变 —— 这里必须分开。
     图后来又加载成功（pjax / 懒加载晚到）时会自动恢复显示。 */
  function guardImg(img, host, key) {
    if (img.dataset.coGuard === '1') return;
    img.dataset.coGuard = '1';

    var fail = function () {
      paintGrad(host, key);
      img.style.visibility = 'hidden';
      host.dataset.coBroken = '1';
    };
    var ok = function () {
      if (host.dataset.coBroken !== '1') return;
      host.dataset.coBroken = '0';
      img.style.visibility = '';
    };
    var check = function () {
      var url = srcOf(img);
      if (isDefault(url)) { fail(); return; }
      if (isPlaceholder(url) || !url) return;
      if (img.complete && !img.naturalWidth) fail();
      else if (img.naturalWidth) ok();
    };

    img.addEventListener('error', function () {
      // 占位图自己加载失败不代表真图失败，只有真图地址报错才算
      if (!isPlaceholder(srcOf(img))) fail();
    });
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
        PLACEHOLDERS = meta.placeholders || [];
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
