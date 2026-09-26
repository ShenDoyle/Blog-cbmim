/**
 * covermeta.js — Hexo 生成器
 *
 * 作用：扫描 source/_posts/*.md 的 front-matter，把封面标题抽取出来，
 *       生成一份 covermeta.json，供前端 cover-overlay.js 叠加「蒙版 + 文字」。
 *
 * ── 核心规则（唯一判定条件）────────────────────────
 *   不填 covertitle  →  完全不介入，原封面图原样显示（现有图片零改动）
 *   填了 covertitle  →  在原封面图上叠一层蒙版，再渲染文字
 * ────────────────────────────────────────────────
 *
 * front-matter 字段：
 *   covertitle: 封面主标题（必填才启用），建议 4~12 字
 *   coverset:   封面副标题（可选），建议 4~14 字
 *   coverdim:   蒙版强度（可选），默认 0.46
 *                填 0 / false 表示不加蒙版；支持 0~1 小数或 0~100 的百分数
 *   cover_base: 替换封面底图（可选）。留空则直接使用现有 cover 图。
 *
 * 蒙版的作用：把原封面图整体压暗，让上方的文字获得足够对比度。
 * 因此即使现有封面图里已烘焙过文字，也会被压到背景层，不会与新文字抢视觉。
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
    // 唯一判定：没写主标题就跳过，原图不受任何影响
    var title = unquote(post.covertitle);
    if (!title) return;

    var key = norm(post.path);
    if (!key) return;
    if (map[key]) dup.push(key);

    map[key] = {
      t: title,
      s: unquote(post.coverset || post.coversub || ''),
      d: dimOf(post.coverdim),
      b: unquote(post.cover_base),
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
