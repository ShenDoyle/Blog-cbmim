#!/usr/bin/env node
/**
 * tools/notion-settings.mjs — 主题设置：Notion ⇄ 站点配置
 *
 * 用法：
 *   npm run notion:settings -- --init      # 建库 + 导入全部可设置项（幂等，已存在的键跳过）
 *   npm run notion:settings -- --dry-run    # 只预览会应用哪些设置
 *   npm run notion:settings                 # 拉取 Notion → 生成 source/_data/site-settings.yml
 *
 * 设计要点：
 *   · 键清单**自动生成**：从主题默认配置（node_modules/hexo-theme-cbmim/_config.yml）
 *     拍平成 `a.b.c` 键路径，站点覆盖文件（_config.cbmim.yml）里的值作为「当前值」参考。
 *   · 「值」留空 = 不覆盖，沿用仓库里的值；只有「启用」勾选且「值」非空的行才会生效。
 *   · 产物是 source/_data/site-settings.yml，由 scripts/apply-site-settings.js 在构建期
 *     深度合并进 hexo.theme.config —— 不重写任何原始配置文件，git 里即审计轨迹。
 *   · 危险键（影响构建 / 加载链路的）标为「危险」，同样需要显式勾「启用」。
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { createClient, explainError, queryAllPages } from './notion/api.mjs';
import { SITE_ROOT, readEnv } from './notion/config.mjs';
import { log, setVerbose } from './notion/log.mjs';

const THEME_DEFAULT = path.join(SITE_ROOT, 'node_modules', 'hexo-theme-cbmim', '_config.yml');
const SITE_THEME_CFG = path.join(SITE_ROOT, '_config.cbmim.yml');
const SITE_CFG = path.join(SITE_ROOT, '_config.yml');
const OUT_FILE = path.join(SITE_ROOT, 'source', '_data', 'site-settings.yml');

const DB_TITLE = '⚙️ 站点设置';
const ROOT_PAGE_ID = (process.env.NOTION_ROOT_PAGE_ID || '3e77adb0-e2e0-8114-8917-e6673992874f').trim();

// 永不可改的键（站点基础配置，改坏会直接导致构建失败）
const BLOCK = ['theme', 'deploy', 'server', 'render', 'plugin', 'database', 'skip_render'];

// 危险：影响构建或加载链路，需要显式勾「启用」
const DANGER = ['cdn', 'lazyload', 'pjax', 'pangu', 'minify', 'instantpage', 'fancybox', 'preconnect', 'prefetch'];
// 谨慎：影响全站外观或行为
const CAUTION = ['cover', 'post', 'index', 'aside', 'toc', 'comments', 'footer', 'nav', 'menu',
  'darkmode', 'font', 'colors', 'error_img', 'top_img', 'douban', 'bilibili', 'reward', 'copy',
  'rightside', 'article', 'pagination', 'snackbar', 'notice', 'newest_comments'];

/* ────────────────────────── 参数 ────────────────────────── */

function parseArgs(argv) {
  const opts = { init: false, dryRun: false, verbose: false, force: false };
  for (const a of argv) {
    if (a === '--init') opts.init = true;
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--force') opts.force = true;
  }
  return opts;
}

/* ────────────────────── 键清单（拍平） ────────────────────── */

function flatten(node, prefix = [], out = []) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (!keys.length) { out.push({ key: prefix.join('.'), value: node }); return out; }
    for (const k of keys) flatten(node[k], prefix.concat(k), out);
    return out;
  }
  out.push({ key: prefix.join('.'), value: node });
  return out;
}

function typeOf(v) {
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return 'number';
  if (Array.isArray(v)) return 'array';
  if (v && typeof v === 'object') return 'map';
  return 'string';
}

function riskOf(key) {
  const top = key.split('.')[0];
  if (BLOCK.includes(top)) return '屏蔽';
  if (DANGER.includes(top)) return '危险';
  if (CAUTION.includes(top)) return '谨慎';
  return '安全';
}

function loadYaml(file) {
  try {
    return yaml.load(readFileSync(file, 'utf8')) || {};
  } catch {
    return {};
  }
}

/** 主题默认值（键 → 值），排除被屏蔽的键 */
function themeKeys() {
  const def = loadYaml(THEME_DEFAULT);
  const site = loadYaml(SITE_THEME_CFG);
  const rows = [];
  for (const { key, value } of flatten(def)) {
    if (!key) continue;
    const risk = riskOf(key);
    if (risk === '屏蔽') continue;
    rows.push({ key, type: typeOf(value), group: key.split('.')[0], def: value, cur: pick(site, key), risk });
  }
  return rows;
}

function pick(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function show(v) {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/* ────────────────────── Notion 读写 ────────────────────── */

async function findDb(notion) {
  // v5 API：数据库在搜索里是 data_source 对象（filter.value 只能用 page / data_source）
  const res = await notion.search({
    query: DB_TITLE,
    filter: { property: 'object', value: 'data_source' },
    page_size: 20,
  });
  const hit = (res.results || []).find((r) => {
    const t = (r.title || []).map((x) => x.plain_text).join('');
    return t.includes('站点设置');
  });
  if (!hit) return null;
  return { dsId: hit.id, dbId: hit.parent?.database_id || hit.id, raw: hit };
}

const SCHEMA_PROPS = {
  值: { rich_text: {} },
  类型: { select: { options: ['bool', 'number', 'string', 'array', 'map'].map((n) => ({ name: n })) } },
  分组: { rich_text: {} },
  当前值: { rich_text: {} },
  说明: { rich_text: {} },
  风险: { select: { options: ['安全', '谨慎', '危险'].map((n) => ({ name: n })) } },
  启用: { checkbox: {} },
};

async function createDb(notion) {
  // v5（API 2025-09-03）用 initial_data_source.properties；旧版用 properties
  const base = {
    parent: { type: 'page_id', page_id: ROOT_PAGE_ID },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    description: [{ type: 'text', text: { content: '主题设置：值留空 = 不覆盖；勾「启用」且值非空才生效（下次构建生效）' } }],
  };
  const properties = Object.assign({ 键: { title: {} } }, SCHEMA_PROPS);
  try {
    return await notion.databases.create(Object.assign({ initial_data_source: { properties } }, base));
  } catch (err) {
    log.debug('initial_data_source 建库失败，回退旧格式：' + (err?.message || err));
    return notion.databases.create(Object.assign({ properties }, base));
  }
}

/** 幂等补全属性：数据库已存在但没有我们要的列时（或历史版本建歪了）补齐 */
async function ensureSchema(notion, dsId, dbId, ds) {
  const props = ds?.properties || {};
  let titleName = Object.keys(props).find((k) => props[k].type === 'title') || 'Name';
  const missing = Object.keys(SCHEMA_PROPS).filter((k) => !props[k]);

  // 默认建库只有一个标题列（叫 Name），顺手改名成「键」
  if (titleName !== '键') {
    try {
      await notion.dataSources.update({ data_source_id: dsId, properties: { [titleName]: { name: '键' } } });
      log.info(`标题列「${titleName}」已改名为「键」`);
      titleName = '键';
    } catch (err) {
      log.debug('标题列改名失败，沿用原名：' + (err?.message || err));
    }
  }

  if (!missing.length) return titleName;

  const patch = {};
  for (const k of missing) patch[k] = SCHEMA_PROPS[k];
  log.info(`数据库缺少 ${missing.length} 列，正在补：${missing.join(' / ')}`);

  try {
    await notion.dataSources.update({ data_source_id: dsId, properties: patch });
  } catch (err) {
    log.debug('dataSources.update 失败，回退 databases.update：' + (err?.message || err));
    await notion.databases.update({ database_id: dbId, properties: patch });
  }
  return titleName;
}

/** 取数据源 schema（拿标题列名用） */
async function dsSchema(notion, dsId) {
  try {
    return await notion.dataSources.retrieve({ data_source_id: dsId });
  } catch (err) {
    log.debug('读取数据源 schema 失败：' + (err?.message || err));
    return null;
  }
}

function dataSourceIdOf(db) {
  const refs = Array.isArray(db.data_sources) ? db.data_sources : [];
  return refs.length ? refs[0].id : db.id;
}

function rowProps(row, titleName) {
  const p = {};
  p[titleName] = { title: [{ text: { content: String(row.key).slice(0, 2000) } }] };
  p['类型'] = { select: { name: row.type } };
  p['分组'] = { rich_text: [{ text: { content: row.group.slice(0, 2000) } }] };
  p['风险'] = { select: { name: row.risk } };
  p['启用'] = { checkbox: false };
  const cur = row.cur !== undefined ? show(row.cur) : show(row.def);
  if (show(row.def)) p['说明'] = { rich_text: [{ text: { content: ('默认值：' + show(row.def)).slice(0, 1900) } }] };
  if (cur) p['当前值'] = { rich_text: [{ text: { content: cur.slice(0, 1900) } }] };
  return p;
}

async function createRow(notion, dsId, dbId, props) {
  try {
    return await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsId },
      properties: props,
    });
  } catch (err) {
    if (err?.code === 'validation_error' || err?.status === 400) {
      return notion.pages.create({ parent: { database_id: dbId }, properties: props });
    }
    throw err;
  }
}

function textOf(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return (prop.title || []).map((x) => x.plain_text).join('');
  if (prop.type === 'rich_text') return (prop.rich_text || []).map((x) => x.plain_text).join('');
  return '';
}

/* ────────────────────── 主流程 ────────────────────── */

async function runInit(notion, opts) {
  const rows = themeKeys();
  log.info(`主题可设置项：${rows.length} 个（已排除 ${BLOCK.join(' / ')}）`);

  let found = await findDb(notion);
  if (!found) {
    if (opts.dryRun) { log.info('[dry-run] 将创建数据库「' + DB_TITLE + '」并导入 ' + rows.length + ' 行'); return; }
    const created = await createDb(notion);
    log.ok(`已创建数据库「${DB_TITLE}」`);
    const dsId = dataSourceIdOf(created);
    found = { dsId, dbId: created.id, raw: await dsSchema(notion, dsId) };
  } else {
    log.info(`复用已有数据库「${DB_TITLE}」`);
  }
  const { dsId, dbId } = found;
  const titleName = await ensureSchema(notion, dsId, dbId, found.raw);

  const existing = new Set(
    (await queryAllPages(notion, dsId)).map((p) => textOf(p.properties[titleName]))
  );
  const todo = rows.filter((r) => !existing.has(r.key));
  log.info(`已有 ${existing.size} 行，本次新增 ${todo.length} 行`);

  if (opts.dryRun || !todo.length) return;

  // 串行创建一行要 3~6 秒（Notion 写入较慢），几百个键太耗时 → 并发 4 路
  const CONCURRENCY = 4;
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const row = todo[idx];
      idx += 1;
      await createRow(notion, dsId, dbId, rowProps(row, titleName));
      done += 1;
      if (done % 25 === 0) log.info(`  已导入 ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.ok(`导入完成：${done} 行`);
}

async function runSync(notion, opts) {
  const found = await findDb(notion);
  if (!found) throw new Error(`未找到数据库「${DB_TITLE}」，请先跑一次 npm run notion:settings -- --init`);
  const dsId = found.dsId;
  const ds = found.raw || await dsSchema(notion, dsId);
  const titleName = Object.keys(ds?.properties || {}).find((k) => ds.properties[k].type === 'title') || '键';

  const pages = await queryAllPages(notion, dsId);
  log.info(`设置行：${pages.length}`);

  const defaults = loadYaml(THEME_DEFAULT);
  const current = loadYaml(SITE_THEME_CFG);
  const out = {};
  const applied = [];
  const problems = [];

  for (const page of pages) {
    const key = textOf(page.properties[titleName]).trim();
    if (!key) continue;
    const on = page.properties['启用']?.checkbox === true;
    const raw = textOf(page.properties['值']).trim();
    if (!on || !raw) continue;

    const risk = riskOf(key);
    if (risk === '屏蔽') { problems.push(`${key}：该键被硬屏蔽，已忽略`); continue; }

    const type = page.properties['类型']?.select?.name || 'string';
    let val;
    try {
      val = parseValue(raw, type);
    } catch (e) {
      problems.push(`${key}：值解析失败（${e.message}），已跳过`);
      continue;
    }
    setPath(out, key, val);
    applied.push({ key, value: val, was: pick(current, key) !== undefined ? pick(current, key) : pick(defaults, key) });
  }

  if (problems.length) for (const p of problems) log.warn(p);

  if (!applied.length) {
    log.info('没有任何生效的设置（值留空或未勾启用）');
    if (!opts.dryRun) {
      await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
      await fs.writeFile(OUT_FILE, '# 由 tools/notion-settings.mjs 自动生成，请勿手改\n{}\n');
    }
    return;
  }

  log.table([['键', '原值', 'Notion 值'], ...applied.map((a) => [a.key, show(a.was).slice(0, 40), show(a.value).slice(0, 40)])]);

  if (opts.dryRun) { log.info('[dry-run] 未写文件'); return; }

  const header = '# 由 tools/notion-settings.mjs 自动生成：来自 Notion「' + DB_TITLE + '」\n'
    + '# 生效方式：scripts/apply-site-settings.js 在构建期深度合并进 hexo.theme.config\n';
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, header + yaml.dump(out, { lineWidth: 120 }));
  log.ok(`已写出 ${path.relative(SITE_ROOT, OUT_FILE)}（${applied.length} 项）`);
}

function parseValue(raw, type) {
  switch (type) {
    case 'bool': {
      if (/^(true|1|yes|y|是|开|on)$/i.test(raw)) return true;
      if (/^(false|0|no|n|否|关|off)$/i.test(raw)) return false;
      throw new Error('布尔值只接受 true/false/是/否');
    }
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error('不是数字');
      return n;
    }
    case 'array':
    case 'map': {
      const v = yaml.load(raw);
      if (type === 'array' && !Array.isArray(v)) throw new Error('不是数组（用 YAML 或 JSON 写）');
      if (type === 'map' && (typeof v !== 'object' || Array.isArray(v) || v === null)) throw new Error('不是映射（用 YAML 写）');
      return v;
    }
    default:
      return raw;
  }
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  setVerbose(opts.verbose);

  const { token, missing } = readEnv();
  if (missing.length) {
    log.err(`缺少环境变量：${missing.join(', ')}（写在站点根目录 .env 里）`);
    process.exit(1);
  }

  const notion = createClient(token, { verbose: opts.verbose });
  try {
    if (opts.init) await runInit(notion, opts);
    else await runSync(notion, opts);
  } catch (err) {
    log.err(explainError(err));
    process.exit(1);
  }
}

main();
