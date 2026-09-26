#!/usr/bin/env node
/**
 * tools/notion-import-data-files.mjs — 把 source/_data 的数据文件导入 Notion「📄 页面」库
 *
 * 每个文件在页面库里建一行：
 *   页面名称 = 中文标题，路径 = source/_data/xxx.yml，说明 = 用途，发布 = 勾选
 *   正文 = 一个 yaml 代码块，全文逐字保存
 * 已存在同「路径」的行会跳过（可重复执行，幂等）。
 * 顺带归档页面库里「标题和路径都是空」的空行（常为误建的空记录）。
 *
 * 数据文件纳管约定：页面正文必须是一个代码块，同步时逐字写回文件；
 * bangumis.json 由 hexo-bilibili-bangumi 插件生成，不纳入管理。
 *
 * 用法：node tools/notion-import-data-files.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { createClient, explainError, queryAllPages, resolveDataSource } from './notion/api.mjs';
import { PAGES_DATA_SOURCE_ID, SITE_ROOT, readEnv } from './notion/config.mjs';
import { log } from './notion/log.mjs';

/** 要纳管的数据文件（bangumis.json 插件自动生成，不纳管） */
const DATA_FILES = [
  { title: '友链数据', file: 'source/_data/link.yml', desc: '友链页 /link/ 的分组与链接列表' },
  { title: '好物数据', file: 'source/_data/equipment.yml', desc: '好物页 /equipment/ 的装备列表' },
  { title: '关于页数据', file: 'source/_data/about.yml', desc: '关于页 /about/ 的卡片信息（技能/项目/数据等）' },
  { title: '装备页数据', file: 'source/_data/artegories.yml', desc: '装备页顶部横幅文案与背景图' },
  { title: '创造力数据', file: 'source/_data/creativity.yml', desc: '关于页「开启创造力」图标列表' },
];

const RICH_TEXT_CHUNK = 1800; // Notion 单个 rich_text 上限 2000 字符，留余量

function readEnvToken() {
  const { token, missing } = readEnv();
  if (missing.length) {
    log.err(`缺少环境变量：${missing.join('、')}`);
    process.exit(1);
  }
  return token;
}

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 富文本分段（代码块全文可能超过单段 2000 字符上限） */
function chunkedRichText(text) {
  const segments = [];
  for (let i = 0; i < text.length; i += RICH_TEXT_CHUNK) {
    segments.push({ type: 'text', text: { content: text.slice(i, i + RICH_TEXT_CHUNK) } });
  }
  return segments;
}

async function main() {
  const notion = createClient(readEnvToken(), {});

  log.info('连接 Notion（📄 页面库）…');
  const ds = await resolveDataSource(notion, PAGES_DATA_SOURCE_ID);
  const rows = await queryAllPages(notion, ds.id);
  log.info(`页面库现有 ${rows.length} 条记录`);

  const pathOf = (row) => {
    const p = row.properties?.['路径'];
    return p ? (p.rich_text || []).map((t) => t.plain_text).join('').trim() : '';
  };
  const titleOf = (row) => {
    const p = row.properties?.['页面名称'];
    return p ? (p.title || []).map((t) => t.plain_text).join('').trim() : '';
  };

  // 归档空行（标题与路径都为空）
  for (const row of rows) {
    if (!titleOf(row) && !pathOf(row)) {
      await notion.pages.update({ page_id: row.id, archived: true });
      log.warn(`已归档空记录 ${row.id}`);
    }
  }

  const knownPaths = new Set(rows.map(pathOf).filter(Boolean));

  for (const item of DATA_FILES) {
    if (knownPaths.has(item.file)) {
      log.debug(`已存在，跳过：${item.file}`);
      continue;
    }

    const raw = stripBom(await fs.readFile(path.join(SITE_ROOT, item.file), 'utf8'));
    await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: ds.id },
      properties: {
        页面名称: { title: [{ text: { content: item.title } }] },
        路径: { rich_text: [{ text: { content: item.file } }] },
        说明: { rich_text: [{ text: { content: item.desc } }] },
        发布: { checkbox: true },
      },
      children: [
        {
          type: 'code',
          code: {
            rich_text: chunkedRichText(raw),
            language: 'yaml',
          },
        },
      ],
    });
    log.ok(`已导入：${item.title} ← ${item.file}（${raw.length} 字符）`);
  }

  log.ok('数据文件导入完成。之后改这些文件：直接在 Notion「📄 页面」库对应页面的代码块里改，同步后写回站点。');
}

main().catch((err) => {
  log.err(explainError(err));
  if (process.env.DEBUG) console.error(err);
  process.exitCode = 1;
});
