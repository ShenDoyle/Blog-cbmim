#!/usr/bin/env node
/**
 * tools/notion-link-existing.mjs — 把已有文章「交给 Notion 托管」
 *
 * 首次导入后，用 tools/_import/page-ids.json 里的 slug → Notion 页面 ID 映射，
 * 给每篇 source/_posts/<slug>.md 的 front-matter 补一行 notion_page_id。
 *
 * 加了这个字段之后，notion-sync.mjs 才会把该文件当成「Notion 托管文章」，
 * 后续在 Notion 侧的修改才会同步回本地。
 *
 * 只动 front-matter 里的一行，不改字段顺序、不碰正文、不动 BOM。
 *
 * 用法：
 *   node tools/notion-link-existing.mjs --dry-run   # 只看会改什么
 *   node tools/notion-link-existing.mjs             # 实际写入
 */

import fs from 'node:fs';
import path from 'node:path';

import { SITE_ROOT, POSTS_DIR } from './notion/config.mjs';

const MAP_FILE = path.join(SITE_ROOT, 'tools', '_import', 'page-ids.json');
const FIELD = 'notion_page_id';

function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(MAP_FILE)) {
    console.error(`找不到映射文件：${MAP_FILE}`);
    process.exit(1);
  }
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  const pages = map.pages || {};

  let linked = 0;
  let updated = 0;
  let skipped = 0;
  const missing = [];

  for (const [slug, pageId] of Object.entries(pages)) {
    const file = path.join(POSTS_DIR, `${slug}.md`);
    if (!fs.existsSync(file)) {
      missing.push(slug);
      continue;
    }

    const raw = fs.readFileSync(file, 'utf8');
    const hasBom = raw.charCodeAt(0) === 0xfeff;
    const text = hasBom ? raw.slice(1) : raw;

    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) {
      console.log(`✗ ${slug}  没有 front-matter，跳过`);
      skipped += 1;
      continue;
    }

    const fm = m[1];
    const existing = fm.match(new RegExp(`^${FIELD}:\\s*(.+)$`, 'm'));

    let nextFm;
    let action;
    if (existing) {
      const current = existing[1].trim();
      if (current === pageId) {
        skipped += 1;
        console.log(`= ${slug}  已是最新`);
        continue;
      }
      nextFm = fm.replace(new RegExp(`^${FIELD}:.*$`, 'm'), `${FIELD}: ${pageId}`);
      action = `更新 ${FIELD}: ${current} → ${pageId}`;
      updated += 1;
    } else {
      nextFm = `${fm}\n${FIELD}: ${pageId}`;
      action = `新增 ${FIELD}: ${pageId}`;
      linked += 1;
    }

    if (dryRun) {
      console.log(`· ${slug}  ${action}`);
      continue;
    }

    const out = text.replace(m[0], `---\n${nextFm}\n---`);
    fs.writeFileSync(file, (hasBom ? '\ufeff' : '') + out, 'utf8');
    console.log(`✓ ${slug}  ${action}`);
  }

  console.log(
    `\n共 ${Object.keys(pages).length} 篇：新增 ${linked}，更新 ${updated}，跳过 ${skipped}${dryRun ? '（dry-run，未写盘）' : ''}`,
  );
  if (missing.length) console.log(`映射里有但磁盘上没有的文章：${missing.join(', ')}`);
}

main();
