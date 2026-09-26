/**
 * tools/notion/state.mjs — 增量同步状态
 *
 * .notion-sync-state.json 记录每个 Notion 页面 → 本地文件的映射与 last_edited_time，
 * 未改动的页面整体跳过（不重新下载图片、不产生无意义的 git diff）。
 * 该文件需要提交进仓库，GitHub Actions 才能跨次运行保持增量。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { POSTS_DIR, STATE_FILE } from './config.mjs';

const EMPTY = { version: 1, pages: {} };

export async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY };
    return { version: parsed.version || 1, pages: parsed.pages || {} };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveState(state, { dryRun = false } = {}) {
  if (dryRun) return;
  const sorted = {};
  for (const key of Object.keys(state.pages).sort()) sorted[key] = state.pages[key];
  const payload = { version: state.version || 1, pages: sorted };
  await fs.writeFile(STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * 扫描 source/_posts，找出带 notion_page_id 的「脚本托管」文件。
 * 用途：手写文章绝不被碰；同时给没写 Slug 的页面提供历史文件名（保证 URL 不变）。
 */
export async function scanManagedPosts() {
  const found = new Map(); // pageId -> { file, slug, title }
  const files = await fs.readdir(POSTS_DIR).catch(() => []);

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const full = path.join(POSTS_DIR, file);
    let head;
    try {
      const raw = await fs.readFile(full, 'utf8');
      head = raw.replace(/^\ufeff/, '').slice(0, 2000); // 历史文件可能带 BOM
    } catch {
      continue;
    }
    const block = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!block) continue;
    const idMatch = block[1].match(/^\s*notion_page_id:\s*["']?([^\s"']+)["']?\s*$/m);
    if (!idMatch) continue;
    const titleMatch = block[1].match(/^\s*title:\s*["']?(.*?)["']?\s*$/m);
    found.set(idMatch[1], {
      file,
      slug: file.replace(/\.md$/, ''),
      title: titleMatch ? titleMatch[1] : '',
    });
  }
  return found;
}

/** 用已有 md 文件名回填 state（首次运行 / state 丢失时的自愈） */
export function adoptFromDisk(state, managedPosts) {
  let adopted = 0;
  for (const [pageId, info] of managedPosts) {
    if (state.pages[pageId]) continue;
    state.pages[pageId] = {
      slug: info.slug,
      file: info.file,
      lastEditedTime: '',
      adoptedFrom: 'disk',
    };
    adopted += 1;
  }
  return adopted;
}
