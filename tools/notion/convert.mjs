/**
 * tools/notion/convert.mjs — Notion 属性 → Hexo front-matter，以及正文收尾
 *
 * front-matter 字段与站点现有 25 篇文章**完全一致**，不引入新字段（除 notion_page_id）。
 */

import { MORE_MARKER, MORE_PLACEHOLDER, TIMEZONE } from './config.mjs';

/* ────────────────────────── 属性读取 ────────────────────────── */

/** 按候选名取属性（大小写不敏感） */
export function pick(props, candidates) {
  if (!props) return null;
  for (const name of candidates) {
    if (props[name] !== undefined) return props[name];
  }
  const lower = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));
  for (const name of candidates) {
    const hit = lower.get(name.toLowerCase());
    if (hit) return props[hit];
  }
  return null;
}

/** 取纯文本：title / rich_text / select / url / email / phone / status / formula(字符串) */
export function readText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title':
      return (prop.title || []).map((t) => t.plain_text).join('').trim();
    case 'rich_text':
      return (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
    case 'select':
      return prop.select?.name?.trim() || '';
    case 'status':
      return prop.status?.name?.trim() || '';
    case 'url':
      return (prop.url || '').trim();
    case 'email':
      return (prop.email || '').trim();
    case 'phone_number':
      return (prop.phone_number || '').trim();
    case 'formula': {
      const f = prop.formula || {};
      if (f.type === 'string') return (f.string || '').trim();
      if (f.type === 'number') return f.number === null ? '' : String(f.number);
      if (f.type === 'boolean') return String(f.boolean);
      return '';
    }
    case 'number':
      return prop.number === null ? '' : String(prop.number);
    default:
      return '';
  }
}

/** 取多值列表：multi_select / relation → 名字数组；单值 → 单元素数组 */
export function readList(prop) {
  if (!prop) return [];
  if (prop.type === 'multi_select') return (prop.multi_select || []).map((o) => o.name.trim()).filter(Boolean);
  if (prop.type === 'select') return prop.select?.name ? [prop.select.name.trim()] : [];
  const single = readText(prop);
  return single ? [single] : [];
}

/** 取数字 */
export function readNumber(prop) {
  if (!prop) return undefined;
  if (prop.type === 'number') return prop.number === null ? undefined : prop.number;
  if (prop.type === 'formula' && prop.formula?.type === 'number') return prop.formula.number ?? undefined;
  const text = readText(prop);
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** 取勾选。字段不存在时返回 fallback（默认视为已发布） */
export function readCheckbox(prop, fallback = true) {
  if (!prop) return fallback;
  if (prop.type === 'checkbox') return !!prop.checkbox;
  return fallback;
}

/** 取可选布尔（三态）：select("true"/"false") / checkbox / 文本 "true"/"false"；未填返回 undefined */
export function readOptionalBool(prop) {
  if (!prop) return undefined;
  if (prop.type === 'checkbox') return !!prop.checkbox;
  const text = readText(prop).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

/** 取日期起始时间（ISO 字符串） */
export function readDate(prop) {
  if (!prop || prop.type !== 'date' || !prop.date) return '';
  return prop.date.start || '';
}

/** 取图片 URL：files 属性（取第一张）或 url 属性 */
export function readImageUrl(prop) {
  if (!prop) return '';
  if (prop.type === 'files') {
    const first = (prop.files || [])[0];
    if (!first) return '';
    if (first.type === 'external') return first.external?.url || '';
    if (first.type === 'file') return first.file?.url || '';
    return '';
  }
  if (prop.type === 'url') return (prop.url || '').trim();
  return '';
}

/* ────────────────────────── 格式化 ────────────────────────── */

/** ISO → 2025/08/15 16:28:53（东八区），与现有文章格式一致 */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  // sv-SE 输出 2025-08-15 16:28:53
  return parts.replace(/-/g, '/');
}

/** 文本 → 文件名安全的 slug */
export function sanitizeSlug(input) {
  return String(input || '')
    .trim()
    .replace(/[\\/:*?"<>|#%{}$!'@+`=~^]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** 标题 → 兜底 slug（仅当没填 Slug 且无历史文件名时使用，会告警） */
export function slugFromTitle(title) {
  const base = sanitizeSlug(title);
  if (base) return base;
  return `post-${Date.now()}`;
}

/* ────────────────────────── YAML 输出 ────────────────────────── */

/** 只在必要时加引号：中文、URL、普通词保持与现有文章一致的不带引号写法 */
function yamlScalar(value) {
  const s = String(value);
  if (s === '') return "''";
  const needsQuote =
    /^\s|\s$/.test(s) ||
    /[\n\r\t]/.test(s) ||
    /: |:$/.test(s) ||
    s.startsWith('#') ||
    / #/.test(s) ||
    /^[&*?|[\]{}>%@`"'!]/.test(s) ||
    /^-\s/.test(s) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(s) ||
    /^-?\d+(\.\d+)?$/.test(s);
  return needsQuote ? JSON.stringify(s) : s;
}

/** 组装 front-matter 文本（含首尾 ---） */
export function buildFrontMatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else {
      const s = String(value);
      if (s === '') continue;
      lines.push(`${key}: ${yamlScalar(s)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/* ────────────────────────── 正文收尾 ────────────────────────── */

const SKIP_FOR_MORE = /^(#{1,6}\s|!\[|<|\{%|```|---|\||>|[-*+]\s|\d+\.\s)/;

/**
 * 确保存在 <!--more-->。
 * 优先用 Notion 里手写的 [more] 段落（已由渲染层转成注释）；
 * 没有的话，自动插在第一段普通正文之后。
 */
export function ensureMoreMarker(body) {
  if (body.includes(MORE_MARKER)) return { body, inserted: false };

  const blocks = body.split(/\n{2,}/);
  let target = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    const t = blocks[i].trim();
    if (!t) continue;
    if (t === MORE_PLACEHOLDER) continue;
    if (SKIP_FOR_MORE.test(t)) continue;
    target = i;
    break;
  }
  if (target === -1) target = 0;

  blocks.splice(target + 1, 0, MORE_MARKER);
  return { body: blocks.join('\n\n'), inserted: true };
}

/** 统一空白：行尾空格、连续空行、结尾换行 */
/**
 * Notion 会把正文里的裸 URL 自动美化成 Markdown 链接。
 * 一旦这个 URL 出现在主题标签的参数里（{% cell 文字, 链接 %}、{% site ..., screenshot=链接 %}），
 * 导出后就会变成 [链接](链接)，而标签解析器会把整串 [x](y) 当成参数值 —— 链接坏掉、图片空掉。
 * 这里把「标签参数内部」的自链接（文字与地址相同的链接）解包回裸 URL。
 * 只在 {% ... %} 与 <!-- ... --> 这种单行标签片段里做，正文里的正常链接不受影响。
 */
function unwrapTagLinks(body) {
  const same = (a, b) => {
    const norm = (s) => String(s || '').trim().replace(/\/+$/, '');
    return norm(a) === norm(b);
  };
  const isUrl = (s) => /^(https?:\/\/|\/)/i.test(String(s).trim());

  // 前置边界（行首 / 空白 / 逗号 / 等号 / 括号）：只处理「独立成段」的链接，
  // 描述文字里的正常链接（如 看[这里](url)）不碰。
  return String(body || '').replace(/\{%[^%\n]*%\}|<!--[^\n]*-->/g, (tag) =>
    tag.replace(/(^|[\s,=({])?\[([^\]\n]+)\]\(([^)\s]+)\)/g, (full, pre, text, url) => {
      const head = pre || '';
      if (same(text, url)) return head + url;      // 自链接：Notion 自动美化的 [url](url)
      if (isUrl(text)) return head + text.trim();  // 文字本身是 URL：粘贴覆盖时保留了旧链接注解
      if (isUrl(url)) return head + url.trim();    // 文字是说明、地址才是参数（cell 的链接参数写成 [文字](链接)）
      return full;
    })
  );
}

/**
 * 标签页的包裹层容错：本主题的 tabs 标签要求 `{% tabs 名称 %}` … `{% endtabs %}`，
 * 内部才是 `<!-- tab 标题 -->` … `<!-- endtab -->`。
 * 但很多人（含我）习惯写成 butterfly 的 `<!-- tabs 名称 -->` … `<!-- endtabs -->`，
 * 结果整块变成不可见的 HTML 注释、标签页完全不渲染。这里把它等价转换过来。
 */
function normalizeTagWrapper(body) {
  return String(body || '')
    .replace(/^[ \t]*<!--\s*tabs\b([^\n]*?)-->[ \t]*$/gm, (m, rest) => {
      const name = String(rest || '').trim();
      return name ? `{% tabs ${name} %}` : '{% tabs %}';
    })
    .replace(/^[ \t]*<!--\s*endtabs\s*-->[ \t]*$/gm, '{% endtabs %}');
}

export function normalizeBody(body) {
  return unwrapTagLinks(normalizeTagWrapper(String(body || '')))
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n*$/, '\n');
}
