/**
 * tools/notion/api.mjs — Notion API 访问层
 *
 * 兼容 @notionhq/client v5（新 API：databases 拆出 data sources）与旧版：
 *   v5  → dataSources.query({ data_source_id })
 *   旧  → databases.query({ database_id })
 * 自动探测，无需改配置。
 */

import { Client } from '@notionhq/client';

import { log } from './log.mjs';

export function createClient(token, { verbose = false } = {}) {
  return new Client({
    auth: token,
    // SDK 默认会往 stdout 打自己的警告，跟我们的日志混在一起；
    // 统一收编：只在 --verbose 时透出。
    logLevel: verbose ? 'debug' : 'error',
    logger: (level, message, extraInfo) => {
      const detail = extraInfo && Object.keys(extraInfo).length ? ` ${JSON.stringify(extraInfo)}` : '';
      log.debug(`Notion SDK[${level}] ${message}${detail}`);
    },
  });
}

/**
 * 传入「数据库 ID」或「数据源 ID」，统一解析成可用于查询的数据源 ID。
 * 同时返回属性 schema（便于按类型做校验提示）。
 */
export async function resolveDataSource(notion, databaseId) {
  // 1) 先按数据库解析，v5 的响应里带 data_sources
  try {
    const db = await notion.databases.retrieve({ database_id: databaseId });
    const refs = Array.isArray(db.data_sources) ? db.data_sources : [];
    if (refs.length) {
      const name = refs[0].name || '';
      log.debug(`数据库解析成功：${refs.length} 个数据源，使用「${name || refs[0].id}」`);
      return { id: refs[0].id, databaseId, properties: db.properties || {}, resolved: true, name };
    }
  } catch (err) {
    log.debug(`按数据库 ID 解析失败（可能本身就是数据源 ID）：${err.message}`);
  }

  // 2) 再按数据源解析
  try {
    const ds = await notion.dataSources?.retrieve?.({ data_source_id: databaseId });
    if (ds) {
      return {
        id: ds.id,
        databaseId,
        properties: ds.properties || {},
        resolved: true,
        name: (ds.title || []).map((t) => t.plain_text).join(''),
      };
    }
  } catch (err) {
    log.debug(`按数据源 ID 解析失败：${err.message}`);
  }

  // 3) 兜底：原样当数据源用。schema 读不到，字段校验会跳过。
  return { id: databaseId, databaseId, properties: {}, resolved: false, name: '' };
}

/** 分页拉全量（默认排除回收站 / 归档） */
export async function queryAllPages(notion, dataSourceId) {
  const pages = [];
  let cursor;
  let round = 0;

  const useDataSources = typeof notion.dataSources?.query === 'function';
  log.debug(useDataSources ? '使用 dataSources.query（client v5 新接口）' : '使用 databases.query（旧接口）');

  do {
    round += 1;
    const base = { start_cursor: cursor, page_size: 100 };
    const res = useDataSources
      ? await notion.dataSources.query({ data_source_id: dataSourceId, result_type: 'page', in_trash: false, ...base })
      : await notion.databases.query({ database_id: dataSourceId, ...base });

    for (const item of res.results || []) {
      // 只要真正的页面（wiki 里可能混入 data_source 对象）
      if (item.object === 'page' && item.properties) pages.push(item);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
    log.debug(`第 ${round} 轮：累计 ${pages.length} 页，has_more=${Boolean(res.has_more)}`);
  } while (cursor);

  return pages;
}

/** 把 Notion 的错误翻译成人话 */
export function explainError(err) {
  const code = err?.code || '';
  const msg = err?.message || String(err);
  if (code === 'unauthorized' || code === 'restricted_resource') {
    return `${msg}\n  → 检查 NOTION_TOKEN；并确认该页面/数据库已「添加连接」到你的 Integration。`;
  }
  if (code === 'object_not_found') {
    return `${msg}\n  → 检查 NOTION_DATABASE_ID；并确认 Integration 已被授权访问该数据库（数据库右上角 ··· → 连接）。`;
  }
  if (code === 'validation_error') {
    return `${msg}\n  → 多为字段类型不匹配，检查数据库属性名与类型。`;
  }
  if (code === 'rate_limited') {
    return `${msg}\n  → 触发限流（3 次/秒），稍后重试。`;
  }
  return msg;
}
