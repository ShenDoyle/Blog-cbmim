# Blog-cbmim · cbm.im 源码仓

cbm.im 博客的 Hexo 源码仓库。文章、页面与站点主题设置的唯一后台是 **Notion**，发布由 **GitHub Actions** 全自动完成。网站访问、构建、发布均不依赖本机；本地 Node 只作为可选的开发排障工具。

## 架构一览

```
Notion（文章、页面、站点设置）
        ↓ API
GitHub Actions（每 6 小时 / 手动触发）
        ↓
Hexo 构建
        ↓
ShenDoyle.github.io（GitHub Pages 源站）
ShenDoyle/img（图片镜像 / 备份，不提供线上 URL）
        ↓
阿里云 ESA 免费版
        ↓
cbm.im / www.cbm.im
```

- 源码仓（本仓库）与产物仓（`ShenDoyle.github.io`）严格分离——`hexo-deployer-git` 是 force push，共用一仓会覆盖源码。
- 文章图片落地到 `source/img/cbmim/<slug>/`，正文、封面与头图统一引用同源 `/img/cbmim/<slug>/...`；`ShenDoyle/img` 只保存镜像，线上地址由 ESA 从 GitHub Pages 同源分发。
- 主题为 npm 依赖 `hexo-theme-cbmim`（固定 commit），本仓库不含主题源码；站点主题设置以 Notion「⚙️ 站点设置」为唯一值来源，`_config.yml` 只保留 Hexo 核心配置。
- `CDN.third_party_provider=local` 时，构建会把页面实际引用的第三方脚本/样式按主题固定版本发布到 `public/pluginsSrc/`，运行时不依赖公共 CDN；CI 会再次检查引用文件，缺失即中断发布。

## 怎么更新内容（日常）

| 想改什么 | 在哪改 | 生效时间 |
|---|---|---|
| 发文章 / 改文章 | Notion「🗂 博文」改完勾「发布」 | 最多 6 小时；要立即生效去 Actions 点 Run workflow |
| 版权协议 / 隐私政策 | Notion「📄 页面」对应页面的正文 | 同上 |
| 友链 / 好物 / 关于页等数据 | Notion「📄 页面」对应页面里的 yaml 代码块 | 同上 |
| **主题配置（约 500 项）** | Notion「⚙️ 站点设置」→ 在**值**列填新值 | 同上 |

主题设置库的用法：

- **只改「值」列：填了才覆盖主题默认值，留空就是使用主题默认值。** 不再读取第二份站点主题 YAML。
- 「启用」列已废弃，只自动反映该行是否有显式值，不参与配置取值；不要靠取消勾选来关闭功能，关闭请把「值」写成 `false`。
- `false`、`0`、`null`、`[]`、`{}` 会保留精确类型；空字符串必须写成 `""`，不能留空。
- 「优先级」管排序，常用功能在最上面；「说明 / 当前值 / 优先级 / 类型 / 分组 / 风险」由脚本生成。
- 「当前值」只是展示缓存，不会反向覆盖配置；笔记请写在行自身的页面正文里。
- 主题包默认值是 schema 和兜底层；Notion 是唯一的站点覆盖层。未知扩展键也会应用，但 `theme/deploy/server/render/plugin` 等核心键与原型污染危险键会被拒绝。

### 图片：自动落地 + 自动清理

Notion 图床的图（正文图与封面）同步时自动下载到 `source/img/cbmim/<slug>/notion-<hash>.<ext>` 并改写成同源 `/img/` 地址；外部图床地址原样保留。历史本站 jsDelivr 图片 URL 在文章、页面与数据同步落盘前直接归一为 `/img/`，不依赖构建期重写。发布时只把 `source/img` 镜像到独立图片仓 `ShenDoyle/img`。

CI 的同步步骤带 `--prune-assets`：扫描全站引用关系后，**自动删除 `source/img/cbmim/` 下已无任何引用的图片**（换图、换 slug、删文章留下的孤儿），避免仓库越滚越大。主题自带的默认图/占位图在主题包里，不在这个目录，不受影响。每次删除都会打印文件名，git 可回滚。

### 发布与排障

日常立即发布：进入仓库 **Actions → Notion 同步并发布 → Run workflow**。`dry_run=true` 只预览，`force=true` 忽略文章增量并清理无引用图片。

本地 Node 与 `.env` 只用于修改同步脚本后的可选排障；生产发布不需要本地一条龙命令，也不存在旧主题 YAML 迁移分支。`.notion-settings-only` 必须存在，任何 `_config.cbmim.yml*` 变体都会让 CI 直接失败。

### 发布的三种触发方式（2026-09-27 起）

| 触发 | 行为 | 适用 |
|---|---|---|
| **push 到 main** | 立刻构建 + 部署 | 改主题/脚本/配置/手工文章 |
| **每 6 小时定时** | **只在 Notion 内容有变化时**才构建部署 | 日常写文章，等它自己上线 |
| **手动 Run workflow** | 强制构建 + 部署（`dry_run` 只预览，`force` 全量重建） | 想立刻上线 / 排错 |

⚠️ 定时触发不会因为"源码改了"而部署 —— 源码改动必须 push（push 本身即触发部署，不用再点任何按钮）。
判断线上是否为最新：**看产物仓 `ShenDoyle.github.io` 的最后一次提交时间**；`cbm.im` 由阿里云 ESA 免费版加速，源站仍是 GitHub Pages。

📘 完整的可执行方案（从零到线上、改主题流程、回滚、排错手册、标签签名速查）见主题仓：
[`CBMIM-theme/docs/使用与部署手册.md`](https://github.com/ShenDoyle/CBMIM-theme/blob/main/docs/使用与部署手册.md)

## 目录结构

```
├─ _config.yml               # Hexo 核心配置（URL / theme / 插件 / 渲染 / 部署）
├─ .notion-settings-only     # 强制 Notion 单一配置模式：禁止旧 _config.cbmim.yml* 变体
├─ .github/workflows/
│  ├─ notion-publish.yml     # 自动发布流水线（cron 每 6 小时 + 手动）
│  └─ site-monitor.yml       # 每 5 分钟可用性监控
├─ scripts/
│  └─ covermeta.js           # 封面效果生成器（covertitle/coverset/coverdim → covermeta.json）
├─ source/
│  ├─ _posts/                # 文章（Notion「🗂 博文」同步落地，front-matter 带 notion_page_id）
│  ├─ _data/                 # 结构化数据（Notion「📄 页面」同步落地，除 bangumis.json 为插件生成）
│  ├─ cc|privacy|about/      # 独立页面（cc/privacy 正文由 Notion 管理）
│  ├─ img/cbmim/             # 文章图片（脚本自动下载落地，并镜像到独立图片仓）
│  └─ js|css/                # 站点级自定义脚本/样式（封面文字层、友链门禁）
├─ tools/                    # Notion 同步工具链（node tools/…，放这里是因为 Hexo 会执行 scripts/）
│  ├─ notion-sync.mjs        # 文章同步 CLI（--dry-run/--force/--only）
│  ├─ notion-pages-sync.mjs  # 独立页面 + 数据文件同步 CLI
│  ├─ notion-settings.mjs    # 站点设置同步 / 初始化 / 刷新 / 离线自检 CLI
│  ├─ publish-images.mjs     # source/img → ShenDoyle/img 镜像
│  ├─ vendor-third-party.mjs # local CDN 第三方资源本地化与完整性检查
│  ├─ notion-selftest.mjs    # 离线自检（18 项，不需要令牌）
│  └─ notion/                # 同步模块（config/api/render/convert/assets/state/log）
└─ docs/                     # 设计文档（Notion 接入结构、字段说明）
```

## Notion 字段速查（🗂 博文）

必填：标题、Slug（发布后勿改，保 URL）、日期、发布（勾选）。
可选：分类、标签、封面、摘要、置顶（单选 9/7/5/3/1）、页面 ID（脚本回写，勿手改）。

封面三件套（配合 `scripts/covermeta.js`）：

| 字段 | 规则 |
|---|---|
| 封面 | 最佳分辨率 **1600×700（16:7）webp ≤300KB**，主体放画面中部；**留空则用主题自带的默认封面图**（原主题逻辑，不做任何替换） |
| 封面标题 | **大字**，单行：优先显示原文，放不下时在不低于可读下限内自动缩排，缩到下限仍放不下或没填 → 显示 CBM.IM（不截断）。建议 ≤8 字 |
| 封面副标题 | **【已弃用】** 小字固定渲染 **CBM.IM**（品牌署名，与 Cover.psd 默认版式一致），此字段不再影响显示效果，仅保留作触发项 |
| 蒙版强度 | 0~1 或百分数；留空默认 0.46，0 = 不加蒙版。文章顶图不叠蒙版与文字，只显示背景原图 |

**三处全空 = 原图不加效果；任一填写 = 启用主题封面效果（蒙版 + 文字层）。**

文字层（模糊框）是 Cover.psd 默认参数的**严格等比复刻**，任何卡片位置比例恒为 554:162：宽 = 容器宽 × 554/760（并以容器高做内接保护）、高 = 卡片宽 × 162/554、圆角 20/554、内边距 20.75/554、主副标题间距 22.8/554，字号 = 卡片宽 × 58/554。装不下时**加宽卡片**（比例不变），不改高度、不裁切文字。

- 小卡（容器宽 **< 300px**，如轮播 / 侧栏 / 置顶小卡）：**只显示一行「分类」**（`categories` 第一项，如「运营」），无分类时回退 CBM.IM。
- 大卡：大字 = 封面标题（放不下先缩排，缩到下限仍放不下则回退 CBM.IM，此时自动隐藏小字防重复）。
- 大字斜切统一 `-12deg`（与 cover-editor 的 tSkew 12 一致），测量时按斜出量预留宽度。
- 容器宽 < 80px 的极窄缩略图不渲染文字层，只保留蒙版。
- **不做任何图片兜底**（2026-09-27 决定）：没配封面 → 主题默认封面图；图片加载失败 → 主题自身的 `onerror` 行为，脚本不隐藏、不替换任何图片。


主题可选配置（留空不写入）：侧栏 / 目录 / 评论（单选 true/false）、关键词（逗号分隔）、头图（URL 或 false）。

## 安全

- 生产发布的 `NOTION_TOKEN` 等敏感信息只放 GitHub repository Secrets，绝不进代码或日志；本机 `.env` 仅用于可选开发调试且已 gitignore。
- Actions 需要的 Secrets：`NOTION_TOKEN`、`NOTION_DATABASE_ID`、`DEPLOY_KEY`（产物仓可写 Deploy Key）、`IMG_DEPLOY_KEY`（独立图片仓可写 Deploy Key）；若存在多个同名站点设置数据库，可额外设置 `NOTION_SETTINGS_DATA_SOURCE_ID` 精确指定。
- 设置同步会拒绝把 `appKey`、`masterKey`、`token`、`secret`、`password` 等真实敏感值写入公开仓库；此类值应通过 GitHub Secrets / 环境变量注入。YAML 解析错误不会回显可能含敏感值的原文片段。

## 许可

站点文章与代码除第三方组件外归站长所有；主题 [CBMIM theme](https://github.com/ShenDoyle/CBMIM-theme) 基于 GPL-3.0 派生，版权链见其 `NOTICE.md`。
