#!/usr/bin/env node
/**
 * 把 source/img 同步到独立图片仓 ShenDoyle/img 的根目录。
 * 站点通过 /img/<path> 访问；图片仓保留 README，其余内容与 source/img 保持一致。
 * 部署密钥只通过 GIT_SSH_COMMAND 使用，不写入日志或仓库。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'source', 'img');
const REPO = 'git@github.com:ShenDoyle/img.git';
const PRESERVE = new Set(['.git', 'README.md']);

function run(command, args, { cwd, env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `${result.stdout || ''}\n${result.stderr || ''}`.trim() : '';
    throw new Error(`${command} ${args.join(' ')} 失败（exit ${result.status}）${detail ? `\n${detail}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cbmim-images-'));
try {
  const checkout = path.join(temp, 'img');
  run('git', ['clone', '--depth', '1', REPO, checkout]);

  for (const entry of await fs.readdir(checkout)) {
    if (PRESERVE.has(entry)) continue;
    await fs.rm(path.join(checkout, entry), { recursive: true, force: true });
  }
  for (const entry of await fs.readdir(SOURCE)) {
    await fs.cp(path.join(SOURCE, entry), path.join(checkout, entry), { recursive: true });
  }

  run('git', ['add', '-A'], { cwd: checkout });
  const changed = run('git', ['status', '--porcelain'], { cwd: checkout, capture: true });
  if (changed) {
    const identity = {
      GIT_AUTHOR_NAME: 'github-actions[bot]',
      GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]',
      GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
    };
    run('git', ['commit', '-m', 'chore(images): sync from Notion publish workflow'], { cwd: checkout, env: { ...process.env, ...identity } });
    run('git', ['push', 'origin', 'HEAD:main'], { cwd: checkout });
  } else {
    console.log('图片仓内容无变化');
  }

  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: checkout, capture: true });
  console.log(`图片仓已同步：${sha}`);
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV, `IMG_REPO_SHA=${sha}\n`);
  }
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}
