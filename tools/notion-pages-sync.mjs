#!/usr/bin/env node
/**
 * tools/notion-pages-sync.mjs — Notion「📄 页面」库 → Hexo 独立页面 同步
 *
 * 「📄 页面」库字段：
 *   页面名称（标题）  页面标题
 *   路径（文本）      相对站点根的 md 路径，如 source/cc/index.md
 *   说明（文本）      仅备注用，不参与同步
 *   发布（勾选）      勾上才同步；取消勾选只提示、不删本地文件
 *
 * 安全约定（与 notion-sync.mjs 一致）：
 *   - 只写「路径」指向的 md 的**正文**；文件已有 front-matter 则原样保留
 *     （type / aside / top_img / comments 这些页面级配置仍由本地 front-matter 决定）
 *   - 路径必须落在 source/ 下且以 .md 结尾，其余一律拒绝
 *   - 手写文件一旦被同步过，状态里记了 pageId 才算托管；state 缺失时回读文件自愈
 *   - 增量：last_edited_time 没变且文件存在 → 跳过
 *
 * 用法：
 *   node tools/notion-pages-sync.mjs [--dry-run] [--force] [--only <页面ID|关键词>] [--verbose]
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { createClient, explainError, queryAllPages, resolveDataSource } from './notion/api.mjs';
import { PAGES_DATA_SOURCE_ID, PAGES_STATE_FILE, SITE_ROOT, readEnv } from './notion/config.mjs';
import { pick, readCheckbox, readText } from './notion/convert.mjs';
import { log, setVerbose } from './notion/log.mjs';
import { renderPageBody } from './notion/render.mjs';

/* ────────────────────────── 参数 ────────────────────────── */

function parseArgs(argv) {
  const opts = { force: false, dryRun: false, only: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') opts.force = true;
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--only') opts.only = String(argv[++i] || '').trim();
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

const HELP = `
Notion「📄 页面」库 → Hexo 独立页面 同步

环境变量：
  NOTION_TOKEN           Notion Integration 令牌（必填）
  NOTION_PAGES_DB_ID     页面库数据源 ID（可选，缺省用内置的 CBMIM 页面库）

可选参数：
  --dry-run        只打印将要做什么，不写文件、不写状态
  --force          忽略增量，全部重新生成
  --only <值>      只处理页面 ID 或名称包含该关键词的页面
  --verbose        打印细节
`;

/* ────────────────────────── 状态 ────────────────────────── */

const EMPTY = { version: 1, pages: {} };

async function loadPageState() {
  try {
    const raw = await fs.readFile(PAGES_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return { version: parsed.version || 1, pages: parsed.pages || {} };
  } catch {
    return { ...EMPTY };
  }
}

async function savePageState(state, { dryRun = false } = {}) {
  if (dryRun) return;
  const sorted = {};
  for (const key of Object.keys(state.pages).sort()) sorted[key] = state.pages[key];
  await fs.writeFile(
    PAGES_STATE_FILE,
    `${JSON.stringify({ version: state.version || 1, pages: sorted }, null, 2)}\n`,
    'utf8'
  );
}

/* ────────────────────────── 文件处理 ────────────────────────── */

/** 校验「路径」：必须相对站点根、落在 source/ 内、是 .md / .yml / .json 文件 */
function safeTargetPath(rawPath) {
  const rel = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!rel) return null;
  if (!/\.(md|ya?ml|json)$/i.test(rel)) return null;
  const abs = path.resolve(SITE_ROOT, rel);
  const srcRoot = path.resolve(SITE_ROOT, 'source');
  if (!abs.startsWith(srcRoot + path.sep)) return null;
  return { rel, abs, isMarkdown: /\.md$/i.test(rel) };
}

/** 拆出已有文件的 front-matter（--- 块）与正文；无 front-matter 时返回 null 头 */
function splitFrontMatter(raw) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(raw);
  if (!m) return { head: '', body: raw };
  return { head: m[0].replace(/\r?\n$/, '\n'), body: raw.slice(m[0].length) };
}

/**
 * 数据文件（.yml / .json）约定：Notion 页面正文就是一个代码块，全文逐字存在块里。
 * 这里提取第一个围栏代码块的内容；有多个或没有时给出告警。
 */
function extractCodeBlock(markdown) {
  const m = /^\s*```[^\n]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(String(markdown || '').trim());
  if (!m) return null;
  return m[1].replace(/\r\n/g, '\n') + '\n';
}

/* ────────────────────────── 主流程 ────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  setVerbose(opts.verbose);

  const { token, missing } = readEnv();
  if (missing.length) {
    log.err(`缺少环境变量：${missing.join('、')}`);
    process.stdout.write(HELP);
    return 1;
  }

  const notion = createClient(token, { verbose: opts.verbose });

  log.info('连接 Notion（📄 页面库）…');
  const dataSource = await resolveDataSource(notion, PAGES_DATA_SOURCE_ID);
  if (dataSource.resolved) {
    log.ok(`页面库就绪：${dataSource.name || '(未命名)'}（数据源 ${dataSource.id}）`);
  } else {
    log.debug('未能读取页面库结构，直接把该 ID 当数据源查询');
  }

  const rows = await queryAllPages(notion, dataSource.id);
  log.info(`拉取到 ${rows.length} 个页面记录`);

  const state = await loadPageState();
  const counters = { changed: [], skipped: [], unpublished: [] };

  let list = rows;
  if (opts.only) {
    list = list.filter((p) => {
      const props = p.properties || {};
      const name = readText(pick(props, ['页面名称', 'Name', '标题']));
      return p.id === opts.only || name.includes(opts.only);
    });
    if (!list.length) {
      log.err(`--only 没匹配到任何页面：${opts.only}`);
      return 1;
    }
  }

  for (const row of list) {
    const props = row.properties || {};
    const name = readText(pick(props, ['页面名称', 'Name', '标题'])) || '(无标题)';
    const published = readCheckbox(pick(props, ['发布', 'Published']), false);

    if (!published) {
      counters.unpublished.push({ name, id: row.id });
      continue;
    }

    const rawPath = readText(pick(props, ['路径', 'Path']));
    const target = safeTargetPath(rawPath);
    if (!target) {
      log.warn(`「${name}」的「路径」不是 source/ 下的 .md 文件（当前值：${rawPath || '空'}），已跳过`);
      continue;
    }

    // 增量
    const existing = state.pages[row.id];
    let fileExists = true;
    try {
      await fs.access(target.abs);
    } catch {
      fileExists = false;
    }
    const unchanged = !opts.force && fileExists && existing?.lastEditedTime === row.last_edited_time;
    if (unchanged) {
      counters.skipped.push({ name, path: target.rel });
      state.pages[row.id] = { ...(existing || {}), id: row.id, name, path: target.rel, file: target.rel, lastEditedTime: row.last_edited_time };
      continue;
    }

    // 渲染正文（页面不做 [more] 摘要处理）
    const rendered = (await renderPageBody({ notion, pageId: row.id })).replace(/\n*$/, '\n');

    let output;
    if (target.isMarkdown) {
      // md：保留已有 front-matter；没有 front-matter 的文件（如 about）只写正文
      let head = '';
      if (fileExists) {
        const raw = await fs.readFile(target.abs, 'utf8');
        head = splitFrontMatter(raw).head;
      } else {
        head = `---\ntitle: ${name}\n---\n`;
        log.warn(`「${name}」目标文件不存在，已生成最小 front-matter（title），页面级配置请手动补`);
      }
      output = `${head}\n${rendered}`;
    } else {
      // 数据文件（.yml / .json）：Notion 页面里放一个代码块，全文逐字写回
      const data = extractCodeBlock(rendered);
      if (data === null) {
        log.err(`「${name}」的数据文件页面里没有找到代码块（需要整页就是一个代码块），已跳过 ${target.rel}`);
        continue;
      }
      output = data;
    }

    if (opts.dryRun) {
      log.info(`[dry-run] 将更新 ${target.rel}（${name}，${output.length} 字符）`);
    } else {
      await fs.mkdir(path.dirname(target.abs), { recursive: true });
      await fs.writeFile(target.abs, output, 'utf8');
      log.ok(`已更新 ${target.rel}（${name}）`);
    }

    state.pages[row.id] = {
      id: row.id,
      name,
      path: target.rel,
      file: target.rel,
      lastEditedTime: row.last_edited_time,
      syncedAt: new Date().toISOString(),
    };
    counters.changed.push({ name, path: target.rel });
  }

  await savePageState(state, { dryRun: opts.dryRun });

  process.stdout.write('\n');
  const rowsOut = [['结果', '页面', '位置']];
  for (const c of counters.changed) rowsOut.push(['更新', c.name, c.path]);
  for (const s of counters.skipped) rowsOut.push(['跳过', s.name, s.path]);
  for (const u of counters.unpublished) rowsOut.push(['未发布', u.name, '「发布」未勾选']);
  log.table(rowsOut);

  log.ok(`页面同步完成：更新 ${counters.changed.length}，跳过 ${counters.skipped.length}，未发布 ${counters.unpublished.length}`);
  if (opts.dryRun) log.info('这是预览模式，没有写入任何文件。');
  return 0;
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
