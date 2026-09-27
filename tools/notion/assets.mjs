/**
 * tools/notion/assets.mjs — 图片本地化
 *
 * 为什么必须做：Notion 的图片是带签名的临时链接（约 1 小时过期），
 * 直接引用会在文章上线一段时间后 404。所以同步时一律下载落地。
 *
 * 落盘规则（与站点现有 25 篇文章一致）：
 *   source/img/cbmim/<slug>/notion-<hash>.<ext>
 *   引用 https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/<slug>/notion-<hash>.<ext>
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CDN_IMG_BASE, IMG_NAMESPACE, IMG_ROOT, NOTION_IMAGE_HOSTS, SITE_ROOT } from './config.mjs';
import { log } from './log.mjs';

const EXT_BY_TYPE = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
};

const MD_IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)((?:\s+"[^"]*")?)\)/g;

/** 会被扫描的内容文件类型（图片本身不在其中） */
const TEXT_EXT = /\.(md|markdown|yml|yaml|json|txt|pug|html|styl|css|js|mjs|cjs)$/i;

/**
 * 图片文件名：只取最后一段路径（先排除路径分隔符与各种分隔标点）。
 * 注意不能用 \w —— 它只认 ASCII，中文文件名的图会全部匹配不到而误判成孤儿。
 */
const IMG_FILE_RE = /([^\s"'`()<>[\]{}|,*;:?\\/]+\.(?:webp|png|jpe?g|gif|svg|avif|bmp|tiff|heic|ico))(?![A-Za-z0-9])/gi;

/** 这些目录/文件不参与引用扫描 */
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'public', '.deploy_git', '.playwright-mcp', '.obsidian']);

/**
 * 自产文件：构建缓存与同步状态。
 * 它们会记录旧文件名（db.json 里是上一次渲染的 HTML），如果参与扫描，
 * 已废弃的图会被永远"吊住"清不掉。
 */
const SCAN_SKIP_FILES = new Set(['db.json', '.notion-sync-state.json', '.notion-pages-state.json']);

const PRUNABLE_EXT = /\.(webp|png|jpe?g|gif|svg|avif|bmp|tiff|heic|ico)$/i;

/** 是否为 Notion 自家图床（需要落地）；外部图床/自有 CDN 一律原样保留 */
export function isNotionHosted(url) {
  try {
    const host = new URL(url).hostname;
    return NOTION_IMAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
  } catch {
    return false;
  }
}

function extFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

function hashOf(url) {
  try {
    const u = new URL(url);
    return crypto.createHash('sha1').update(u.pathname).digest('hex').slice(0, 10);
  } catch {
    return crypto.createHash('sha1').update(url).digest('hex').slice(0, 10);
  }
}

async function fetchWithRetry(url, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType: (res.headers.get('content-type') || '').split(';')[0].trim() };
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr;
}

/**
 * 下载并改写一批 URL。
 * @returns {Promise<{map: Map<string,string>, created: number, reused: number, failed: Array<{url:string,error:string}>}>}
 */
export async function localizeUrls(urls, { slug, dryRun = false }) {
  const targets = [...new Set(urls.filter((u) => u && isNotionHosted(u)))];
  const map = new Map();
  const failed = [];
  let created = 0;
  let reused = 0;

  if (!targets.length) return { map, created, reused, failed };

  const dir = path.join(IMG_ROOT, IMG_NAMESPACE, slug);
  if (!dryRun) await fs.mkdir(dir, { recursive: true });

  for (const url of targets) {
    const hash = hashOf(url);
    let ext = extFromUrl(url);
    const cdnOf = (e) => `${CDN_IMG_BASE}/${IMG_NAMESPACE}/${slug}/notion-${hash}.${e}`;

    try {
      // 已落地过就直接复用，不重复下载
      if (ext) {
        const existing = path.join(dir, `notion-${hash}.${ext}`);
        const stat = await fs.stat(existing).catch(() => null);
        if (stat && stat.size > 0) {
          map.set(url, cdnOf(ext));
          reused += 1;
          continue;
        }
      }

      if (dryRun) {
        map.set(url, cdnOf(ext || 'png'));
        log.debug(`[dry-run] 将下载 ${url.slice(0, 80)}…`);
        continue;
      }

      const { buf, contentType } = await fetchWithRetry(url);
      ext = EXT_BY_TYPE[contentType] || ext || 'png';
      const file = path.join(dir, `notion-${hash}.${ext}`);
      await fs.writeFile(file, buf);
      map.set(url, cdnOf(ext));
      created += 1;
      log.debug(`已落地 ${path.relative(process.cwd(), file)}（${(buf.length / 1024).toFixed(1)} KB）`);
    } catch (err) {
      failed.push({ url, error: err.message });
      log.warn(`图片下载失败（该图将保留 Notion 原链接，可能过期）：${err.message}`);
    }
  }

  return { map, created, reused, failed };
}

/** 把正文和封面里的 Notion 图片换成本地 CDN 地址 */
export function rewriteMarkdownImages(markdown, map) {
  if (!map.size) return markdown;
  return markdown.replace(MD_IMAGE, (full, alt, url, title) => {
    const next = map.get(url);
    return next ? `![${alt}](${next}${title || ''})` : full;
  });
}

/** 收集正文里所有图片 URL */
export function collectMarkdownImageUrls(markdown) {
  const urls = [];
  for (const m of markdown.matchAll(MD_IMAGE)) urls.push(m[2]);
  // 兼容 HTML img（Notion 少数块会走 HTML 输出）
  for (const m of markdown.matchAll(/<img[^>]+src="([^"]+)"/g)) urls.push(m[1]);
  return urls;
}

/**
 * 全站扫描内容文件，收集所有被引用到的图片文件名。
 *
 * 为什么要全站扫而不是只看当前文章的 front-matter：
 * 图片引用可能出现在任何地方 —— front-matter 的 cover / top_img、正文的
 * `![x](url)`、主题标签参数（`{% cell %}` / `{% site %}` 的图片 URL）、
 * `_data` 数据文件里的头像/背景图、站点根目录的 `_config*.yml`、脚本里的默认图。
 * 只统计 front-matter 会把正文里引用的图当成"没人要"而误删。
 *
 * 扫描范围：站点仓全部文本文件（排除 node_modules / public / .git / 图片目录自身）。
 */
export async function collectReferencedAssets({ root = SITE_ROOT, skip = [IMG_ROOT] } = {}) {
  const refs = new Set();
  const skipAbs = new Set(skip.map((p) => path.resolve(p)));

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (skipAbs.has(path.resolve(full))) continue;
      if (e.isDirectory()) {
        if (SCAN_SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (TEXT_EXT.test(e.name) && !SCAN_SKIP_FILES.has(e.name)) {
        const txt = await fs.readFile(full, 'utf8').catch(() => '');
        for (const m of txt.matchAll(IMG_FILE_RE)) refs.add(m[1]);
        // 路径可能被 URL 编码（%E5%BE%AE...），解码后再扫一遍，避免漏判成"没人要"
        try {
          const decoded = decodeURIComponent(txt);
          if (decoded !== txt) for (const m of decoded.matchAll(IMG_FILE_RE)) refs.add(m[1]);
        } catch {
          /* 文件里有非法 % 序列，忽略解码这一遍即可 */
        }
      }
    }
  };

  await walk(root);
  return refs;
}

/**
 * 清理 source/img/<namespace>/ 下已无任何引用的图片。
 *
 * 覆盖三种情况：文章里换了图、文章换了 slug、文章被删。
 * 只清 image namespace 内的图（现在是 source/img/cbmim/）—— 主题自带的默认图、
 * 占位图都在主题包里，不在这个目录，永远不受影响。
 *
 * 安全阀：refs 为空说明扫描出了问题（目录不存在等），此时一律不删，避免误清空。
 */
export async function pruneOrphanAssets(refs, { dryRun = false } = {}) {
  const base = path.join(IMG_ROOT, IMG_NAMESPACE);
  if (!refs || !refs.size) {
    log.warn('引用集合为空，跳过清理（避免误删全部图片）；请检查站点仓是否可读');
    return { removed: [], skipped: true };
  }

  const removed = [];

  const walk = async (dir) => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!PRUNABLE_EXT.test(e.name)) continue;
      if (refs.has(e.name)) continue;
      removed.push(path.relative(base, full).replace(/\\/g, '/'));
      if (!dryRun) await fs.unlink(full).catch(() => {});
    }
  };

  await walk(base);
  return { removed, skipped: false };
}
