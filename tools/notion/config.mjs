/**
 * tools/notion/config.mjs — Notion → Hexo 同步的集中配置
 *
 * 改这里就能适配字段名 / 路径 / 图片命名空间，不用动同步逻辑。
 *
 * 依赖的仓库约定（与现有 25 篇文章保持一致，勿随意改动）：
 *   文章：source/_posts/<slug>.md
 *   图片：source/img/<IMG_NAMESPACE>/<slug>/<文件>
 *   引用：https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/<IMG_NAMESPACE>/<slug>/<文件>
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 站点根目录（tools/notion/ → 上两级） */
export const SITE_ROOT = path.resolve(HERE, '..', '..');
export const POSTS_DIR = path.join(SITE_ROOT, 'source', '_posts');
export const DRAFTS_DIR = path.join(SITE_ROOT, 'source', '_drafts');
export const IMG_ROOT = path.join(SITE_ROOT, 'source', 'img');
export const STATE_FILE = path.join(SITE_ROOT, '.notion-sync-state.json');

/** 独立页面库（📄 页面）；优先读环境变量，默认值 = CBMIM 博客下的页面数据源 */
export const PAGES_DATA_SOURCE_ID = (process.env.NOTION_PAGES_DB_ID || '').trim() ||
  'b12990b0-b20f-47d5-81a6-6c3096ef4249';
export const PAGES_STATE_FILE = path.join(SITE_ROOT, '.notion-pages-state.json');

/** 图片命名空间：与既有文章一致 → source/img/cbmim/<slug>/xxx.webp */
export const IMG_NAMESPACE = 'cbmim';

/** 发布产物仓库；jsDelivr 的 @main 指向的就是它（GitHub Pages 产物仓） */
export const SITE_REPO = 'ShenDoyle/ShenDoyle.github.io';
export const CDN_BASE = `https://cdn.jsdelivr.net/gh/${SITE_REPO}@main`;
export const CDN_IMG_BASE = `${CDN_BASE}/img`;

/** 时区：Notion 日期统一按东八区落盘，和现有文章一致 */
export const TIMEZONE = 'Asia/Shanghai';

/** 只有这些域名的图片会被下载落地（Notion 自家图床，链接 1 小时过期）；其余外链原样保留 */
export const NOTION_IMAGE_HOSTS = [
  'prod-files-secure.s3',
  'amazonaws.com',
  'notion-static.com',
  'notion.so',
  'notionusercontent.com',
];

/**
 * Notion 属性名候选（按顺序取第一个命中的，大小写不敏感）。
 * 左侧是用途，右侧是宽松候选 —— 中英文命名都能认。
 */
export const PROPS = {
  title: ['标题', 'Title', 'Name', '名称'],
  slug: ['Slug', 'slug', '路径', '文件名', 'URL'],
  date: ['日期', 'Date', '发布日期'],
  categories: ['分类', 'Categories', 'Category'],
  tags: ['标签', 'Tags', 'Tag'],
  cover: ['封面', 'Cover', '头图'],
  topIndex: ['置顶', '置顶权重', 'top_group_index', 'TopGroupIndex'],
  summary: ['摘要', '描述', 'Description', 'ai'],
  publish: ['发布', 'Published', 'Publish', '上线'],
  pageId: ['页面ID', 'PageID', 'NotionID'],
  // 以下 3 个为可选，配合 scripts/covermeta.js 的封面蒙版使用
  coverTitle: ['封面标题', 'covertitle'],
  coverSub: ['封面副标题', 'coverset'],
  coverDim: ['蒙版强度', 'coverdim'],
  // 以下为主题支持但按需填写的可选配置，留空则不写入 front-matter
  aside: ['侧栏', 'aside'],                     // true/false，false 时文章不显示侧栏
  toc: ['目录', 'toc'],                         // true/false，控制文章目录显隐
  comments: ['评论', 'comments'],               // true/false，false 时关闭该篇评论
  keywords: ['关键词', 'keywords'],             // SEO 关键词，英文逗号分隔
  topImg: ['头图', 'top_img'],                  // 文章页头图 URL；填 false 隐藏头图
};

/** callout 颜色 → anzhiyu/butterfly 的 note 类型 */
export const CALLOUT_COLOR_MAP = {
  gray: 'default',
  default: 'default',
  brown: 'default',
  blue: 'info',
  purple: 'primary',
  green: 'success',
  yellow: 'warning',
  orange: 'warning',
  pink: 'danger',
  red: 'danger',
};

/** callout 图标兜底：颜色没给信息时，用 emoji 推断 note 类型 */
export const CALLOUT_EMOJI_MAP = {
  '💡': 'info',
  'ℹ️': 'info',
  '✅': 'success',
  '⚠️': 'warning',
  '❗': 'danger',
  '❌': 'danger',
  '🚫': 'danger',
  '📌': 'primary',
  '🔥': 'danger',
};

/** 正文里写这一行（独立成段的 [more]）→ 转成 Hexo 的 <!--more--> 摘要截断 */
export const MORE_PLACEHOLDER = '[more]';
export const MORE_MARKER = '<!--more-->';

/** 报告里显示、但不算错误的提示级别 */
export const MANAGED_FIELD = 'notion_page_id';

/**
 * 读取环境变量，缺啥报啥。
 * 额外支持站点根目录下的 .env（该文件已在 .gitignore 中，令牌不会进仓库）。
 */
export function readEnv() {
  loadDotEnv();
  const token = (process.env.NOTION_TOKEN || '').trim();
  const databaseId = (process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID || '').trim();
  const missing = [];
  if (!token) missing.push('NOTION_TOKEN');
  if (!databaseId) missing.push('NOTION_DATABASE_ID');
  return { token, databaseId, missing };
}

/** 极简 .env 解析：只填 process.env 里还没有的键，不覆盖已有值 */
function loadDotEnv() {
  const file = path.join(SITE_ROOT, '.env');
  let raw;
  try {
    // 同步读取，避免把整个调用链改成 async
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
