/**
 * tools/notion/log.mjs — 极简日志（无依赖，带步骤前缀）
 */

const TAGS = {
  info: 'INFO ',
  ok: 'OK   ',
  warn: 'WARN ',
  err: 'ERROR',
  skip: 'SKIP ',
};

let verbose = false;

export function setVerbose(v) {
  verbose = !!v;
}

function emit(level, msg) {
  const line = `[${TAGS[level] || 'INFO '}] ${msg}`;
  if (level === 'err') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  info: (m) => emit('info', m),
  ok: (m) => emit('ok', m),
  warn: (m) => emit('warn', m),
  err: (m) => emit('err', m),
  skip: (m) => emit('skip', m),
  debug: (m) => {
    if (verbose) emit('info', m);
  },
  /** 打印一张对齐的小表格 */
  table(rows) {
    if (!rows.length) return;
    const widths = [];
    for (const row of rows) {
      row.forEach((cell, i) => {
        widths[i] = Math.max(widths[i] || 0, String(cell).length);
      });
    }
    for (const row of rows) {
      const line = row
        .map((cell, i) => String(cell).padEnd(widths[i]))
        .join('  ')
        .replace(/\s+$/, '');
      process.stdout.write(`${line}\n`);
    }
  },
};
