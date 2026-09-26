#!/usr/bin/env node
/**
 * tools/notion-sync.mjs — Notion → Hexo 文章同步（命令行入口）
 *
 * 用法：
 *   NOTION_TOKEN=xxx NOTION_DATABASE_ID=yyy node tools/notion-sync.mjs
 *   npm run notion:sync -- --dry-run          # 只预览，不写任何文件
 *   npm run notion:sync -- --force            # 忽略增量，全部重写
 *   npm run notion:sync -- --only <slug|pageId>
 *   npm run notion:sync -- --limit 3
 *   npm run notion:sync -- --prune-assets     # 顺带清理没被引用的 notion-* 图片
 *   npm run notion:sync -- --verbose
 *
 * 安全约定：
 *   - 只增改，不自动删除文章；Notion 取消「发布」只提示
 *   - 只动带 notion_page_id 的文件，手写文章永不触碰
 *   - 只下载 Notion 自家图床的图片，外部图片链接原样保留
 *   - Slug 与日期一旦确定就锁定，避免文章 URL 变化
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { createClient, explainError, queryAllPages, resolveDataSource } from './notion/api.mjs';
import { collectMarkdownImageUrls, localizeUrls, pruneOrphanAssets, rewriteMarkdownImages } from './notion/assets.mjs';
import { MANAGED_FIELD, POSTS_DIR, PROPS, readEnv } from './notion/config.mjs';
import {
  buildFrontMatter,
  ensureMoreMarker,
  formatDate,
  normalizeBody,
  pick,
  readCheckbox,
  readDate,
  readImageUrl,
  readList,
  readNumber,
  readOptionalBool,
  readText,
  sanitizeSlug,
  slugFromTitle,
} from './notion/convert.mjs';
import { log, setVerbose } from './notion/log.mjs';
import { renderPageBody } from './notion/render.mjs';
import { adoptFromDisk, loadState, saveState, scanManagedPosts } from './notion/state.mjs';

/* ────────────────────────── 参数 ────────────────────────── */

function parseArgs(argv) {
  const opts = { force: false, dryRun: false, pruneAssets: false, limit: 0, only: '', htmlNotes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--prune-assets') opts.pruneAssets = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--limit') opts.limit = Number(argv[++i]) || 0;
    else if (a === '--only') opts.only = String(argv[++i] || '').trim();
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

const HELP = `
Notion → Hexo 同步

环境变量（必填）：
  NOTION_TOKEN          Notion Integration 令牌（ntn_ 或 secret_ 开头）
  NOTION_DATABASE_ID    数据库 ID（Notion 数据库链接里 32 位那一段）

可选参数：
  --dry-run        只打印将要做什么，不写文件、不写状态
  --force          忽略 last_edited_time，全部重新生成
  --only <值>      只处理某个 slug 或 Notion 页面 ID（调试用）
  --limit <n>      只处理前 n 篇（调试用）
  --prune-assets   删除已不再被引用的 notion-* 图片
  --verbose        打印细节
  --help           显示本帮助

例：
  npm run notion:sync
  npm run notion:sync -- --dry-run --verbose
`;

/* ────────────────────────── 字段体检 ────────────────────────── */

const REQUIRED_PROPS = [
  { key: 'title', hint: '文章标题' },
  { key: 'slug', hint: '决定文章 URL，一旦发布不要再改' },
  { key: 'date', hint: '不填会回退到页面创建时间，并在日志里提醒' },
  { key: 'publish', hint: '不填则默认全部视为已发布' },
];

const OPTIONAL_PROPS = [
  'categories',
  'tags',
  'cover',
  'topIndex',
  'summary',
  'coverTitle',
  'coverSub',
  'coverDim',
  'aside',
  'toc',
  'comments',
  'keywords',
  'topImg',
];

/* ── 封面文字层限制（与 scripts/covermeta.js、Notion 字段注释同源）── */
const COVER_TITLE_MAX = 12; // 主标题最佳 4~12 字，小尺寸档位只显示 6~10 字
const COVER_SUB_MAX = 14; // 副标题最佳 ≤14 字，超过 24 字前端自动截断

/** 蒙版强度归一化：46 → 0.46（百分数写法），越界收敛并告警 */
function readCoverDim(prop, title) {
  const raw = readNumber(prop);
  if (raw === undefined) return undefined;
  let n = raw;
  if (n > 1 && n <= 100) n = n / 100;
  if (n < 0 || n > 1) {
    log.warn(`「${title}」蒙版强度 ${raw} 超出 0~1 范围，已收敛到 ${n < 0 ? 0 : 1}`);
    n = Math.min(1, Math.max(0, n));
  }
  return Math.round(n * 1000) / 1000;
}

/** 按数据库 schema 检查字段是否齐备，缺了就直说缺什么、叫什么名字能认 */
function validateSchema(properties) {
  if (!properties || !Object.keys(properties).length) return;

  const missingRequired = REQUIRED_PROPS.filter((p) => !pick(properties, PROPS[p.key]));
  const missingOptional = OPTIONAL_PROPS.filter((k) => !pick(properties, PROPS[k]));

  if (missingRequired.length) {
    log.warn('数据库里没找到这些关键字段，可能影响同步效果：');
    for (const p of missingRequired) {
      log.warn(`  · ${p.hint} → 可命名为：${PROPS[p.key].join(' / ')}`);
    }
  }
  if (missingOptional.length) {
    log.info(
      `未创建的可选字段（不影响发布）：${missingOptional.map((k) => PROPS[k][0]).join('、')}；` +
        `需要的话可命名为：${missingOptional.flatMap((k) => PROPS[k]).join(' / ')}`
    );
  }
  if (!missingRequired.length && !missingOptional.length) log.ok('字段体检通过：必填与可选字段齐全');
}

/* ────────────────────────── 单篇处理 ────────────────────────── */

function resolveSlug({ page, props, existing, title }) {
  const fromNotion = sanitizeSlug(readText(pick(props, PROPS.slug)));
  if (fromNotion) return { slug: fromNotion, source: 'notion', warning: '' };

  if (existing?.slug) {
    return {
      slug: existing.slug,
      source: 'locked',
      warning: 'Slug 为空，已沿用历史文件名以保证 URL 不变',
    };
  }

  const derived = slugFromTitle(title);
  return {
    slug: derived,
    source: 'derived',
    warning: `Slug 为空，已由标题生成「${derived}」——请在 Notion 里补填 Slug，否则改标题会导致 URL 变化`,
  };
}

async function processPage({ page, props, state, managedPosts, notion, opts, counters }) {
  const title = readText(pick(props, PROPS.title)) || '(无标题)';
  const publishProp = pick(props, PROPS.publish);
  const published = readCheckbox(publishProp, true);

  if (!published) {
    counters.unpublished.push({ title, id: page.id });
    return;
  }

  const existing = state.pages[page.id] || managedPosts.get(page.id);
  const { slug, warning } = resolveSlug({ page, props, existing, title });
  if (warning) log.warn(`「${title}」${warning}`);

  const file = `${slug}.md`;
  const filePath = path.join(POSTS_DIR, file);

  // 增量：内容没变且文件在，直接跳过
  const fileExists = await fs.stat(filePath).then(() => true).catch(() => false);
  const unchanged =
    !opts.force && fileExists && existing?.lastEditedTime && existing.lastEditedTime === page.last_edited_time;
  if (unchanged) {
    counters.skipped.push({ file, title });
    state.pages[page.id] = { ...(state.pages[page.id] || {}), ...existing, slug, file, lastEditedTime: page.last_edited_time };
    return;
  }

  /* ── 正文 ── */
  let body = await renderPageBody({ notion, pageId: page.id });

  /* ── 封面 ── */
  const coverRaw =
    readImageUrl(pick(props, PROPS.cover)) ||
    page.cover?.external?.url ||
    page.cover?.file?.url ||
    '';

  /* ── 图片本地化 ── */
  const urls = [...collectMarkdownImageUrls(body), coverRaw].filter(Boolean);
  const localized = await localizeUrls(urls, { slug, dryRun: opts.dryRun });
  if (localized.failed.length) {
    counters.warnings.push(`${file}：${localized.failed.length} 张图片未能落地（保留原链接，可能过期）`);
  }
  const cover = localized.map.get(coverRaw) || coverRaw;
  body = rewriteMarkdownImages(body, localized.map);
  if (localized.created || localized.reused) {
    log.debug(`图片：新下载 ${localized.created}，复用 ${localized.reused}`);
  }

  /* ── 正文收尾 ── */
  body = normalizeBody(body);
  const more = ensureMoreMarker(body);
  body = more.body;
  if (more.inserted) {
    log.warn(`「${title}」正文里没有 [more] 摘要截断标记，已自动插在第一段之后（可在 Notion 里加一行 [more] 指定位置）`);
  }

  /* ── 日期 ── */
  const dateProp = pick(props, PROPS.date);
  const daysDate = formatDate(readDate(dateProp));
  const date = daysDate || formatDate(page.created_time);
  if (!daysDate) {
    log.warn(`「${title}」未填「日期」属性，已用 Notion 页面创建时间 ${date}`);
  }
  if (existing?.date && existing.date !== date) {
    log.warn(`「${title}」日期发生变化（${existing.date} → ${date}），文章 URL 会随之改变！`);
  }

  const updated = formatDate(page.last_edited_time) || date;

  /* ── front-matter ── */
  const tags = readList(pick(props, PROPS.tags));
  const categories = readList(pick(props, PROPS.categories));
  const summary = readText(pick(props, PROPS.summary));

  // 封面文字层：三处全空 → 原图不加任何效果；任一填写 → 启用主题效果
  const coverTitle = readText(pick(props, PROPS.coverTitle));
  const coverSub = readText(pick(props, PROPS.coverSub));
  const coverDim = readCoverDim(pick(props, PROPS.coverDim), title);
  if (coverTitle && Array.from(coverTitle).length > COVER_TITLE_MAX) {
    log.warn(`「${title}」封面标题 ${Array.from(coverTitle).length} 字，超过建议上限 ${COVER_TITLE_MAX} 字（小尺寸卡片会被截断）`);
  }
  if (coverSub && Array.from(coverSub).length > COVER_SUB_MAX) {
    log.warn(`「${title}」封面副标题 ${Array.from(coverSub).length} 字，超过建议上限 ${COVER_SUB_MAX} 字（中档卡片超过 24 字会截断）`);
  }

  // 主题可选配置：留空不写入 front-matter
  const topImgRaw = readText(pick(props, PROPS.topImg));

  const fields = {
    title,
    date,
    updated,
    cover,
    top_group_index: readNumber(pick(props, PROPS.topIndex)),
    categories: categories.length === 1 ? categories[0] : categories,
    tags,
    ai: summary ? summary.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : undefined,
    covertitle: coverTitle || undefined,
    coverset: coverSub || undefined,
    coverdim: coverDim,
    aside: readOptionalBool(pick(props, PROPS.aside)),
    toc: readOptionalBool(pick(props, PROPS.toc)),
    comments: readOptionalBool(pick(props, PROPS.comments)),
    keywords: readText(pick(props, PROPS.keywords)) || undefined,
    top_img: topImgRaw ? (topImgRaw.toLowerCase() === 'false' ? false : topImgRaw) : undefined,
    [MANAGED_FIELD]: page.id,
  };

  const output = `${buildFrontMatter(fields)}\n\n${body}`;

  /* ── 写入 ── */
  const isNew = !fileExists;
  if (opts.dryRun) {
    log.info(`[dry-run] ${isNew ? '将新增' : '将更新'} ${file}（${title}）`);
  } else {
    await fs.mkdir(POSTS_DIR, { recursive: true });
    await fs.writeFile(filePath, output, 'utf8');

    // Slug 被改过：清掉旧文件，避免同一篇出现两个 URL
    if (existing?.file && existing.file !== file) {
      const oldPath = path.join(POSTS_DIR, existing.file);
      const stillManaged = await fs
        .readFile(oldPath, 'utf8')
        .then((raw) => raw.includes(page.id))
        .catch(() => false);
      if (stillManaged) {
        await fs.unlink(oldPath);
        log.warn(`Slug 变更，已删除旧文件 ${existing.file}`);
      }
    }

    if (opts.pruneAssets) {
      const referenced = Object.values(fields).filter((v) => typeof v === 'string' && v.includes('/img/'));
      const removed = await pruneOrphanAssets(slug, [...referenced, ...localized.map.values(), cover]);
      if (removed.length) log.info(`清理了 ${removed.length} 张未引用图片：${slug}/`);
    }
  }

  state.pages[page.id] = {
    slug,
    file,
    date,
    lastEditedTime: page.last_edited_time,
    assets: [...localized.map.values()].map((u) => u.split('/').pop()),
    syncedAt: new Date().toISOString(),
  };

  counters.changed.push({ file, title, isNew, images: localized.created });
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  setVerbose(opts.verbose);

  const { token, databaseId, missing } = readEnv();
  if (missing.length) {
    log.err(`缺少环境变量：${missing.join('、')}`);
    process.stdout.write(HELP);
    return 1;
  }

  const notion = createClient(token, { verbose: opts.verbose });

  log.info('连接 Notion …');
  const dataSource = await resolveDataSource(notion, databaseId);
  if (dataSource.resolved) {
    log.ok(`数据库就绪：${dataSource.name || '(未命名)'}（数据源 ${dataSource.id}）`);
    validateSchema(dataSource.properties);
  } else {
    // 读不到 schema 不一定是错（旧版 API 也走这条兜底），真正的权限问题会在查询时暴露
    log.debug('未能读取数据库结构，直接把该 ID 当数据源查询');
  }

  const pages = await queryAllPages(notion, dataSource.id);
  log.info(`拉取到 ${pages.length} 个页面`);

  const state = await loadState();
  const managedPosts = await scanManagedPosts();
  const adopted = adoptFromDisk(state, managedPosts);
  if (adopted) log.info(`从磁盘回填了 ${adopted} 条托管记录（state 缺失自愈）`);
  log.debug(`已托管文章 ${managedPosts.size} 篇`);
  if (!managedPosts.size) {
    log.info('当前没有任何脚本托管文章（首次同步会全部新建，手写文章不受影响）');
  }

  const counters = { changed: [], skipped: [], unpublished: [], warnings: [] };
  let list = pages;
  if (opts.only) {
    list = list.filter(
      (p) => p.id === opts.only || p.id.replace(/-/g, '') === opts.only.replace(/-/g, '') || p.id.endsWith(opts.only)
    );
    if (!list.length) {
      log.err(`--only 没匹配到任何页面：${opts.only}`);
      return 1;
    }
  }
  if (opts.limit > 0) list = list.slice(0, opts.limit);

  let failed = 0;
  for (const page of list) {
    const props = page.properties || {};
    try {
      await processPage({ page, props, state, managedPosts, notion, opts, counters });
    } catch (err) {
      failed += 1;
      const title = readText(pick(props, PROPS.title)) || page.id;
      log.err(`处理「${title}」失败：${explainError(err)}`);
    }
  }

  // 状态里存在、但这次没出现的页面（被删除 / 取消发布 / 归档）
  const seen = new Set(list.map((p) => p.id));
  const gones = Object.keys(state.pages).filter((id) => !seen.has(id));
  if (gones.length) {
    log.warn(`${gones.length} 篇此前同步过的文章本次未出现（已取消发布或删除），本地文件已保留、未自动删除：`);
    for (const id of gones) log.warn(`  ${state.pages[id].file}  ← ${state.pages[id].slug}`);
  }

  await saveState(state, { dryRun: opts.dryRun });

  /* ── 汇总 ── */
  process.stdout.write('\n');
  const rows = [['结果', '文章', '说明']];
  for (const c of counters.changed) {
    rows.push([c.isNew ? '新增' : '更新', c.file, c.images ? `含 ${c.images} 张新图片` : '']);
  }
  for (const s of counters.skipped) rows.push(['跳过', s.file, '内容未变']);
  for (const u of counters.unpublished) rows.push(['未发布', u.title, 'Notion「发布」未勾选']);
  log.table(rows);

  if (counters.warnings.length) {
    process.stdout.write('\n');
    for (const w of counters.warnings) log.warn(w);
  }

  process.stdout.write('\n');
  log.ok(
    `完成：新增/更新 ${counters.changed.length}，跳过 ${counters.skipped.length}，未发布 ${counters.unpublished.length}` +
      (failed ? `，失败 ${failed}` : '')
  );
  if (opts.dryRun) log.info('这是预览模式，没有写入任何文件。');

  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    log.err(explainError(err));
    if (process.env.DEBUG) console.error(err);
    process.exitCode = 1;
  });
