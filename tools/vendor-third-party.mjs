/**
 * tools/vendor-third-party.mjs
 *
 * CDN.third_party_provider=local 时，主题只会生成 /pluginsSrc/<package>/<file>
 * 引用，不会自动下载这些文件。本工具在 Hexo 构建后：
 *   1. 扫描 public 中实际引用的第三方资源；
 *   2. 按主题 plugins.yml 的固定版本从 npm registry 下载；
 *   3. 校验 tarball SHA-512，并释放 CSS 依赖的字体/图片；
 *   4. 写入 public/pluginsSrc，随静态产物一起发布。
 *
 * 这样运行时不再依赖公共 CDN，也不会出现“脚本 404 → 图片不懒加载”的连锁问题。
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(TOOLS_DIR, '..');
const DEFAULT_PUBLIC_DIR = path.join(SITE_ROOT, 'public');
const PLUGINS_FILE = path.join(SITE_ROOT, 'node_modules', 'hexo-theme-cbmim', 'plugins.yml');
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.xml', '.json', '.svg']);
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const REGISTRY_BASE = 'https://registry.npmjs.org';
const SITE_PLUGINS = {
  swiper_css: { name: 'swiper', version: '8.0.6', file: 'swiper.min.css' },
  swiper_js: { name: 'swiper', version: '8.0.6', file: 'swiper-bundle.min.js' },
};
const SWIPER_CDN_RE = /https:\/\/npm\.elemecdn\.com\/anzhiyu-theme-static@1\.0\.0\/swiper\//;
const SWIPER_ASYNC_CSS_RE = /<link\b[^>]*href="\/pluginsSrc\/swiper\/swiper\.min\.css"[^>]*(?:media="print"|onload=)/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRelativePath(file, label) {
  const normalized = file.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`${label} 不是安全的相对路径：${file}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} 包含不安全的路径片段：${file}`);
  }
  return path.posix.normalize(normalized);
}

async function walkTextFiles(dir, skipDir) {
  const files = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipDir && path.resolve(full) === path.resolve(skipDir)) continue;
        await walk(full);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  return files;
}

async function loadPlugins() {
  const raw = await fs.readFile(PLUGINS_FILE, 'utf8');
  const plugins = yaml.load(raw);
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    throw new Error(`主题插件清单格式无效：${PLUGINS_FILE}`);
  }
  return { ...plugins, ...SITE_PLUGINS };
}

async function collectReferences(publicDir, plugins) {
  const byUrl = new Map();
  for (const [key, plugin] of Object.entries(plugins)) {
    if (!plugin?.name || !plugin?.version || !plugin?.file) {
      throw new Error(`主题插件清单缺少 name/version/file：${key}`);
    }
    const file = safeRelativePath(plugin.file, `插件 ${key}`);
    const url = `/pluginsSrc/${plugin.name}/${file}`;
    const previous = byUrl.get(url);
    if (previous && (previous.name !== plugin.name || previous.version !== plugin.version)) {
      throw new Error(`同一本地资源映射到多个版本：${url}`);
    }
    byUrl.set(url, { key, name: plugin.name, version: String(plugin.version), file });
  }

  const refs = new Map();
  const files = await walkTextFiles(publicDir, path.join(publicDir, 'pluginsSrc'));
  for (const file of files) {
    const content = await fs.readFile(file, 'utf8');
    if (SWIPER_CDN_RE.test(content)) {
      throw new Error(`Swiper 仍引用公共 CDN，请检查 scripts/local-swiper.js：${path.relative(publicDir, file)}`);
    }
    if (SWIPER_ASYNC_CSS_RE.test(content)) {
      throw new Error(`Swiper CSS 必须同步加载，避免初始化早于样式：${path.relative(publicDir, file)}`);
    }
    for (const match of content.matchAll(/\/pluginsSrc\/[^\s"'<>)]+/g)) {
      const url = match[0].replaceAll('&amp;', '&').split(/[?#]/)[0];
      const plugin = byUrl.get(url);
      if (!plugin) {
        throw new Error(`发现主题 plugins.yml 未登记的本地第三方资源：${url}`);
      }
      refs.set(url, plugin);
    }
  }
  return refs;
}

async function fetchWithRetry(url, label, as = 'buffer') {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'cbmim-vendor-third-party/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
      return as === 'json' ? await response.json() : Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label} 下载失败：${lastError?.message || lastError}`);
}

function verifySha512(buffer, integrity, label) {
  const match = /^sha512-(.+)$/.exec(integrity || '');
  if (!match) throw new Error(`${label} 缺少 registry SHA-512 校验值`);
  const actual = createHash('sha512').update(buffer).digest('base64');
  if (actual !== match[1]) throw new Error(`${label} SHA-512 校验失败`);
}

function extractMember(tarball, member, label) {
  try {
    return execFileSync('tar', ['--force-local', '-xOf', tarball, member], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(`${label} 释放失败：${detail}`);
  }
}

function cssDependencies(cssFile, content) {
  const deps = new Set();
  for (const match of content.matchAll(CSS_URL_RE)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!raw || /^(?:data:|https?:|\/\/|\/|#|blob:)/i.test(raw)) continue;
    const clean = raw.split(/[?#]/)[0];
    if (!clean) continue;
    deps.add(safeRelativePath(path.posix.join(path.posix.dirname(cssFile), clean), `CSS ${cssFile} 依赖`));
  }
  // 某些 npm 包会省略 SVG 字体，但同时提供 woff2/woff/ttf/eot。
  // 浏览器优先使用前者；跳过仅用于旧浏览器兜底的 SVG，避免对可选资源误报 404。
  for (const dependency of [...deps]) {
    if (path.posix.extname(dependency).toLowerCase() !== '.svg') continue;
    const base = dependency.slice(0, -4);
    if (['.woff2', '.woff', '.ttf', '.eot'].some((ext) => deps.has(base + ext))) deps.delete(dependency);
  }
  return deps;
}

async function writeAsset(publicDir, name, file, data) {
  const safeFile = safeRelativePath(file, `产物 ${name}`);
  const destination = path.join(publicDir, 'pluginsSrc', name, ...safeFile.split('/'));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, data);
}

async function vendorGroup(publicDir, group) {
  const label = `${group.name}@${group.version}`;
  const metadataUrl = `${REGISTRY_BASE}/${encodeURIComponent(group.name)}/${encodeURIComponent(group.version)}`;
  const metadata = await fetchWithRetry(metadataUrl, `${label} 元数据`, 'json');
  if (!metadata?.dist?.tarball || !metadata?.dist?.integrity) {
    throw new Error(`${label} 元数据缺少 tarball 或 integrity`);
  }

  const tarballData = await fetchWithRetry(metadata.dist.tarball, `${label} tarball`);
  verifySha512(tarballData, metadata.dist.integrity, label);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cbmim-vendor-'));
  const tarball = path.join(tempDir, 'package.tgz');
  await fs.writeFile(tarball, tarballData);

  const queue = [...group.files];
  const seen = new Set(queue);
  try {
    for (let index = 0; index < queue.length; index += 1) {
      const file = safeRelativePath(queue[index], `${label} 资源`);
      const data = extractMember(tarball, `package/${file}`, `${label}:${file}`);
      await writeAsset(publicDir, group.name, file, data);
      if (path.extname(file).toLowerCase() === '.css') {
        for (const dependency of cssDependencies(file, data.toString('utf8'))) {
          if (!seen.has(dependency)) {
            seen.add(dependency);
            queue.push(dependency);
          }
        }
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  return queue.length;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export async function vendorThirdParty({ publicDir = DEFAULT_PUBLIC_DIR, checkOnly = false } = {}) {
  await fs.access(publicDir);
  const plugins = await loadPlugins();
  const refs = await collectReferences(publicDir, plugins);
  const destinations = new Map();
  const groups = new Map();

  for (const plugin of refs.values()) {
    const destination = `/pluginsSrc/${plugin.name}/${plugin.file}`;
    const previous = destinations.get(destination);
    if (previous && previous !== `${plugin.name}@${plugin.version}`) {
      throw new Error(`同一产物路径来自不同包版本：${destination}`);
    }
    destinations.set(destination, `${plugin.name}@${plugin.version}`);
    const key = `${plugin.name}@${plugin.version}`;
    if (!groups.has(key)) groups.set(key, { name: plugin.name, version: plugin.version, files: new Set() });
    groups.get(key).files.add(plugin.file);
  }

  if (checkOnly) {
    const missing = new Set();
    const exists = async (file) => {
      try {
        const stat = await fs.stat(file);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    };
    for (const destination of destinations.keys()) {
      const file = path.join(publicDir, ...destination.slice(1).split('/'));
      if (!(await exists(file))) missing.add(destination);
    }

    const pluginsRoot = path.join(publicDir, 'pluginsSrc');
    const cssFiles = (await walkTextFiles(pluginsRoot)).filter((file) => path.extname(file).toLowerCase() === '.css');
    let cssDependencyCount = 0;
    for (const cssFile of cssFiles) {
      const relative = path.relative(pluginsRoot, cssFile).replaceAll('\\', '/');
      const content = await fs.readFile(cssFile, 'utf8');
      for (const dependency of cssDependencies(relative, content)) {
        cssDependencyCount += 1;
        const destination = `/pluginsSrc/${dependency}`;
        if (!(await exists(path.join(pluginsRoot, ...dependency.split('/'))))) missing.add(destination);
      }
    }
    if (missing.size) {
      throw new Error(`缺少 ${missing.size} 个本地第三方资源：\n${[...missing].map((item) => `  ${item}`).join('\n')}`);
    }
    console.log(`本地第三方资源检查通过：${destinations.size} 个引用文件、${cssDependencyCount} 个 CSS 依赖均存在`);
    return { references: destinations.size, files: destinations.size + cssDependencyCount, downloaded: 0 };
  }

  let downloaded = 0;
  const groupList = [...groups.values()];
  const counts = await mapLimit(groupList, 4, (group) => vendorGroup(publicDir, group));
  downloaded = counts.reduce((sum, count) => sum + count, 0);
  for (const group of groupList) {
    console.log(`已本地化 ${group.name}@${group.version}：${group.files.size} 个直接引用`);
  }
  console.log(`本地第三方资源完成：${destinations.size} 个引用，共释放 ${downloaded} 个文件（含 CSS 依赖）`);
  return { references: destinations.size, files: downloaded, downloaded };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const checkOnly = process.argv.includes('--check');
  try {
    await vendorThirdParty({ checkOnly });
  } catch (error) {
    console.error(`本地第三方资源处理失败：${error.message}`);
    process.exitCode = 1;
  }
}
