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

import { CDN_IMG_BASE, IMG_NAMESPACE, IMG_ROOT, NOTION_IMAGE_HOSTS } from './config.mjs';
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

/** 清理某篇文章目录下已不再被引用的 notion-* 图片 */
export async function pruneOrphanAssets(slug, referencedUrls) {
  const dir = path.join(IMG_ROOT, IMG_NAMESPACE, slug);
  const files = await fs.readdir(dir).catch(() => []);
  const keep = new Set(
    referencedUrls
      .map((u) => (u || '').split('/').pop())
      .filter(Boolean)
  );
  const removed = [];
  for (const f of files) {
    if (!f.startsWith('notion-')) continue; // 只动脚本自己生成的文件
    if (keep.has(f)) continue;
    await fs.unlink(path.join(dir, f));
    removed.push(f);
  }
  return removed;
}
