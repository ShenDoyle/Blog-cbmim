#!/usr/bin/env node
/**
 * tools/notion-settings.mjs — 主题设置：Notion ⇄ 站点配置
 *
 * 用法：
 *   npm run notion:settings -- --init           # 建库 + 导入全部可设置项（幂等，已存在的键跳过）
 *   npm run notion:settings -- --refresh        # 刷新说明 / 优先级 / 当前值并同步库说明（不动「值」）
 *   npm run notion:settings -- --dry-run        # 只预览会应用哪些设置
 *   npm run notion:settings                      # 拉取 Notion → 生成 source/_data/site-settings.yml
 *   npm run notion:settings -- --selftest       # 离线自检，不访问 Notion
 *
 * 设计要点：
 *   · Notion「值」列是站点主题配置的唯一覆盖来源；_config.yml 只保留 Hexo 核心配置。
 *   · 键清单从主题默认配置拍平成 `a.b.c`，并自动纳入 Notion 里的扩展键。
 *   · 「值」留空 = 使用主题默认值；「启用」列仅保留兼容旧界面，不再参与取值。
 *   · false / 0 / null / [] / {} 保持精确类型；空字符串写成 ""，null 写成 null。
 *   · 没有任何生效项时默认报错，必须显式 --allow-empty 才会生成空覆盖，避免静默回退。
 *   · 正常同步要求 .notion-settings-only 存在，并拒绝任何 _config.cbmim.yml* 变体。
 *   · 「优先级」= 分组分层（GROUP_TIERS，越常改的越靠前）+ 组内 enable 优先、其余按路径排序，
 *     拍平成连续序号。Notion 视图按它升序排，常用的功能自然在最上面。
 *   · 「说明」三层拼装：人工词条（KEY_DESC）→ 分组说明 + 末级键语义 → 主题 _config.yml 注释。
 *   · 产物是 source/_data/site-settings.yml，由 scripts/apply-site-settings.js 在构建期
 *     深度合并进 hexo.theme.config —— 不重写任何原始配置文件，git 里即审计轨迹。
 *   · 危险键（影响构建 / 加载链路的）标为「危险」，同样按「值」生效。
 */

import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';

import { createClient, explainError, queryAllPages } from './notion/api.mjs';
import { SITE_ROOT, readEnv } from './notion/config.mjs';
import { log, setVerbose } from './notion/log.mjs';
import { ENABLE_FIRST, GROUP_DESC, GROUP_TIERS, KEY_DESC, LEAF_DESC, LEAF_ORDER } from './notion/settings-dict.mjs';

const THEME_DEFAULT = path.join(SITE_ROOT, 'node_modules', 'hexo-theme-cbmim', '_config.yml');
const OUT_FILE = path.join(SITE_ROOT, 'source', '_data', 'site-settings.yml');
const SETTINGS_ONLY_MARKER = path.join(SITE_ROOT, '.notion-settings-only');
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SENSITIVE_SEGMENTS = new Set(['appkey', 'app_key', 'masterkey', 'master_key', 'secret', 'token', 'password', 'privatekey', 'private_key', 'accesskey', 'access_key']);
const SENSITIVE_PLACEHOLDERS = new Set(['', 'xxxxx', 'changeme', 'your-app-key', 'your-master-key']);

const DB_TITLE = '⚙️ 站点设置';
const SETTINGS_DATA_SOURCE_ID = (process.env.NOTION_SETTINGS_DATA_SOURCE_ID || '').trim();
const ROOT_PAGE_ID = (process.env.NOTION_ROOT_PAGE_ID || '3e77adb0-e2e0-8114-8917-e6673992874f').trim();

// 永不可改的键（站点基础配置，改坏会直接导致构建失败）
const BLOCK = ['theme', 'deploy', 'server', 'render', 'plugin', 'database', 'skip_render'];

// 危险：影响构建或加载链路，仍需谨慎填写「值」
const DANGER = ['cdn', 'lazyload', 'pjax', 'pangu', 'minify', 'instantpage', 'fancybox', 'preconnect', 'prefetch'];
// 谨慎：影响全站外观或行为
const CAUTION = ['cover', 'post', 'index', 'aside', 'toc', 'comments', 'footer', 'nav', 'menu',
  'darkmode', 'font', 'colors', 'error_img', 'top_img', 'douban', 'bilibili', 'reward', 'copy',
  'rightside', 'article', 'pagination', 'snackbar', 'notice', 'newest_comments'];

/* ────────────────────────── 参数 ────────────────────────── */

function parseArgs(argv) {
  const opts = { init: false, refresh: false, dryRun: false, verbose: false, allowEmpty: false };
  for (const a of argv) {
    if (a === '--init') opts.init = true;
    else if (a === '--refresh') opts.refresh = true;
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--allow-empty') opts.allowEmpty = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (opts.init && opts.refresh) throw new Error('--init / --refresh 必须单独使用');
  return opts;
}

/* ────────────────────── 键清单（拍平） ────────────────────── */

function flatten(node, prefix = [], out = []) {
  if (isPlainObject(node)) {
    const keys = Object.keys(node);
    if (!keys.length) { out.push({ key: prefix.join('.'), value: node }); return out; }
    for (const k of keys) flatten(node[k], prefix.concat(k), out);
    return out;
  }
  out.push({ key: prefix.join('.'), value: node });
  return out;
}

function typeOf(v) {
  if (v === null) return 'null';
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

function loadYaml(file, { optional = false } = {}) {
  try {
    const data = yaml.load(readFileSync(file, 'utf8'));
    if (data == null) return {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('YAML 顶层必须是映射');
    return data;
  } catch (err) {
    if (optional && err?.code === 'ENOENT') return {};
    const location = Number.isFinite(err?.mark?.line) ? `（第 ${err.mark.line + 1} 行附近）` : '';
    throw new Error(`读取 YAML 失败：${file}${location}（${err?.reason || '语法错误'}）`);
  }
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && Object.keys(value).length && isPlainObject(target[key])) deepMerge(target[key], value);
    else target[key] = value;
  }
  return target;
}

function assertSafeKey(key) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('配置键不能为空');
  const parts = key.split('.');
  if (parts.some((part) => !part || UNSAFE_SEGMENTS.has(part))) {
    throw new Error(`配置键包含空段或危险段：${key}`);
  }
  return key;
}

/** 主题默认键 + Notion 扩展键；current 只来自 Notion 的显式「值」。 */
function themeKeys(current = {}) {
  const def = loadYaml(THEME_DEFAULT);
  const comments = parseThemeComments();
  const rows = new Map();

  for (const { key, value } of flatten(def)) {
    if (!key) continue;
    const risk = riskOf(key);
    if (risk === '屏蔽') continue;
    const cur = pick(current, key);
    rows.set(key, {
      key,
      type: typeOf(cur !== undefined ? cur : value),
      group: key.split('.')[0],
      def: value,
      cur,
      risk,
      state: activeState(cur, value),
    });
  }

  // menu / social / CDN.option / giscus.option 等扩展键未必存在于主题默认 schema。
  for (const { key, value } of flatten(current)) {
    if (!key || rows.has(key)) continue;
    const risk = riskOf(key);
    if (risk === '屏蔽') continue;
    rows.set(key, {
      key,
      type: typeOf(value),
      group: key.split('.')[0],
      def: undefined,
      cur: value,
      risk,
      state: activeState(value, undefined),
    });
  }

  const list = [...rows.values()];
  list.sort(priorityCompare);
  list.forEach((r, i) => {
    r.prio = (i + 1) * 10;          // 连续序号，留出间隔便于以后插队
    r.desc = describeRow(r, comments);
  });

  // 分组覆盖自检：新增主题配置时若能漏掉，日志里能立刻看到
  const missing = [...new Set(list.map((r) => r.group))].filter((g) => tierOf(g).tier === 99);
  if (missing.length) log.warn(`以下分组未在 GROUP_TIERS 里排序，已排到最后：${missing.join(', ')}`);
  return list;
}

function pick(obj, dotted) {
  let cur = obj;
  for (const part of assertSafeKey(dotted).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function show(v) {
  if (v === undefined) return '';
  if (typeof v === 'string') return v === '' ? '""' : v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** 写入 Notion「值」列的可逆文本编码；空字符串必须写成 ""，不能与“留空”混淆。 */
function serializeValue(v) {
  if (v === undefined) return '';
  if (v === null) return 'null';
  if (typeof v === 'string') return v === '' ? '""' : v;
  return JSON.stringify(v);
}

/* ────────────────── 说明 / 优先级 / 状态 ────────────────── */

/**
 * 解析主题 _config.yml 的注释：键 → { inline, block }
 * 主题注释里常写着可选值（例如 highlight_theme 的 "darker / pale night / ..."），
 * 是「功能说明」里价值最高的一块，优先取行内注释，其次取紧邻上方的注释块。
 */
function parseThemeComments() {
  const out = new Map();
  let txt = '';
  try { txt = readFileSync(THEME_DEFAULT, 'utf8'); } catch { return out; }

  const stack = [];
  let pending = [];
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) { pending = []; continue; }
    const indent = (raw.match(/^(\s*)/) || ['', ''])[1].length;
    const t = raw.trim();

    if (t.startsWith('#')) {
      const line = t.replace(/^#+\s?/, '').trim();
      if (line && !/^[-=*_]{3,}$/.test(line)) pending.push(line); // 丢掉装饰性分隔线
      continue;
    }

    const m = t.match(/^([^:#][^:]*):(.*)$/);
    if (!m) { pending = []; continue; }

    const key = m[1].trim();
    const rest = m[2].trim();
    const im = rest.match(/^(.*?)\s+#\s*(.*)$/);
    const val = im ? im[1].trim() : rest;
    const inline = im ? im[2].trim() : '';

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key });

    if (val !== '') {
      out.set(stack.map((s) => s.key).join('.'), { inline, block: pending.slice(-3) });
    }
    pending = [];
  }
  return out;
}

/** 空值判定：用来区分「被显式关掉」和「被改成别的值」 */
function isEmptyish(v) {
  if (v === false || v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** 该功能在当前博客是否已经开着：站点值 ≠ 主题默认值，且新值不是「空 / false」 */
function activeState(cur, def) {
  if (cur === undefined) return 'default';
  if (isDeepStrictEqual(cur, def)) return 'default';
  return isEmptyish(cur) ? 'off' : 'active';
}

const STATE_TAG = { active: '【已启用】', off: '【已关闭】', default: '【主题默认】' };

/** 说明 = 状态标记 + 人工词条（或组装式）+ 主题注释 + 主题默认值 */
function describeRow(row, comments) {
  const leaf = row.key.split('.').pop();
  let base = KEY_DESC[row.key];
  const curated = Boolean(base);

  if (!base) {
    const g = GROUP_DESC[row.group];
    const l = LEAF_DESC[leaf];
    if (g && l) base = `${g} —— ${l}`;
    else if (g) base = `${g}（本项：${leaf}）`;
    else if (l) base = `${leaf}：${l}`;
    else base = `主题配置项 ${row.key}`;
  }

  // 只有没写人工词条的键才追加主题注释，避免两段话说同一件事
  let text = base;
  if (!curated) {
    const c = comments.get(row.key);
    const hint = (c && c.inline) || (c && c.block.length ? c.block[c.block.length - 1] : '');
    if (hint && !text.includes(hint.slice(0, Math.min(10, hint.length)))) text += `。${hint}`;
  }

  let out = STATE_TAG[row.state] + text;
  if (row.state !== 'default') {
    const d = show(row.def);
    // 默认值是 null / 空 时说「主题默认：null」是噪声，直接省掉
    if (d && d !== 'null' && d !== '[]' && d !== '""' && d.length <= 40) out += `｜主题默认：${d}`;
  }
  return out.slice(0, 1900);
}

/** 分组优先级：GROUP_TIERS 里越靠前越优先；没列到的分组统一排到最后 */
function tierOf(group) {
  for (let t = 0; t < GROUP_TIERS.length; t += 1) {
    const idx = GROUP_TIERS[t].indexOf(group);
    if (idx > -1) return { tier: t, idx };
  }
  return { tier: 99, idx: 999 };
}

function parentOf(key) {
  const parts = key.split('.');
  parts.pop();
  return parts.join('.');
}

function leafRank(key) {
  const i = LEAF_ORDER.indexOf(key.split('.').pop());
  return i > -1 ? i : LEAF_ORDER.length;
}

/**
 * 组内排序（保证「同一根下的子项聚在一起、总开关在最前」）：
 *   ① 本组的总开关（X.enable）永远第一
 *   ② 然后按父路径分块（aside.card_author.* 这种自然成块）
 *   ③ 块内按 LEAF_ORDER 偏好（enable → img → ...），最后按字母序
 */
function priorityCompare(a, b) {
  const ta = tierOf(a.group);
  const tb = tierOf(b.group);
  if (ta.tier !== tb.tier) return ta.tier - tb.tier;
  if (ta.idx !== tb.idx) return ta.idx - tb.idx;

  const masterA = a.key === `${a.group}.${ENABLE_FIRST}` ? 0 : 1;
  const masterB = b.key === `${b.group}.${ENABLE_FIRST}` ? 0 : 1;
  if (masterA !== masterB) return masterA - masterB;

  const pa = parentOf(a.key);
  const pb = parentOf(b.key);
  if (pa !== pb) return pa < pb ? -1 : 1;

  const la = leafRank(a.key);
  const lb = leafRank(b.key);
  if (la !== lb) return la - lb;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/* ────────────────────── Notion 读写 ────────────────────── */

async function findDb(notion) {
  const titleOf = (r) => (r.title || []).map((x) => x.plain_text).join('');
  if (SETTINGS_DATA_SOURCE_ID) {
    const hit = await notion.dataSources.retrieve({ data_source_id: SETTINGS_DATA_SOURCE_ID });
    if (titleOf(hit) !== DB_TITLE) throw new Error('NOTION_SETTINGS_DATA_SOURCE_ID 指向的数据库标题不是「' + DB_TITLE + '」，已停止');
    return { dsId: hit.id, dbId: hit.parent?.database_id || hit.id, raw: hit };
  }

  // v5 API：数据库在搜索里是 data_source 对象（filter.value 只能用 page / data_source）
  const res = await notion.search({
    query: DB_TITLE,
    filter: { property: 'object', value: 'data_source' },
    page_size: 20,
  });
  const hits = (res.results || []).filter((r) => titleOf(r) === DB_TITLE);
  if (hits.length > 1) throw new Error('找到多个同名「' + DB_TITLE + '」数据库；请设置 NOTION_SETTINGS_DATA_SOURCE_ID 精确指定');
  if (!hits.length) return null;
  const hit = hits[0];
  return { dsId: hit.id, dbId: hit.parent?.database_id || hit.id, raw: hit };
}

const SCHEMA_PROPS = {
  优先级: { number: {} },
  值: { rich_text: {} },
  类型: { select: { options: ['bool', 'number', 'string', 'null', 'array', 'map'].map((n) => ({ name: n })) } },
  分组: { rich_text: {} },
  当前值: { rich_text: {} },
  说明: { rich_text: {} },
  风险: { select: { options: ['安全', '谨慎', '危险'].map((n) => ({ name: n })) } },
  启用: { checkbox: {} },
};

const DB_DESC = '主题设置唯一值来源：在「值」里填新值即生效（下次构建）；留空则使用主题默认值。'
  + '「启用」列仅保留兼容旧界面，不再参与取值。false / 0 / null / [] / {} 会保留精确类型；空字符串请写成 ""。'
  + '「当前值」仅为自动生成的展示缓存，请勿手改，也不会反向覆盖配置。'
  + '「优先级」控制显示顺序（常用功能在最上面），「说明」「当前值」「优先级」为自动生成。';

async function createDb(notion) {
  // v5（API 2025-09-03）用 initial_data_source.properties；旧版用 properties
  const base = {
    parent: { type: 'page_id', page_id: ROOT_PAGE_ID },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    description: [{ type: 'text', text: { content: DB_DESC } }],
  };
  const properties = Object.assign({ 键: { title: {} } }, SCHEMA_PROPS);
  try {
    return await notion.databases.create(Object.assign({ initial_data_source: { properties } }, base));
  } catch (err) {
    log.debug('initial_data_source 建库失败，回退旧格式：' + (err?.message || err));
    return notion.databases.create(Object.assign({ properties }, base));
  }
}

/** 已有库也同步最新使用说明；写后读回校验，避免只更新“建库时”的描述。 */
async function ensureDbDescription(notion, dbId) {
  const description = [{ type: 'text', text: { content: DB_DESC } }];
  const updated = await notion.databases.update({ database_id: dbId, description });
  let actual = (updated.description || []).map((x) => x.plain_text || x.text?.content || '').join('');
  if (actual !== DB_DESC) {
    const current = await notion.databases.retrieve({ database_id: dbId });
    actual = (current.description || []).map((x) => x.plain_text || x.text?.content || '').join('');
  }
  if (actual !== DB_DESC) throw new Error('Notion 数据库描述写入后读回不一致，已停止刷新');
  log.ok('已同步「⚙️ 站点设置」数据库使用说明');
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

  const patch = {};
  for (const k of missing) patch[k] = SCHEMA_PROPS[k];

  // 历史库的「类型 / 风险」下拉选项可能缺 null 等新类型；合并补全，不覆盖已有选项。
  for (const [name, schema] of Object.entries(SCHEMA_PROPS)) {
    if (!schema.select || !props[name] || props[name].type !== 'select') continue;
    const existing = props[name].select?.options || [];
    const names = new Set(existing.map((option) => option.name));
    const add = schema.select.options.filter((option) => !names.has(option.name));
    if (add.length) patch[name] = { select: { options: [...existing, ...add] } };
  }

  if (!missing.length && !Object.keys(patch).length) return titleName;
  if (missing.length) log.info(`数据库缺少 ${missing.length} 列，正在补：${missing.join(' / ')}`);
  if (!missing.length) log.info(`数据库下拉选项需要补全：${Object.keys(patch).join(' / ')}`);

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

function richText(content) {
  const text = String(content ?? '');
  if (text.length > 1900) throw new Error(`Notion 文本超过 1900 字符，拒绝截断写入（长度 ${text.length}）`);
  return text ? [{ text: { content: text } }] : [];
}

function rowProps(row, titleName, opts = {}) {
  const p = {};
  p[titleName] = { title: [{ text: { content: String(row.key).slice(0, 2000) } }] };
  p['类型'] = { select: { name: row.type } };
  p['分组'] = { rich_text: richText(row.group) };
  p['风险'] = { select: { name: row.risk } };
  p['优先级'] = { number: row.prio };
  p['说明'] = { rich_text: richText(row.desc) };
  // 「启用」已废弃，仅自动反映「值」是否存在，不再作为输入开关。
  p['启用'] = { checkbox: row.cur !== undefined };
  const cur = show(row.cur !== undefined ? row.cur : row.def);
  p['当前值'] = { rich_text: richText(cur) };
  if (opts.includeValue) {
    const value = serializeValue(row.cur !== undefined ? row.cur : row.def);
    p['值'] = { rich_text: richText(value) };
  }
  return p;
}

async function notionWrite(label, fn) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const status = Number(err?.status || 0);
      const retryable = err?.code === 'rate_limited' || [429, 500, 502, 503, 504].includes(status);
      if (!retryable || attempt === 5) throw err;
      const retryAfter = Number(err?.headers?.['retry-after'] || err?.headers?.['Retry-After'] || 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(10000, 500 * (2 ** attempt));
      log.warn(`${label} 遇到 Notion 临时限流/错误，${Math.ceil(waitMs / 1000)} 秒后重试（${attempt + 1}/5）`);
      await delay(waitMs);
    }
  }
}

async function createRow(notion, dsId, dbId, props) {
  try {
    return await notionWrite('创建设置行', () => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsId },
      properties: props,
    }));
  } catch (err) {
    if (err?.code === 'validation_error' || err?.status === 400) {
      return notionWrite('创建设置行（旧 API 兼容）', () => notion.pages.create({ parent: { database_id: dbId }, properties: props }));
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
  let found = await findDb(notion);
  if (!found) {
    if (opts.dryRun) { log.info('[dry-run] 将创建数据库「' + DB_TITLE + '」并导入主题默认值'); return; }
    const created = await createDb(notion);
    log.ok(`已创建数据库「${DB_TITLE}」`);
    const dsId = dataSourceIdOf(created);
    found = { dsId, dbId: created.id, raw: await dsSchema(notion, dsId) };
  } else {
    log.info(`复用已有数据库「${DB_TITLE}」`);
  }
  const { dsId, dbId } = found;
  const ds = found.raw || await dsSchema(notion, dsId);
  let titleName = Object.keys(ds?.properties || {}).find((k) => ds.properties[k].type === 'title') || '键';
  if (opts.dryRun) validateSettingsSchema(ds, titleName);
  else {
    titleName = await ensureSchema(notion, dsId, dbId, ds);
    await ensureDbDescription(notion, dbId);
  }
  const pages = await queryAllPages(notion, dsId);
  const defaults = loadYaml(THEME_DEFAULT);
  const built = buildSettings(pages, titleName, defaults);
  if (built.problems.length) throw new Error(built.problems.join('\n'));
  const rows = themeKeys(built.out);
  log.info(`主题可设置项：${rows.length} 个（已排除 ${BLOCK.join(' / ')}）`);

  const existing = new Set(pages.map((p) => textOf(p.properties[titleName]).trim()));
  const todo = rows.filter((r) => !existing.has(r.key));
  log.info(`已有 ${existing.size} 行，本次新增 ${todo.length} 行`);

  if (opts.dryRun || !todo.length) return;

  // 新行直接写入主题默认值，逐步形成完整快照；已有行绝不覆盖。
  const CONCURRENCY = 4;
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const row = todo[idx];
      idx += 1;
      await createRow(notion, dsId, dbId, rowProps(row, titleName, { includeValue: true }));
      done += 1;
      if (done % 25 === 0) log.info(`  已导入 ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.ok(`导入完成：${done} 行`);
}

/**
 * 刷新已有行：先读 Notion「值」，再重写说明 / 优先级 / 当前值 / 类型 / 分组 / 风险。
 * 「启用」只反映显式值是否存在；「值」列永远不被刷新逻辑改写。
 */
async function runRefresh(notion, opts) {
  const found = await findDb(notion);
  if (!found) throw new Error(`未找到数据库「${DB_TITLE}」，请先跑一次 npm run notion:settings -- --init`);
  const { dsId, dbId } = found;
  const ds = found.raw || await dsSchema(notion, dsId);
  let titleName = Object.keys(ds?.properties || {}).find((k) => ds.properties[k].type === 'title') || '键';

  if (!opts.dryRun) {
    titleName = await ensureSchema(notion, dsId, dbId, ds);
    await ensureDbDescription(notion, dbId);
  } else {
    validateSettingsSchema(ds, titleName);
  }

  const pages = await queryAllPages(notion, dsId);
  const defaults = loadYaml(THEME_DEFAULT);
  const built = buildSettings(pages, titleName, defaults);
  if (built.problems.length) throw new Error(built.problems.join('\n'));
  const rows = themeKeys(built.out);
  const stats = rows.reduce((m, r) => { m[r.state] = (m[r.state] || 0) + 1; return m; }, {});
  log.info(`主题可设置项：${rows.length} 个｜显式值 ${stats.active + stats.off}、主题默认 ${stats.default || 0}`);

  const byKey = new Map(rows.map((r) => [r.key, r]));
  const jobs = [];
  const unknown = [];

  for (const page of pages) {
    const key = textOf(page.properties[titleName]).trim();
    const row = byKey.get(key);
    if (!row) { unknown.push(key || '(空)'); continue; }
    jobs.push({ id: page.id, props: rowProps(row, titleName) });
  }

  log.info(`库里 ${pages.length} 行｜本次刷新 ${jobs.length} 行｜未纳入清单 ${unknown.length} 个（跳过）`);
  if (unknown.length && opts.verbose) log.info(`  跳过：${unknown.slice(0, 20).join(', ')}`);

  const preview = rows.slice(0, opts.verbose ? 40 : 15);
  log.info('优先级前几项：');
  for (const r of preview) {
    const flag = { active: '●', off: '○', default: '·' }[r.state];
    log.info(`  ${String(r.prio).padStart(4)} ${flag} ${r.key.padEnd(34)} ${r.desc.slice(0, 60)}`);
  }

  if (opts.dryRun) { log.info('[dry-run] 未写入'); return; }
  if (!jobs.length) return;

  const CONCURRENCY = 5;
  let idx = 0;
  let done = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      const job = jobs[idx];
      idx += 1;
      await notionWrite('刷新设置行', () => notion.pages.update({ page_id: job.id, properties: job.props }));
      done += 1;
      if (done % 25 === 0) log.info(`  已刷新 ${done}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log.ok(`刷新完成：${done} 行（「值」列未被触碰）`);
}

function validateSettingsSchema(ds, titleName) {
  const props = ds?.properties || {};
  if (!props[titleName] || props[titleName].type !== 'title') {
    throw new Error('站点设置库缺少可识别的标题列，无法读取配置键');
  }
  if (!props['值'] || props['值'].type !== 'rich_text') {
    throw new Error('站点设置库缺少「值」列，或该列不是文本类型；已停止同步，避免误写空设置');
  }
  for (const [name, type] of [['启用', 'checkbox'], ['当前值', 'rich_text'], ['类型', 'select']]) {
    if (props[name] && props[name].type !== type) log.warn(`「${name}」列类型异常（应为 ${type}），相关兼容逻辑可能不可用`);
  }
}

/** 把 Notion 行解析成覆盖配置；只有非空「值」参与取值，「启用 / 当前值」均不参与。 */
function buildSettings(pages, titleName, defaults = {}) {
  const out = {};
  const applied = [];
  const problems = [];
  const seen = new Set();
  const stats = { rows: pages.length, explicit: 0, enabled: 0, blank: 0, duplicates: 0 };

  for (const page of pages) {
    const key = textOf(page.properties[titleName]).trim();
    if (!key) continue;
    try {
      assertSafeKey(key);
    } catch (e) {
      problems.push(`${key || '(空键)'}：${e.message}`);
      continue;
    }

    const raw = textOf(page.properties['值']);
    const enabled = page.properties['启用']?.checkbox === true;
    if (enabled) stats.enabled += 1;
    if (!raw.trim()) { stats.blank += 1; continue; }

    const risk = riskOf(key);
    if (risk === '屏蔽') { problems.push(`${key}：该键被硬屏蔽，已忽略`); continue; }

    if (seen.has(key)) {
      stats.duplicates += 1;
      problems.push(`${key}：Notion 中存在重复键，已拒绝整份设置以避免歧义`);
      continue;
    }
    seen.add(key);

    const defaultValue = pick(defaults, key);
    const fallbackType = defaultValue === undefined ? 'string' : typeOf(defaultValue);
    const type = page.properties['类型']?.select?.name || fallbackType;
    let val;
    try {
      val = parseValue(raw, type);
      assertSafeValue(val, key);
    } catch (e) {
      problems.push(`${key}：「值」解析失败（${e.message}），已跳过`);
      continue;
    }
    setPath(out, key, val);
    stats.explicit += 1;
    applied.push({ key, value: val, source: '值', type, was: defaultValue });
  }

  return { out, applied, problems, stats };
}

function assertSafeValue(value, path = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) {
    if (value !== null && typeof value === 'object') throw new Error(`${path || '值'} 含不支持的对象类型`);
    const leaf = (path.split('.').pop() || '').replace(/\[\d+\]$/, '').toLowerCase();
    if (SENSITIVE_SEGMENTS.has(leaf)) {
      const placeholder = value === null || (typeof value === 'string' && SENSITIVE_PLACEHOLDERS.has(value.trim().toLowerCase()));
      if (!placeholder) throw new Error(`${path} 含敏感值，禁止写入公开仓库；请改用 GitHub Secrets / 环境变量注入`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!key || UNSAFE_SEGMENTS.has(key)) throw new Error(`${path || '值'} 含危险字段：${key}`);
    assertSafeValue(child, path ? `${path}.${key}` : key);
  }
}

async function writeSettingsFile(out, { allowEmpty = false, file = OUT_FILE } = {}) {
  if (!Object.keys(out).length && !allowEmpty) throw new Error('Notion 没有任何显式设置；已停止写入空配置');
  assertSafeValue(out, 'settings');
  const header = '# 由 tools/notion-settings.mjs 自动生成：来自 Notion「' + DB_TITLE + '」\n'
    + '# 生效方式：scripts/apply-site-settings.js 在构建期深度合并进 hexo.theme.config\n'
    + (allowEmpty ? '# allow-empty: true\n' : '');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, header + yaml.dump(out, { lineWidth: 120 }));
}

async function runSync(notion, opts) {
  await requireNotionSettingsOnly();
  const found = await findDb(notion);
  if (!found) throw new Error(`未找到数据库「${DB_TITLE}」，请先跑一次 npm run notion:settings -- --init`);
  const dsId = found.dsId;
  const ds = found.raw || await dsSchema(notion, dsId);
  const titleName = Object.keys(ds?.properties || {}).find((k) => ds.properties[k].type === 'title') || '键';
  validateSettingsSchema(ds, titleName);

  const pages = await queryAllPages(notion, dsId);
  const defaults = loadYaml(THEME_DEFAULT);
  const { out, applied, problems, stats } = buildSettings(pages, titleName, defaults);
  log.info(`设置行：${stats.rows}｜「值」已填 ${stats.explicit}｜留空 ${stats.blank}｜重复键 ${stats.duplicates}`);

  if (problems.length) throw new Error(problems.join('\n'));
  if (!applied.length && !opts.allowEmpty) {
    throw new Error('Notion「值」列没有任何生效项；已停止同步，避免静默丢失全站设置。确认要用主题默认值请显式加 --allow-empty');
  }

  // 不打印配置内容，设置库里将来可能放 token / App Key 等敏感值。
  log.table([['键', '来源', '类型'], ...applied.map((a) => [a.key, a.source, a.type])]);

  if (opts.dryRun) { log.info('[dry-run] 未写文件'); return; }
  await writeSettingsFile(out, { allowEmpty: opts.allowEmpty });
  log.ok(`已写出 ${path.relative(SITE_ROOT, OUT_FILE)}（${applied.length} 项）`);
}

function parseValue(raw, type) {
  const text = raw.trim();
  switch (type) {
    case 'bool': {
      if (/^(true|1|yes|y|是|开|on)$/i.test(text)) return true;
      if (/^(false|0|no|n|否|关|off)$/i.test(text)) return false;
      throw new Error('布尔值只接受 true/false/是/否');
    }
    case 'number': {
      const n = Number(text);
      if (!text || !Number.isFinite(n)) throw new Error('不是有限数字');
      return n;
    }
    case 'null':
      if (/^(null|~)$/i.test(text)) return null;
      throw new Error('null 类型只接受 null 或 ~');
    case 'array':
    case 'map': {
      let v;
      try { v = yaml.load(raw); } catch { throw new Error('YAML/JSON 语法错误'); }
      if (type === 'array' && !Array.isArray(v)) throw new Error('不是数组（用 YAML 或 JSON 写）');
      if (type === 'map' && !isPlainObject(v)) throw new Error('不是映射（用 YAML 写）');
      return v;
    }
    case 'string':
      return raw === '""' ? '' : raw;
    default:
      throw new Error(`未知类型：${type}`);
  }
}

function setPath(obj, dotted, value) {
  const parts = assertSafeKey(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/* ───────────────── 单一配置来源守卫 ───────────────── */

async function requireNotionSettingsOnly() {
  try {
    await fs.access(SETTINGS_ONLY_MARKER);
  } catch {
    throw new Error('缺少 .notion-settings-only；Notion 单一配置模式拒绝回退到旧配置');
  }
  const variants = (await fs.readdir(SITE_ROOT)).filter((name) => name.startsWith('_config.cbmim.yml'));
  if (variants.length) {
    throw new Error(`检测到旧配置变体：${variants.join(', ')}；Notion 单一配置模式禁止加载`);
  }
}

async function runSettingsSelfTest() {
  const rich = (content = '') => ({ type: 'rich_text', rich_text: content ? [{ plain_text: content }] : [] });
  const page = (key, { value = '', current = '', enabled = false, type = 'string' } = {}) => ({
    properties: {
      键: { type: 'title', title: [{ plain_text: key }] },
      值: rich(value),
      当前值: rich(current),
      启用: { type: 'checkbox', checkbox: enabled },
      类型: { type: 'select', select: { name: type } },
    },
  });
  const defaults = {
    avatar: { effect: true, size: 8 },
    comments: { use: 'Waline', lazyload: false },
    empty: { list: [], map: {}, nil: null },
    footer: { custom_text: 'default' },
  };
  const pages = [
    page('avatar.effect', { value: 'false', current: 'true', enabled: false, type: 'bool' }),
    page('avatar.size', { value: '0', enabled: false, type: 'number' }),
    page('empty.list', { value: '[]', enabled: true, type: 'array' }),
    page('empty.map', { value: '{}', enabled: true, type: 'map' }),
    page('empty.nil', { value: 'null', enabled: true, type: 'null' }),
    page('comments.use', { value: 'Giscus', current: 'Waline', enabled: false }),
    page('comments.lazyload', { current: 'true', enabled: true, type: 'bool' }),
    page('footer.custom_text', { value: '""', enabled: false, type: 'string' }),
    page('social.Twitter', { value: 'https://example.com', enabled: false, type: 'string' }),
  ];
  const result = buildSettings(pages, '键', defaults);
  assert.equal(result.out.avatar.effect, false, 'false 即使未勾启用也必须生效');
  assert.equal(result.out.avatar.size, 0);
  assert.deepEqual(result.out.empty.list, []);
  assert.deepEqual(result.out.empty.map, {});
  assert.equal(result.out.empty.nil, null);
  assert.equal(result.out.comments.use, 'Giscus');
  assert.equal('lazyload' in result.out.comments, false, '留空必须回退主题默认，不能读当前值');
  assert.equal(result.out.footer.custom_text, '', '编码空字符串必须与留空区分');
  assert.equal(result.out.social.Twitter, 'https://example.com', '扩展键必须允许');
  assert.equal(result.stats.explicit, 8);
  assert.equal(result.stats.blank, 1);
  assert.equal(result.problems.length, 0);

  const inferredNull = buildSettings([page('empty.nil', { value: 'null', type: 'string' })], '键', defaults);
  assert.equal(inferredNull.out.empty.nil, 'null', '显式 string 类型优先于默认类型推断');

  const invalid = buildSettings([
    page('comments.lazyload', { value: 'maybe', type: 'bool' }),
    page('deploy.type', { value: 'git', enabled: true }),
  ], '键', defaults);
  assert.equal(invalid.applied.length, 0);
  assert.equal(invalid.problems.length, 2);
  assert.match(invalid.problems[0], /解析失败/);
  assert.match(invalid.problems[1], /硬屏蔽/);

  const duplicate = buildSettings([
    page('comments.use', { value: 'Giscus' }),
    page('comments.use', { value: 'Waline' }),
  ], '键', defaults);
  assert.equal(duplicate.stats.duplicates, 1);
  assert.match(duplicate.problems[0], /重复键/);

  const unsafe = buildSettings([page('__proto__.polluted', { value: 'yes' })], '键', defaults);
  assert.equal(unsafe.applied.length, 0);
  assert.match(unsafe.problems[0], /危险段/);
  assert.equal({}.polluted, undefined);
  assert.throws(() => assertSafeValue({ waline: { appKey: 'real-secret' } }, 'settings'), /敏感值/);
  assert.doesNotThrow(() => assertSafeValue({ valine: { appKey: 'xxxxx' } }, 'settings'));

  assert.equal(serializeValue(false), 'false');
  assert.equal(serializeValue(0), '0');
  assert.equal(serializeValue(null), 'null');
  assert.equal(serializeValue([]), '[]');
  assert.equal(serializeValue({}), '{}');
  assert.equal(serializeValue(''), '""');
  assert.equal(parseValue('  keep spaces  ', 'string'), '  keep spaces  ');
  assert.throws(() => parseValue('maybe', 'bool'), /布尔值/);
  assert.throws(() => parseValue('Infinity', 'number'), /有限数字/);
  assert.throws(() => parseValue('{}', 'array'), /不是数组/);

  const merged = deepMerge({ empty: { map: { old: true } } }, { empty: { map: {} } });
  assert.deepEqual(merged.empty.map, {}, '显式空映射必须清空默认映射');
  const first = buildSettings(pages, '键', defaults);
  const second = buildSettings(pages, '键', defaults);
  assert.deepEqual(first.out, second.out, '同一输入重复同步必须幂等');

  assert.throws(() => validateSettingsSchema({ properties: { 键: { type: 'title' } } }, '键'), /缺少「值」列/);
  assert.throws(() => richText('x'.repeat(1901)), /拒绝截断/);
  assert.throws(() => parseArgs(['--migrate-file']), /未知参数/);

  let descriptionWrites = 0;
  await ensureDbDescription({
    databases: {
      update: async ({ description }) => {
        descriptionWrites += 1;
        return { description: description.map((item) => ({ plain_text: item.text.content })) };
      },
      retrieve: async () => { throw new Error('mock retrieve should not be needed'); },
    },
  }, 'mock-db');
  assert.equal(descriptionWrites, 1);

  log.ok('Notion 设置离线自检通过（单一值来源、精确类型、空字符串、扩展键、安全与幂等）');
}

async function main() {
  if (process.argv.includes('--selftest')) {
    try {
      await runSettingsSelfTest();
    } catch (err) {
      log.err('Notion 设置离线自检失败：' + err.stack);
      process.exit(1);
    }
    return;
  }

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
    else if (opts.refresh) await runRefresh(notion, opts);
    else await runSync(notion, opts);
  } catch (err) {
    log.err(explainError(err));
    process.exit(1);
  }
}

main();
