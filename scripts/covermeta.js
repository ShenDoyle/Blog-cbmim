/**
 * covermeta.js — Hexo 生成器
 *
 * 作用：扫描 source/_posts/*.md 的 front-matter，把封面元信息抽取出来，
 *       生成一份 covermeta.json，供前端 cover-overlay.js 叠加「蒙版 + 文字」。
 *
 * ── 核心规则（唯一判定条件）────────────────────────
 *   covertitle / coverset / coverdim 三处全空 → 完全不介入，原封面图原样显示
 *   三处任意一处有值 → 启用主题的封面效果（蒙版 + 文字层）渲染
 * ────────────────────────────────────────────────
 *
 * ── 渲染位置 ─────────────────────────────────────
 *   首页 / 归档 / 置顶 / 侧栏的封面图 → 蒙版 + 文字层
 *   文章顶图（#page-header.post-bg）→ 不叠加任何东西，只保留背景原图
 * ────────────────────────────────────────────────
 *
 * ── 文字层取值 ─────────────────────────────────────
 *   大字 = 主题：covertitle，强制单行，放得下显示原文，
 *                放不下（或没填）→ 显示 CBM.IM
 *   小字 = 固定 CBM.IM：与 Cover.psd 默认版式一致，不再受 coverset 影响
 *
 * front-matter 字段：
 *   covertitle: 封面主标题（可选），建议 ≤8 字
 *               强制单行：放得下就显示原文，放不下（含没填）→ 显示 CBM.IM
 *               不再截断、不折行，避免小卡片上出现半截标题
 *   coverset:   【已弃用】封面副标题。小字固定渲染 CBM.IM，此字段不再影响
 *               显示效果，仅保留读取以兼容旧数据（仍可作为「启用效果」的触发项）
 *   coverdim:   蒙版强度（可选），默认 0.46
 *                填 0 / false 表示不加蒙版；支持 0~1 小数或 0~100 的百分数
 *
 * ── 渐变兜底 ─────────────────────────────────────
 *   每篇文章都按「路径哈希」生成一组渐变参数（四色 + 角度），
 *   同一篇永远一致、不同篇互不相同，用于：
 *     ① 文章没配头图  ② 图片加载失败（CDN 挂了 / 文件名改了）
 * ────────────────────────────────────────────────
 *
 * ── 封面图最佳分辨率（Notion「封面」字段注释同源）──────
 *   推荐 1600 x 700（16:7），webp 格式，单张 ≤ 300KB
 *   依据：文字层设计画布 760 x 332（比例 2.29:1）的 2 倍；
 *         首页大卡片 2x retina 约 1660 x 400，文章头图区高 500px
 *   构图建议：主体内容放在画面中央约 40% 高的横向安全带内，
 *             首页卡片会裁成约 4.1:1，置顶小卡约 2.8:1，均以中心裁切
 */

'use strict';

var DEFAULT_DIM = 0.46;

// 路径归一化：统一成不带首尾斜杠、不带 index.html 的相对路径
function norm(p) {
  return String(p || '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\/index\.html?$/i, '')
    .replace(/\.html?$/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// 去掉 front-matter 里可能的引号包裹
function unquote(v) {
  var s = str(v);
  if (s.length > 1 && ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

// 解析蒙版强度 → 0~1 的小数
function dimOf(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_DIM;
  if (v === false || v === 'false') return 0;
  if (v === true || v === 'true') return DEFAULT_DIM;

  var s = unquote(v);
  var n = parseFloat(s);
  if (isNaN(n)) return DEFAULT_DIM;

  // 支持 "46%" 写法
  if (s.indexOf('%') > -1) n = n / 100;

  if (n < 0) return 0;
  if (n > 1) return 1;
  return Math.round(n * 1000) / 1000;
}

/* ── 渐变兜底参数（无头图 / 图片加载失败时使用）──────
   算法取自封面生成器 cover-editor.html 的「随机渐变」：
   一个基准色相 + 同向递进的 3 个色相 + 亮度阶梯 + 随机角度。
   区别在于随机数由「文章路径哈希」生成 ——
   同一篇文章每次构建都得到同一组参数，不同文章互不相同。
*/
function seedOf(str) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15; h = Math.imul(h, 2246822507);
  h ^= h >>> 13; h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

function rngOf(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  var k = function (n) { return (n + h / 30) % 12; };
  var a = s * Math.min(l, 1 - l);
  var f = function (n) {
    return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  };
  var to = function (v) {
    var x = Math.round(255 * v).toString(16);
    return x.length < 2 ? '0' + x : x;
  };
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

function gradOf(key) {
  var r = rngOf(seedOf(key));
  var base = r() * 360;
  var dir = r() < 0.5 ? 1 : -1;
  var sat = 66 + r() * 24;          // 66~90
  var l1 = 30 + r() * 12;           // 30~42
  var step = 18 + r() * 16;         // 18~34
  return {
    c: [
      hsl2hex(base, sat, l1),
      hsl2hex((base + dir * step + 360) % 360, sat, l1 + 8),
      hsl2hex((base + dir * step * 2 + 720) % 360, sat, l1 + 14),
      hsl2hex((base + dir * step * 3 + 1080) % 360, sat, l1 + 20)
    ],
    a: Math.floor(r() * 360)
  };
}

/* ── 两类「非正文封面图」必须分开判断 ──────────────────
   defaults（主题默认封面）  = 这篇压根没配头图 → 用渐变兜底
   placeholders（懒加载占位 / 破图占位）= 图片还在加载，或加载失败
        ⚠️ 占位图绝不能算进 defaults：懒加载时 src 就是这张占位图，
           把它当成「没配头图」会让所有有图的卡片都被判成无图，
           于是整站都渲染成渐变 —— 这是上一版的事故根因。
   ──────────────────────────────────────────────── */
function defaultImgs() {
  var cfg = (hexo.theme && hexo.theme.config) || {};

  // ① 没配头图时主题套的默认封面
  var def = [];
  var dc = cfg.cover && cfg.cover.default_cover;
  if (dc) def = def.concat(Array.isArray(dc) ? dc : [dc]);

  // ② 懒加载占位图 / error_img（图片加载失败后主题会换成这个）
  var ph = [];
  var ei = cfg.error_img;
  if (typeof ei === 'string') ph.push(ei);
  else if (ei) ['post_page', 'flink'].forEach(function (k) {
    if (ei[k]) ph.push(ei[k]);
  });
  // 常见 1×1 透明占位（部分浏览器 / 懒加载库用）
  ph.push('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

  var s = function (a) { return a.filter(Boolean).map(str); };
  return { defaults: s(def), placeholders: s(ph) };
}

hexo.extend.generator.register('covermeta', function (locals) {
  var map = {};    // 封面文字层
  var grads = {};  // 渐变兜底（全部文章）
  var dup = [];
  var count = 0;

  locals.posts.forEach(function (post) {
    var key = norm(post.path);
    if (!key) return;

    // 每篇文章都生成一组渐变参数（无头图 / 图片加载失败时兜底）
    grads[key] = gradOf(key);

    var title = unquote(post.covertitle);
    var set = unquote(post.coverset || post.coversub || '');
    var hasDim = !(post.coverdim === undefined || post.coverdim === null || post.coverdim === '');

    // 唯一判定：三处全空 → 不写文字层，原图不受任何影响
    if (!title && !set && !hasDim) return;

    if (map[key]) dup.push(key);

    map[key] = {
      t: title,
      s: set,
      d: dimOf(post.coverdim),
      title: str(post.title)
    };
    count++;
  });

  if (dup.length) {
    hexo.log.warn('[covermeta] 路径冲突（后者覆盖前者）: ' + dup.join(', '));
  }
  hexo.log.info('[covermeta] 封面文字层 ' + count + ' 篇 / 渐变兜底 ' +
    Object.keys(grads).length + ' 篇');

  var imgs = defaultImgs();

  return {
    path: 'covermeta.json',
    data: JSON.stringify({
      covers: map,
      grads: grads,
      defaults: imgs.defaults,
      placeholders: imgs.placeholders
    })
  };
});
