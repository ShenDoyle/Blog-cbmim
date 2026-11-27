# Notion 内容后台 · 使用说明

站点：https://cbm.im/

框架：Hexo 7 + CBMIM theme 1.7.1

发布：GitHub Actions → GitHub Pages → 阿里云 ESA
后台：Notion（文章 / 页面 / 站点设置）

## 一、当前状态

Notion 结构、首批文章导入和站点设置迁移均已完成：

- 文章、独立页面/数据与站点主题设置都由 Notion 管理。
- `_config.cbmim.yml` 已删除，`.notion-settings-only` 已启用。
- 不再存在迁移窗口、旧 YAML 回退或首次导入工具。
- 生产发布完全在 GitHub Actions 执行，不需要本机 Node、`.env` 或部署密钥。
- 线上图片统一为同源 `/img/...`；`ShenDoyle/img` 只是镜像与备份。
- 评论使用 Giscus + GitHub Discussions。

| 项 | 值 |
|---|---|
| Notion 根页面 | [CBMIM 博客](https://app.notion.com/p/3e77adb0e2e081148917e6673992874f) |
| 博文库 data source | `8aee0783-0b53-41e0-861e-0b26993518e3` |
| 页面库 data source | `b12990b0-b20f-47d5-81a6-6c3096ef4249` |
| 站点设置库 | 按标题「⚙️ 站点设置」查找 |
| 托管标记 | 文章 front-matter 中的 `notion_page_id` |
| 增量状态 | `.notion-sync-state.json`、`.notion-pages-state.json` |

## 二、日常工作流

```text
Notion 修改内容 / 设置
        ↓ 每 6 小时或手动触发
GitHub Actions 同步并提交生成文件
        ↓
Hexo 构建 → GitHub Pages
        ↓
阿里云 ESA → cbm.im
```

| 想改什么 | 在哪改 | 生效时间 |
|---|---|---|
| 发文章 / 改文章 | Notion「🗂 博文」，勾选「发布」 | 最多 6 小时；手动 Run workflow 可立即生效 |
| 版权协议 / 隐私政策 | Notion「📄 页面」对应正文 | 同上 |
| 友链 / 好物 / 关于页等数据 | Notion「📄 页面」里的 YAML 代码块 | 同上 |
| 主题配置 | Notion「⚙️ 站点设置」→「值」列 | 同上 |

立即发布：仓库 **Actions → Notion 同步并发布 → Run workflow**。

- `dry_run=true`：只预览，不写文件、不发布。
- `force=true`：忽略文章增量，全部重新生成并清理无引用图片。
- 机器人同步提交不会再次触发发布，避免循环。
- 判断线上是否最新，优先看产物仓 `ShenDoyle/ShenDoyle.github.io` 的最后提交时间。

## 三、文章字段

| 属性名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| 标题 | Title | ✅ | 文章标题 |
| Slug | 文本 | ✅ | 文件名，决定文章 URL，发布后不要改 |
| 日期 | Date | ✅ | 发布时间；改了可能改变文章 URL |
| 分类 | 单选 / 多选 | | 对应 `categories` |
| 标签 | 多选 | | 对应 `tags` |
| 封面 | 文件与媒体或 URL | | 对应 `cover`，Notion 图会自动下载 |
| 置顶 | 数字 / 现有设置项 | | 对应 `top_group_index`，数值越大越靠前 |
| 摘要 | 文本 | | 对应 `ai`；多行会生成多条摘要 |
| 发布 | 复选框 | ✅ | 勾选才同步；取消勾选只提示，不自动删除本地文章 |
| 封面标题 | 文本 | | 对应 `covertitle` |
| 封面副标题 | 文本 | | 对应 `coverset` |
| 蒙版强度 | 数字 | | 对应 `coverdim`，0~1 或 0~100 |
| 侧栏 / 目录 / 评论 | 现有设置项 | | 对应 `aside / toc / comments` |
| 关键词 | 文本 | | SEO keywords |
| 头图 | 文本 | | `top_img`，URL 或 `false` |

字段名支持中英文候选，清单在 `tools/notion/config.mjs` 的 `PROPS` 中。文章 front-matter 的 `notion_page_id` 由脚本写入，不要手工修改；删除它即可让该文件脱离 Notion 托管。

### 封面建议

- 最佳分辨率 **1600×700（16:7）webp，≤300KB**，主体放在画面中部。
- 封面标题建议控制在 8 字以内；封面副标题建议不超过 14 字。
- 蒙版强度留空使用主题默认值；`0` 表示不加蒙版。
- 三处封面文字配置全空时显示原图；任一填写时启用主题封面效果。
- 未配置封面时使用主题默认封面，不额外做图片兜底。

## 四、正文写作规则

### 摘要截断

两种写法都支持：

| 写法 | 结果 |
|---|---|
| 在正文插入第一条分割线 | 第一条分割线变为 `<!--more-->`，后续分割线保留 |
| 单独一行写 `[more]` | 该位置变为 `<!--more-->` |

两者都没有时，脚本自动插在第一段之后，并在日志提醒。

### 提示框

Notion Callout 按颜色转换：

| 颜色 | 主题标签 |
|---|---|
| 灰 / 默认 / 棕 | `{% note default %}` |
| 蓝 | `{% note info %}` |
| 紫 | `{% note primary %}` |
| 绿 | `{% note success %}` |
| 黄 / 橙 | `{% note warning %}` |
| 红 / 粉 | `{% note danger %}` |

灰底提示也可用图标推断类型：`💡ℹ️→info`、`✅→success`、`⚠️→warning`、`❗❌🚫🔥→danger`、`📌→primary`。

需要精确控制时，在 Callout 第一行写：

```text
[note:danger]
[note:warning no-icon]
[note:success 已完成]
```

第三种写法会把「已完成」作为加粗小标题。

### 折叠块

Notion Toggle 自动转换为 `{% hideToggle 标题 %}`，子块保留。主题不支持同名嵌套折叠；内层会保留原生 HTML，日志会提醒。

### 图片

- Notion 图床图片在同步时下载到 `source/img/cbmim/<slug>/notion-<hash>.<ext>`。
- 正文、封面与头图统一改写为同源 `/img/cbmim/<slug>/...`。
- Notion 原图链接约一小时过期，因此不能直接作为长期线上地址。
- 外部非 Notion 图片链接原样保留。
- 历史本站 jsDelivr 图片 URL 在同步落盘前直接归一为 `/img/`，不再依靠构建期重写。
- 发布时把 `source/img` 镜像到 `ShenDoyle/img`，但线上仍访问 `https://cbm.im/img/...`。
- CI 会扫描全站引用并删除 `source/img/cbmim/` 下无引用的孤儿图片。

### 支持范围

| Notion 内容 | 结果 |
|---|---|
| 标题、段落、富文本、行内代码、链接 | 正常 |
| 无序 / 有序列表、待办、引用、分割线 | 正常 |
| 代码块、表格、公式 | 正常 |
| Callout、Toggle、图片、文件 / 视频 / 书签链接 | 正常 |
| 子页面、子数据库 | 忽略正文并提醒，需要拆成独立文章 |
| 同步块、数据库视图、Notion AI 块 | 不渲染 |
| 分栏 | 转为顺序排列 |

## 五、站点设置

在 Notion「⚙️ 站点设置」只编辑「值」列：

- 留空 = 使用主题包默认值；填了才覆盖。
- 「启用」已废弃，不参与取值；关闭功能请填 `false`。
- `false / 0 / null / [] / {}` 保留精确类型；空字符串写 `""`。
- 「当前值 / 说明 / 优先级 / 类型 / 分组 / 风险」是自动生成列，不要手改。
- 设置同步生成 `source/_data/site-settings.yml`，构建时校验并深度合并。
- 文件缺失、YAML 损坏、空配置、危险路径或核心黑名单键都会让构建失败。
- `.notion-settings-only` 必须存在；任何 `_config.cbmim.yml*` 变体都会被拒绝。

Notion 是唯一站点覆盖层，但 Hexo 核心配置仍在 `_config.yml`，主题默认值仍在主题包中。

## 六、独立页面与数据

「📄 页面」库字段：页面名称、路径、说明、发布。

- 路径必须位于 `source/` 下，并以 `.md`、`.yml` 或 `.json` 结尾。
- Markdown 页面只替换正文，已有 front-matter 原样保留。
- YAML / JSON 数据页面在 Notion 正文放一个代码块，脚本逐字写回代码块内容。
- 未勾选「发布」的页面只提示，不自动删除本地文件。
- `bangumis.json` 由插件生成，不由 Notion 管理。

## 七、增量与安全规则

- 文章按 `last_edited_time` 增量跳过，页面使用独立状态文件。
- 只增改，不自动删除文章或页面；取消发布只提醒。
- Slug 留空时优先沿用历史文件名，新文章才由标题生成并提醒补填。
- Slug 改变时，脚本确认旧文件仍带同一 `notion_page_id` 后才删除旧文件。
- 日期改变会告警，因为文章 URL 可能变化。
- 设置同步不会把真实密钥写入公开仓库；敏感值应使用 GitHub Secrets / 环境变量。
- 不在日志、聊天或文档中输出令牌、App Key、Master Key、PAT 或私钥。

## 八、可选本机排障

本机命令不是网站依赖，只有修改同步脚本或转换规则时才需要：

```bash
npm ci

# 离线回归，不需要 Notion 令牌
npm run notion:selftest
npm run notion:settings -- --selftest

# 预览同步，不写文件
npm run notion:preview

# 完整构建与第三方资源检查
npm run build
npm run vendor:third-party:check
```

本机需要真实同步时，把令牌放进 `.env`（已 gitignore）或系统环境变量。优先级为系统环境变量高于 `.env`。生产环境统一使用 GitHub repository Secrets。

## 九、涉及文件

| 路径 | 作用 |
|---|---|
| `tools/notion-sync.mjs` | 文章同步入口 |
| `tools/notion-pages-sync.mjs` | 独立页面与数据同步 |
| `tools/notion-settings.mjs` | 设置同步、初始化、刷新、离线自检 |
| `tools/notion/assets.mjs` | 图片下载、同源改写、历史 URL 归一、孤儿清理 |
| `tools/notion/config.mjs` | 字段候选、路径、图片命名空间、颜色映射 |
| `tools/notion/api.mjs` | Notion API 访问 |
| `tools/notion/render.mjs` | 区块 → Markdown 与主题语法 |
| `tools/notion/convert.mjs` | 属性 → front-matter、日期、摘要截断 |
| `tools/notion/state.mjs` | 文章增量状态与磁盘自愈 |
| `tools/notion-selftest.mjs` | 文章转换与源码图片 URL 回归自检 |
| `tools/publish-images.mjs` | `source/img` → `ShenDoyle/img` 镜像 |
| `scripts/apply-site-settings.js` | 构建期应用并校验 Notion 设置 |
| `.github/workflows/notion-publish.yml` | 同步与发布 |
| `.github/workflows/site-monitor.yml` | 每 5 分钟可用性监控 |
| `.notion-sync-state.json` | 文章增量状态，需要提交 |
| `.notion-pages-state.json` | 页面增量状态，需要提交 |
| `source/_data/site-settings.yml` | Notion 设置生成物，需要提交 |
| `.notion-settings-only` | 强制单一配置模式，禁止旧主题 YAML |
| `.env.example` | 可选本机排障模板；生产只使用 GitHub Secrets |
