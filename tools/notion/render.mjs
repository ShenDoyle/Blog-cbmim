/**
 * tools/notion/render.mjs — Notion 区块 → Markdown 的转换层
 *
 * 复用 notion-to-md 做基础转换，再叠一层「anzhiyu 主题语法映射」，
 * 让 Notion 里的写法也能用上主题的 note / hideToggle 等能力，
 * 从而做到「换后台但主题功能不缩水」。
 *
 * 映射表：
 *   callout（任意颜色）          → {% note <type> %}…{% endnote %}
 *   callout 首行 [note:xxx]      → 指定 type / no-icon / 标题（可选写法）
 *   toggle（折叠块）             → {% hideToggle 标题 %}…{% endhideToggle %}
 *   段落内容为 [more]            → <!--more-->（自定义摘要截断）
 *   第一条分割线（divider）       → <!--more-->（页面上更直观的写法；后续分割线保持原样）
 *   代码块 / 表格 / 引用 / 列表   → 原样（走主题默认渲染）
 *
 * 注意：toggle 不能走「自定义转换器」——notion-to-md 会在
 * toMarkdownString() 里用 md.toggle() 再包一层 HTML。所以 toggle
 * 走「默认渲染 + 后处理」：把 <details><summary>x</summary>…</details>
 * 换成主题的 hideToggle 标签。
 */

import { NotionToMarkdown } from 'notion-to-md';

import { CALLOUT_COLOR_MAP, CALLOUT_EMOJI_MAP, MORE_MARKER, MORE_PLACEHOLDER } from './config.mjs';
import { log } from './log.mjs';

const DIRECTIVE = /^\[note:([a-zA-Z][a-zA-Z0-9_-]*)((?:\s+[^\]]*)?)\]/;
const NOTE_TYPES = new Set(['default', 'primary', 'info', 'success', 'warning', 'danger']);
const DETAILS_TOKEN = /<details>|<\/details>|<summary>([\s\S]*?)<\/summary>/g;

function plain(richText) {
  return (richText || []).map((t) => t.plain_text).join('');
}

/** 复刻 notion-to-md 的有序列表编号（自取子块时不会自动编号） */
function numberBlocks(blocks) {
  let index = 0;
  for (const block of blocks) {
    if (block.type === 'numbered_list_item') {
      index += 1;
      block.numbered_list_item = { ...(block.numbered_list_item || {}), number: index };
    } else {
      index = 0;
    }
  }
  return blocks;
}

function createRenderer({ notion }) {
  const n2m = new NotionToMarkdown({ notionClient: notion, config: { separateChildPage: false } });

  /** 拉取子块并转成 Markdown 字符串 */
  async function childrenToMarkdown(blockId) {
    const blocks = [];
    let cursor;
    do {
      const res = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
      blocks.push(...(res.results || []));
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);

    if (!blocks.length) return '';
    const mdBlocks = await n2m.blocksToMarkdown(numberBlocks(blocks));
    const out = n2m.toMarkdownString(mdBlocks);
    return out.parent || '';
  }

  /* ── callout → note ───────────────────────────────── */
  n2m.setCustomTransformer('callout', async (block) => {
    const callout = block.callout || {};
    let text = plain(callout.rich_text);
    const color = callout.color || 'default';
    const emoji = callout.icon?.type === 'emoji' ? callout.icon.emoji : '';

    let type = CALLOUT_COLOR_MAP[color] || CALLOUT_COLOR_MAP[color.replace(/_background$/, '')] || 'default';
    // 灰色/默认色没信息量，用 emoji 再推一次
    if (type === 'default' && emoji && CALLOUT_EMOJI_MAP[emoji]) type = CALLOUT_EMOJI_MAP[emoji];

    let label = '';
    let noIcon = false;
    const m = text.match(DIRECTIVE);
    if (m) {
      const forced = m[1].toLowerCase();
      if (NOTE_TYPES.has(forced)) type = forced;
      else log.warn(`callout 里写了无效的 note 类型「${forced}」，已回退为 ${type}（可选：${[...NOTE_TYPES].join('/')}）`);
      for (const token of (m[2] || '').trim().split(/\s+/).filter(Boolean)) {
        if (token === 'no-icon') noIcon = true;
        else if (!label) label = token;
      }
      text = text.replace(DIRECTIVE, '');
    }

    const child = block.has_children ? (await childrenToMarkdown(block.id)).trim() : '';
    const head = label ? `**${label}**\n\n` : '';
    const inner = `${head}${[text.trim(), child].filter(Boolean).join('\n\n')}`.trim();
    const attrs = [type, noIcon ? 'no-icon' : ''].filter(Boolean).join(' ');

    return `{% note ${attrs} %}\n${inner}\n{% endnote %}`;
  });

  /* ── paragraph：[more] → 摘要截断 ──────────────────── */
  n2m.setCustomTransformer('paragraph', (block) => {
    const text = plain(block.paragraph?.rich_text).trim();
    if (text === MORE_PLACEHOLDER) return MORE_MARKER;
    return false; // 交回默认渲染
  });

  return n2m;
}

/**
 * 把 notion-to-md 输出的 <details><summary>x</summary>…</details>
 * 换成主题的 {% hideToggle x %}…{% endhideToggle %}。
 *
 * 顶层折叠块转成标签；嵌套在折叠块里的（Notion 允许但主题标签不支持嵌套）
 * 保留原始 HTML，功能性不受影响，只是样式朴素一点，同时给出提示。
 */
function convertToggles(markdown) {
  if (!markdown.includes('<details>')) return { text: markdown, converted: 0, nested: 0 };

  let out = '';
  let last = 0;
  let depth = 0;
  let converted = 0;
  let nested = 0;

  DETAILS_TOKEN.lastIndex = 0;
  let m = DETAILS_TOKEN.exec(markdown);
  while (m) {
    out += markdown.slice(last, m.index);
    last = m.index + m[0].length;
    const token = m[0];

    if (token === '<details>') {
      depth += 1;
      if (depth === 1) {
        // 顶层：丢掉原生标签，等 summary 来开标签
      } else {
        nested += 1;
        out += token;
      }
    } else if (token === '</details>') {
      depth = Math.max(0, depth - 1);
      out += depth === 0 ? '{% endhideToggle %}' : '</details>';
    } else if (depth === 1) {
      const title = (m[1] || '').trim() || '展开查看';
      out += `{% hideToggle ${title} %}`;
      converted += 1;
    } else {
      out += token;
    }

    m = DETAILS_TOKEN.exec(markdown);
  }
  out += markdown.slice(last);

  return { text: out, converted, nested };
}

/**
 * 第一条独立成行的 `---` → <!--more-->。
 *
 * 首次导入把 Hexo 的 <!--more--> 落成 Notion 的分割线（比一行 [more] 文字直观），
 * 这里做反向映射。只在正文里还没有 [more] 占位符时生效，且只认第一条，
 * 后面的分割线保持原样（避免把正文里用于视觉分隔的线误当摘要截断）。
 */
function convertFirstDividerToMore(markdown) {
  if (markdown.includes(MORE_MARKER)) return { text: markdown, converted: false };
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      lines[i] = MORE_MARKER;
      return { text: lines.join('\n'), converted: true };
    }
  }
  return { text: markdown, converted: false };
}

/**
 * 渲染整页正文。
 * @returns {Promise<string>} Markdown 正文（未落盘，未本地化图片）
 */
export async function renderPageBody({ notion, pageId }) {
  const n2m = createRenderer({ notion });
  const mdBlocks = await n2m.pageToMarkdown(pageId);
  const out = n2m.toMarkdownString(mdBlocks);

  const body = out.parent || '';
  const extras = Object.keys(out).filter((k) => k !== 'parent');
  if (extras.length) {
    log.warn(`页面内含子页面（${extras.join(', ')}），其内容已忽略；如需收录请拆成独立文章。`);
  }

  const divided = convertFirstDividerToMore(body);
  if (divided.converted) log.debug('摘要截断：已把第一条分割线转成 <!--more-->');

  const toggles = convertToggles(divided.text);
  if (toggles.converted) log.debug(`折叠块：转换 ${toggles.converted} 个为 hideToggle`);
  if (toggles.nested) {
    log.warn(`检测到 ${toggles.nested} 个嵌套折叠块，主题标签不支持嵌套，已保留原生 HTML（能用但样式朴素）。`);
  }

  return toggles.text;
}
