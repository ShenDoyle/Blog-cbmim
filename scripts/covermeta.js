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
 * front-matter 字段：
 *   covertitle: 封面主标题（可选），最佳 4~12 字
 *               小尺寸档位只能显示 6~10 字，超过 12 字在中小卡片上会被截断
 *   coverset:   封面副标题（可选），最佳 ≤14 字
 *               只在中大尺寸档位显示，超过 24 字自动截断
 *   coverdim:   蒙版强度（可选），默认 0.46
 *                填 0 / false 表示不加蒙版；支持 0~1 小数或 0~100 的百分数
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

hexo.extend.generator.register('covermeta', function (locals) {
  var map = {};
  var dup = [];
  var count = 0;

  locals.posts.forEach(function (post) {
    var title = unquote(post.covertitle);
    var set = unquote(post.coverset || post.coversub || '');
    var hasDim = !(post.coverdim === undefined || post.coverdim === null || post.coverdim === '');

    // 唯一判定：三处全空 → 跳过，原图不受任何影响
    if (!title && !set && !hasDim) return;

    var key = norm(post.path);
    if (!key) return;
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
  hexo.log.info('[covermeta] 已启用封面文字层的文章：' + count + ' 篇');

  return {
    path: 'covermeta.json',
    data: JSON.stringify(map)
  };
});
