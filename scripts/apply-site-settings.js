/**
 * scripts/apply-site-settings.js — 把 Notion 设置合并进主题配置（构建期执行）
 *
 * 唯一站点覆盖来源：source/_data/site-settings.yml（由 tools/notion-settings.mjs 生成）。
 * _config.yml 只负责 Hexo 核心配置；主题默认值来自主题包；不存在第二份站点主题 YAML。
 *
 * 安全：
 *   · 文件缺失、YAML 损坏、空配置（无显式允许标记）或危险键 → 直接终止构建；
 *   · 允许主题扩展键，但拒绝 __proto__ / prototype / constructor 等危险路径；
 *   · 先完整校验再一次性合并，避免“应用一半”的配置。
 */

'use strict';

var fs = require('fs');
var path = require('path');
var yaml = require('js-yaml');

var BLOCK = ['theme', 'deploy', 'server', 'render', 'plugin', 'database', 'skip_render'];
var UNSAFE = ['__proto__', 'prototype', 'constructor'];

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  var proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepMerge(target, patch) {
  Object.keys(patch).forEach(function (k) {
    var value = patch[k];
    if (isPlainObject(value) && Object.keys(value).length && isPlainObject(target[k])) {
      deepMerge(target[k], value);
    } else {
      target[k] = value;
    }
  });
  return target;
}

function validateTree(node, prefix, errors) {
  if (Array.isArray(node)) {
    node.forEach(function (item, index) { validateTree(item, prefix + '[' + index + ']', errors); });
    return;
  }
  if (isPlainObject(node)) {
    Object.keys(node).forEach(function (key) {
      var dotted = prefix ? prefix + '.' + key : key;
      if (!prefix && BLOCK.indexOf(key) > -1) errors.push(dotted + '（黑名单，永不可改）');
      if (!key || UNSAFE.indexOf(key) > -1) errors.push(dotted + '（危险字段）');
      validateTree(node[key], dotted, errors);
    });
    return;
  }
  if (node !== null && typeof node === 'object') {
    errors.push((prefix || '(根)') + '（不支持的对象类型）');
  }
}

function leafPaths(node, prefix, out) {
  if (isPlainObject(node) && Object.keys(node).length) {
    Object.keys(node).forEach(function (key) {
      leafPaths(node[key], prefix ? prefix + '.' + key : key, out);
    });
  } else if (prefix) {
    out.push(prefix);
  }
}

hexo.extend.filter.register('after_render:html', function (data) {
  // 仅替换主题硬编码的二维码脚本；本站图片地址必须在源码与同步落盘时保持同源 /img。
  return data.replace(/https?:\/\/cdn\.cbd\.int\/qrcodejs@1\.0\.0\/qrcode\.min\.js/g, 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js');
});

hexo.extend.filter.register('before_generate', function () {
  var marker = path.join(hexo.base_dir, '.notion-settings-only');
  if (!fs.existsSync(marker)) {
    throw new Error('[settings] 缺少 .notion-settings-only；Notion 单一配置模式拒绝回退到旧配置');
  }
  var variants = fs.readdirSync(hexo.base_dir).filter(function (name) {
    return name.indexOf('_config.cbmim.yml') === 0;
  });
  if (variants.length) {
    throw new Error('[settings] 检测到旧配置变体：' + variants.join(', ') + '；Notion 单一配置模式禁止加载');
  }

  var requested = 'site-settings.yml';
  var file = path.join(hexo.source_dir, '_data', requested);
  if (!fs.existsSync(file)) {
    throw new Error('[settings] 缺少 source/_data/' + requested + '；Notion 设置是唯一覆盖来源，必须先运行 notion:settings');
  }

  var raw = fs.readFileSync(file, 'utf8');
  var data;
  try {
    data = yaml.load(raw);
  } catch (err) {
    var line = Number.isFinite(err?.mark?.line) ? '（第 ' + (err.mark.line + 1) + ' 行附近）' : '';
    throw new Error('[settings] ' + requested + ' 解析失败' + line + '（' + (err?.reason || '语法错误') + '）');
  }
  if (data == null) data = {};
  if (!isPlainObject(data)) {
    throw new Error('[settings] site-settings.yml 顶层必须是映射');
  }
  if (!Object.keys(data).length && raw.indexOf('# allow-empty: true') < 0) {
    throw new Error('[settings] site-settings.yml 为空；已终止构建，避免静默丢失全站设置');
  }

  var errors = [];
  validateTree(data, '', errors);
  if (errors.length) {
    throw new Error('[settings] 配置校验失败，未应用任何设置：' + errors.join('；'));
  }

  deepMerge(hexo.theme.config, data);
  var applied = [];
  leafPaths(data, '', applied);
  hexo.log.info('[settings] Notion 设置已应用 ' + applied.length + ' 项（唯一覆盖来源）');
  applied.forEach(function (key) { hexo.log.info('[settings]   ' + key); });
}, 2);
