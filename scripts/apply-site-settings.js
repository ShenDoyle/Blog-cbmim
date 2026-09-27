/**
 * scripts/apply-site-settings.js — 把 Notion 设置合并进主题配置（构建期执行）
 *
 * 数据来源：source/_data/site-settings.yml（由 tools/notion-settings.mjs 生成）
 * 生效方式：深度合并进 hexo.theme.config —— **不重写** _config.cbmim.yml，
 *           配置文件里的值永远是"默认层"，Notion 只是覆盖层。
 *
 * 安全：
 *   · 硬黑名单（theme / deploy / server / render / plugin…）直接拒绝，防止把站点改坏；
 *   · 只接受已经出现在主题默认配置里的键，未知键只告警不写入；
 *   · 单键写入失败不影响其它键。
 */

'use strict';

var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');

// 永不可改（这些不是主题配置，或改坏会直接导致构建/发布失败）
var BLOCK = ['theme', 'deploy', 'server', 'render', 'plugin', 'database', 'skip_render'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, patch) {
  Object.keys(patch).forEach(function (k) {
    var pv = patch[k];
    if (isPlainObject(pv) && isPlainObject(target[k])) deepMerge(target[k], pv);
    else target[k] = pv;
  });
  return target;
}

function hasPath(obj, dotted) {
  var cur = obj;
  var parts = dotted.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (!isPlainObject(cur) || !(parts[i] in cur)) return false;
    cur = cur[parts[i]];
  }
  return true;
}

function getPath(obj, dotted) {
  var cur = obj;
  var parts = dotted.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function show(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

hexo.extend.filter.register('before_generate', function () {
  var file = path.join(hexo.source_dir, '_data', 'site-settings.yml');
  if (!fs.existsSync(file)) return;

  var data;
  try {
    data = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    hexo.log.warn('[settings] site-settings.yml 解析失败，已跳过：' + e.message);
    return;
  }
  if (!isPlainObject(data) || !Object.keys(data).length) return;

  var applied = [];
  var rejected = [];

  Object.keys(data).forEach(function (top) {
    if (BLOCK.indexOf(top) > -1) {
      rejected.push(top + '（黑名单，永不可改）');
      return;
    }
    if (!isPlainObject(data[top])) {
      if (hexo.theme.config[top] === undefined) { rejected.push(top + '（主题无此键）'); return; }
      hexo.theme.config[top] = data[top];
      applied.push(top + ' = ' + show(data[top]).slice(0, 60));
      return;
    }
    // 逐叶子键合并，边合边校验
    var walk = function (node, prefix) {
      Object.keys(node).forEach(function (k) {
        var dotted = prefix ? prefix + '.' + k : k;
        var v = node[k];
        if (isPlainObject(v)) { walk(v, dotted); return; }
        if (!hasPath(hexo.theme.config, dotted)) {
          rejected.push(dotted + '（主题配置里不存在该键，已忽略）');
          return;
        }
        var before = getPath(hexo.theme.config, dotted);
        deepMerge(hexo.theme.config, setPath({}, dotted, v));
        applied.push(dotted + '：' + show(before).slice(0, 30) + ' → ' + show(v).slice(0, 30));
      });
    };
    walk(data[top], top);
  });

  if (rejected.length) {
    hexo.log.warn('[settings] 忽略 ' + rejected.length + ' 项：' + rejected.join('；'));
  }
  if (applied.length) {
    hexo.log.info('[settings] Notion 设置已应用 ' + applied.length + ' 项：');
    applied.forEach(function (a) { hexo.log.info('[settings]   ' + a); });
  }
});

function setPath(obj, dotted, value) {
  var parts = dotted.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!isPlainObject(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}
