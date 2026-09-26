#!/usr/bin/env node
/**
 * tools/notion-import-prep.mjs — 本地文章 → Notion 导入包
 *
 * 为每篇 source/_posts/<slug>.md 生成 tools/_import/<slug>.json：
 *   { slug, title, date, properties, content, stats }
 * properties 直接对应 Notion「🗂 博文」库（data source 8aee0783-…）的属性名，
 * content 是转换好的 Notion-flavored Markdown，可直接喂给 create-pages。
 *
 * 用法：
 *   node tools/notion-import-prep.mjs                 # 生成全部
 *   node tools/notion-import-prep.mjs --only geoaq    # 只生成某一篇
 *   node tools/notion-import-prep.mjs --check         # 只体检，不写文件
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { SITE_ROOT, POSTS_DIR } from './notion/config.mjs';

const OUT_DIR = path.join(SITE_ROOT, 'tools', '_import');

/** Notion「🗂 博文」库的 data source（见 docs/Notion接入-结构与导入设计.md） */
export const POSTS_DATA_SOURCE_ID = '8aee0783-0b53-41e0-861e-0b26993518e3';

/** 主题 note 类型 → Notion callout 的 图标 + 底色 */
const TIP_TO_CALLOUT = {
  info: ['ℹ️', 'blue_bg'],
  success: ['✅', 'green_bg'],
  warning: ['⚠️', 'yellow_bg'],
  danger: ['❗', 'red_bg'],
  primary: ['📌', 'purple_bg'],
  default: ['💡', 'gray_bg'],
  light: ['💡', 'gray_bg'],
};

/* ────────────────────────── front-matter ────────────────────────── */

/**
 * 解析 front-matter。
 * 用 JSON_SCHEMA：不让 YAML 把 `2019-01-07 23:14:57` 当成 UTC 时间戳，
 * 日期一律留字符串，后面自己按东八区解析，避免整体偏移 8 小时。
 */
function parseFrontMatter(raw) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  let data = {};
  try {
    data = yaml.load(m[1], { schema: yaml.JSON_SCHEMA }) || {};
  } catch (err) {
    throw new Error(`front-matter 解析失败：${err.message}`);
  }
  return { data, body: text.slice(m[0].length) };
}

/** `2019/01/07 23:14:57` / `2025-10-24 10:04:32` → ISO 东八区 */
function toIso(local) {
  const s = String(local ?? '').trim().replace(/^["']|["']$/g, '');
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return { iso: '', isDateTime: 0 };
  const [, y, mo, d, h, mi, sec] = m;
  const p = (v, f = '00') => String(v ?? f).padStart(2, '0');
  const head = `${y}-${p(mo)}-${p(d)}`;
  if (h === undefined) return { iso: head, isDateTime: 0 };
  return { iso: `${head}T${p(h)}:${p(mi)}:${p(sec || '00')}+08:00`, isDateTime: 1 };
}

/** 标量 / 数组 → 字符串数组 */
function toList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value)
    .split(/[,，]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/* ────────────────────────── 正文转换 ────────────────────────── */

/** Hexo markdown → Notion-flavored markdown */
function toNotionMarkdown(body) {
  let s = body.replace(/\r\n/g, '\n');

  // {% tip info %} … {% endtip %} → callout（保留内部段落）
  s = s.replace(
    /\{%[ \t]*tip[ \t]+([a-z_]+)[ \t]*%\}([\s\S]*?)\{%[ \t]*endtip[ \t]*%\}/g,
    (_all, type, inner) => {
      const [icon, color] = TIP_TO_CALLOUT[String(type).toLowerCase()] || TIP_TO_CALLOUT.default;
      const lines = String(inner)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const content = (lines.length ? lines : ['']).map((l) => `\t${l}`).join('\n');
      return `<callout icon="${icon}" color="${color}">\n${content}\n</callout>`;
    },
  );

  // {% tabs %} / {% endtabs %}：Notion 无对应块，降级为普通小标题（反向同步不丢内容）
  s = s.replace(/^[ \t]*\{%[ \t]*tabs[ \t]+[^%]*%\}[ \t]*$/gm, '');
  s = s.replace(/^[ \t]*\{%[ \t]*endtabs[ \t]*%\}[ \t]*$/gm, '');
  s = s.replace(/^[ \t]*<!--[ \t]*tab[ \t]+([\s\S]*?)[ \t]*-->[ \t]*$/gm, (_all, name) => `#### ${String(name).trim()}`);
  s = s.replace(/^[ \t]*<!--[ \t]*endtab[ \t]*-->[ \t]*$/gm, '');

  // 摘要截断：Hexo 的 <!--more--> → Notion 分隔线
  s = s.replace(/^[ \t]*<!--[ \t]*more[ \t]*-->[ \t]*$/gim, '---');

  // 兜底：剩下的 {% %} 标签原样保留会被 Notion 当文本显示，这里显式报出来
  return s
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n*$/, '\n');
}

/* ────────────────────────── 单篇 ────────────────────────── */

function buildOne(file) {
  const slug = path.basename(file, '.md');
  const raw = fs.readFileSync(file, 'utf8');
  const { data, body } = parseFrontMatter(raw);

  const title = String(data.title || slug).trim();
  const date = toIso(data.date);
  const content = toNotionMarkdown(body);

  const properties = {
    标题: title,
    Slug: slug,
    分类: toList(data.categories),
    标签: toList(data.tags),
    摘要: toList(data.ai).join('\n'),
    发布: '__YES__',
  };
  if (data.cover) properties['封面'] = String(data.cover).trim();
  if (date.iso) {
    // 注意：不写 date:日期:is_datetime —— 桥接层的类型转换会把它变成字符串而被 Notion 拒绝；
    // start 自带时间部分时，Notion 会自动把该属性推断为 datetime。
    properties['date:日期:start'] = date.iso;
  }
  // 置顶是 number 属性，create 时同样会被类型校验拒绝，交给导入流程二次 update 补写
  if (typeof data.top_group_index === 'number') properties['_sticky'] = data.top_group_index;
  if (typeof data.top_index === 'number') properties['_sticky'] = data.top_index;

  const leftover = [...content.matchAll(/\{%[\s\S]*?%\}/g)].map((m) => m[0]);

  return {
    slug,
    title,
    date: date.iso,
    properties,
    content,
    stats: {
      chars: content.length,
      hasMore: content.includes('\n---\n') || content.startsWith('---\n'),
      leftoverTags: leftover,
    },
  };
}

/* ────────────────────────── main ────────────────────────── */

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : '';

  if (!fs.existsSync(POSTS_DIR)) {
    console.error(`找不到文章目录：${POSTS_DIR}`);
    process.exit(1);
  }

  let files = fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (only) files = files.filter((f) => f === `${only}.md` || f.includes(only));

  if (!files.length) {
    console.error('没有匹配的文章');
    process.exit(1);
  }

  if (!checkOnly) fs.mkdirSync(OUT_DIR, { recursive: true });

  const index = [];
  let bad = 0;

  for (const f of files) {
    let item;
    try {
      item = buildOne(path.join(POSTS_DIR, f));
    } catch (err) {
      bad += 1;
      console.log(`✗ ${f}  ${err.message}`);
      continue;
    }

    if (!checkOnly) {
      fs.writeFileSync(path.join(OUT_DIR, `${item.slug}.json`), JSON.stringify({
        slug: item.slug,
        properties: item.properties,
        content: item.content,
      }, null, 2) + '\n', 'utf8');
    }

    index.push({
      slug: item.slug,
      title: item.title,
      date: item.date,
      分类: (item.properties['分类'] || []).join('/'),
      标签: (item.properties['标签'] || []).join('/'),
      chars: item.stats.chars,
      leftover: item.stats.leftoverTags,
    });

    const flag = item.stats.leftoverTags.length ? ` ⚠ 残留标签 ${item.stats.leftoverTags.length}` : '';
    console.log(`✓ ${item.slug.padEnd(24)} ${String(item.date).padEnd(26)} ${item.stats.chars} 字${flag}`);
  }

  if (!checkOnly) {
    fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    console.log(`\n生成 ${index.length} 个导入包 → ${OUT_DIR}`);
  }

  const leftovers = index.filter((i) => i.leftover.length);
  if (leftovers.length) {
    console.log('\n需人工确认的残留标签：');
    for (const i of leftovers) console.log(`  ${i.slug}: ${i.leftover.join(' ')}`);
  }
  if (bad) {
    console.error(`\n${bad} 篇解析失败`);
    process.exit(1);
  }
}

main();
