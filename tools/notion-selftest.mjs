#!/usr/bin/env node
/**
 * tools/notion-selftest.mjs — 离线自检
 *
 * 不需要 Notion 令牌，用一份构造好的区块夹具把整条转换链跑一遍，
 * 验证：callout→note、toggle→hideToggle、[more]、front-matter 格式、
 * 图片识别与 CDN 改写、日期与时区。
 *
 * 用法：npm run notion:selftest
 */

import assert from 'node:assert/strict';

import { collectMarkdownImageUrls, isNotionHosted, localizeUrls, rewriteMarkdownImages } from './notion/assets.mjs';
import { PROPS } from './notion/config.mjs';
import {
  buildFrontMatter,
  ensureMoreMarker,
  formatDate,
  normalizeBody,
  pick,
  readCheckbox,
  readDate,
  readList,
  readNumber,
  readText,
  sanitizeSlug,
} from './notion/convert.mjs';
import { log, setVerbose } from './notion/log.mjs';
import { renderPageBody } from './notion/render.mjs';

/* ── 夹具 ───────────────────────────────────────────── */

function rt(content, extra = {}) {
  return {
    type: 'text',
    text: { content, link: null },
    annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
    plain_text: content,
    href: null,
    ...extra,
  };
}

const block = (id, type, payload, hasChildren = false) => ({ id, type, has_children: hasChildren, [type]: payload });

const CHILDREN = {
  'page-1': [
    block('b1', 'paragraph', { rich_text: [rt('这是第一段正文，用来验证摘要截断位置。')] }),
    block('b2', 'paragraph', { rich_text: [rt('[more]')] }),
    block('b3', 'heading_2', { rich_text: [rt('小标题')] }),
    block('b4', 'callout', { rich_text: [rt('这是一条警告提示')], color: 'yellow_background', icon: { type: 'emoji', emoji: '⚠️' } }, true),
    block('b5', 'callout', { rich_text: [rt('[note:success 完成]\n自定义指令生效')], color: 'gray_background', icon: { type: 'emoji', emoji: '🚀' } }),
    block('b6', 'callout', { rich_text: [rt('灰色无图标提示')], color: 'gray_background', icon: null }),
    block('b7', 'toggle', { rich_text: [rt('点开看详情')] }, true),
    block('b8', 'image', {
      caption: [rt('外链图')],
      type: 'external',
      external: { url: 'https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/site/a.webp' },
    }),
    block('b9', 'image', {
      caption: [],
      type: 'file',
      file: { url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/pic.png?X-Amz-Signature=deadbeef' },
    }),
    block('b10', 'divider', {}),
    block('b11', 'code', { rich_text: [rt('console.log(1)')], language: 'javascript', caption: [] }),
    block('b12', 'quote', { rich_text: [rt('一句引用')] }),
  ],
  b4: [block('b4-1', 'paragraph', { rich_text: [rt('提示内部正文')] })],
  b7: [
    block('b7-1', 'bulleted_list_item', { rich_text: [rt('第一项')] }),
    block('b7-2', 'numbered_list_item', { rich_text: [rt('第二项')] }),
  ],
};

/** 假客户端：只实现 blocks.children.list，够 notion-to-md 用 */
const fakeNotion = {
  blocks: {
    children: {
      list: async ({ block_id, start_cursor }) => {
        if (start_cursor) return { results: [], has_more: false, next_cursor: null };
        return { results: CHILDREN[block_id] || [], has_more: false, next_cursor: null };
      },
    },
  },
};

/* ── 断言小工具 ─────────────────────────────────────── */

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    log.ok(name);
  } catch (err) {
    failures.push({ name, message: err.message });
    log.err(`${name}\n      ${err.message.split('\n')[0]}`);
  }
}

/* ── 开始 ───────────────────────────────────────────── */

setVerbose(false);
log.info('离线自检开始（不访问 Notion）');

const body = normalizeBody(await renderPageBody({ notion: fakeNotion, pageId: 'page-1' }));

await check('callout（黄色/⚠️）→ {% note warning %} 且包含子块内容', () => {
  assert.ok(body.includes('{% note warning %}'), '未生成 warning 类型 note');
  assert.ok(body.includes('这是一条警告提示'), '丢失 callout 文本');
  assert.ok(body.includes('提示内部正文'), '丢失 callout 子块');
  assert.ok(/\{% endnote %\}/.test(body), '缺少 endnote');
});

await check('callout 指令 [note:success 完成] 生效并带加粗标题', () => {
  assert.ok(body.includes('{% note success %}'), '未按指令生成 success 类型');
  assert.ok(body.includes('**完成**'), '未把标题转成加粗行');
  assert.ok(body.includes('自定义指令生效'), '指令前缀未被剥离');
  assert.ok(!body.includes('[note:success'), '指令残留');
});

await check('callout（灰底无图标）→ {% note default %}', () => {
  assert.ok(body.includes('{% note default %}'), '未回退到 default');
  assert.ok(body.includes('灰色无图标提示'), '丢失文本');
});

await check('toggle → {% hideToggle 标题 %} 且保留子块', () => {
  assert.ok(body.includes('{% hideToggle 点开看详情 %}'), '未生成 hideToggle');
  assert.ok(body.includes('{% endhideToggle %}'), '缺少 endhideToggle');
  assert.ok(body.includes('第一项'), '丢失 toggle 子块（无序列表）');
  assert.ok(body.includes('第二项'), '丢失 toggle 子块（有序列表）');
  assert.ok(!body.includes('<details>'), '仍残留原生 details');
});

await check('[more] → <!--more--> 且位置在第一段之后', () => {
  const iFirst = body.indexOf('这是第一段正文');
  const iMore = body.indexOf('<!--more-->');
  const iHead = body.indexOf('## 小标题');
  assert.ok(iMore > -1, '未生成 <!--more-->');
  assert.ok(iFirst > -1 && iFirst < iMore, 'more 标记不在第一段之后');
  assert.ok(iHead > iMore, 'more 标记应在小标题之前');
});

await check('未写 [more] 时自动插入摘要标记', () => {
  const r = ensureMoreMarker('第一段内容\n\n第二段内容\n');
  assert.equal(r.inserted, true);
  assert.ok(r.body.indexOf('<!--more-->') > r.body.indexOf('第一段内容'));
  assert.ok(r.body.indexOf('<!--more-->') < r.body.indexOf('第二段内容'));
});

await check('标题/代码/引用/分割线正常输出', () => {
  assert.ok(body.includes('## 小标题'), '标题未渲染');
  assert.ok(body.includes('console.log(1)'), '代码块丢失');
  assert.ok(body.includes('> 一句引用'), '引用未渲染');
  assert.ok(body.includes('---'), '分割线丢失');
});

await check('图片：Notion 自有图床可识别，自家 CDN 不重复落地', () => {
  const urls = collectMarkdownImageUrls(body);
  assert.equal(urls.length, 2, `应收集到 2 张图，实际 ${urls.length}`);
  const notionUrl = urls.find((u) => u.includes('prod-files-secure'));
  const ownUrl = urls.find((u) => u.includes('jsdelivr'));
  assert.ok(isNotionHosted(notionUrl), 'Notion 图床未被识别');
  assert.equal(isNotionHosted(ownUrl), false, '自家 CDN 被误判为 Notion 图床');
});

await check('图片本地化：正文图片可回写为 CDN 地址', () => {
  const map = new Map([['https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/pic.png', 'https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/demo/notion-abc123.png']]);
  const out = rewriteMarkdownImages('![x](https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/pic.png)', map);
  assert.ok(out.includes('/img/cbmim/demo/notion-abc123.png'), '未替换为 CDN 地址');
});

await check('日期按东八区格式化，与现有文章格式一致', () => {
  assert.equal(formatDate('2025-08-15T08:28:53.000Z'), '2025/08/15 16:28:53');
  assert.equal(formatDate(''), '');
});

await check('front-matter 字段与现有 25 篇完全对齐', () => {
  const out = buildFrontMatter({
    title: 'GEO 的分享',
    date: '2025/08/15 16:28:53',
    updated: '2025/08/15 16:28:53',
    cover: 'https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/site/a.webp',
    top_group_index: 9,
    categories: '运营',
    tags: ['运营', 'GEO', 'AI'],
    ai: ['摘要一', '摘要二'],
    notion_page_id: 'abc-123',
  });
  const lines = out.split('\n');
  assert.equal(lines[0], '---');
  assert.equal(lines[lines.length - 1], '---');
  assert.ok(out.includes('title: GEO 的分享'), 'title 输出异常');
  assert.ok(out.includes('top_group_index: 9'), '数字未按数字输出');
  assert.ok(out.includes('categories: 运营'), '单分类未按字符串输出');
  assert.ok(out.includes('  - GEO'), '数组未按块列表输出');
  assert.ok(!out.includes('undefined'), '出现 undefined');
});

await check('属性读取：中英文名、类型兼容', () => {
  const props = {
    标题: { type: 'title', title: [rt('中文标题')] },
    Slug: { type: 'rich_text', rich_text: [rt('my-post')] },
    分类: { type: 'select', select: { name: '运营' } },
    标签: { type: 'multi_select', multi_select: [{ name: 'GEO' }, { name: 'SEO' }] },
    置顶: { type: 'number', number: 5 },
    发布: { type: 'checkbox', checkbox: false },
    日期: { type: 'date', date: { start: '2025-08-15T08:28:53.000Z' } },
  };
  assert.equal(readText(pick(props, PROPS.title)), '中文标题');
  assert.equal(readText(pick(props, PROPS.slug)), 'my-post');
  assert.deepEqual(readList(pick(props, PROPS.tags)), ['GEO', 'SEO']);
  assert.equal(readNumber(pick(props, PROPS.topIndex)), 5);
  assert.equal(readCheckbox(pick(props, PROPS.publish)), false);
  assert.equal(readCheckbox(pick(props, PROPS.publish), true), false);
  assert.equal(formatDate(readDate(pick(props, PROPS.date))), '2025/08/15 16:28:53');
  // 英文兜底
  assert.equal(readText(pick({ Title: { type: 'title', title: [rt('EN')] } }, PROPS.title)), 'EN');
  // 缺字段时默认视为已发布
  assert.equal(readCheckbox(null, true), true);
});

await check('slug 清洗：去空格与非法字符', () => {
  assert.equal(sanitizeSlug('  My Post / 2026  '), 'My-Post-2026');
  assert.equal(sanitizeSlug('a::b??c'), 'abc');
});

await check('图片下载（dry-run）不落盘也能给出映射', async () => {
  const res = await localizeUrls(
    ['https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/pic.png?sig=1'],
    { slug: '__selftest__', dryRun: true }
  );
  assert.equal(res.map.size, 1);
  const url = [...res.map.values()][0];
  assert.ok(url.startsWith('https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/__selftest__/notion-'));
  assert.ok(url.endsWith('.png'));
});

/* ── 汇总 ───────────────────────────────────────────── */

process.stdout.write('\n');
log.info(`正文预览（前 600 字）：\n${body.slice(0, 600)}\n`);
process.stdout.write('\n');

if (failures.length) {
  log.err(`自检未通过：${passed} 项通过，${failures.length} 项失败`);
  for (const f of failures) log.err(` - ${f.name}`);
  process.exitCode = 1;
} else {
  log.ok(`自检全部通过：${passed} 项`);
}
