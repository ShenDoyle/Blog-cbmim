# Blog-cbmim · cbm.im 源码仓

cbm.im 博客的 Hexo 源码仓库。文章与页面内容的唯一后台是 **Notion**，发布由 **GitHub Actions** 全自动完成，本地不需要常驻环境。

## 架构一览

```
Notion（唯一内容后台）
  ├─ 🗂 博文     ─┐
  ├─ 📄 页面     ─┤→ GitHub Actions（每 6 小时 / 手动触发）
  │               │     ① 拉取 Notion → 写回 md/yml（本仓库）
  │               │     ② hexo generate
  └─ 变更提交回本仓 ┘     ③ 强推 public/ → ShenDoyle.github.io（GitHub Pages 服务该分支）
                              ↓
                            cbm.im（jsDelivr CDN 供图）
```

- 源码仓（本仓库）与产物仓（`ShenDoyle.github.io`）严格分离——`hexo-deployer-git` 是 force push，共用一仓会覆盖源码。
- 文章图片落地到 `source/img/cbmim/<slug>/`，正文引用 `cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/...`。
- 主题为 npm 依赖 `hexo-theme-cbmim`（github:ShenDoyle/CBMIM-theme#main），本仓库不含主题源码；主题定制通过 `_config.cbmim.yml` 覆盖。

## 怎么更新内容（日常）

| 想改什么 | 在哪改 | 生效时间 |
|---|---|---|
| 发文章 / 改文章 | Notion「🗂 博文」改完勾「发布」 | 最多 6 小时；要立即生效去 Actions 点 Run workflow |
| 版权协议 / 隐私政策 | Notion「📄 页面」对应页面的正文 | 同上 |
| 友链 / 好物 / 关于页等数据 | Notion「📄 页面」对应页面里的 yaml 代码块 | 同上 |

紧急修站也可以本地跑（有 Node 环境时）：

```bash
npm install
npm run notion:sync      # 同步文章
npm run notion:pages     # 同步独立页面与数据文件
npx hexo clean && npx hexo generate && npx hexo deploy
```

## 目录结构

```
├─ _config.yml               # Hexo 主配置（theme: cbmim）
├─ _config.cbmim.yml         # 主题覆盖配置（所有站点级定制都在这里）
├─ .github/workflows/
│  └─ notion-publish.yml     # 自动发布流水线（cron 每 6 小时 + 手动）
├─ scripts/
│  └─ covermeta.js           # 封面效果生成器（covertitle/coverset/coverdim → covermeta.json）
├─ source/
│  ├─ _posts/                # 文章（Notion「🗂 博文」同步落地，front-matter 带 notion_page_id）
│  ├─ _data/                 # 结构化数据（Notion「📄 页面」同步落地，除 bangumis.json 为插件生成）
│  ├─ cc|privacy|about/      # 独立页面（cc/privacy 正文由 Notion 管理）
│  ├─ img/cbmim/             # 文章图片（脚本自动下载落地，jsDelivr 供图）
│  └─ js|css/                # 站点级自定义脚本/样式（封面文字层、友链门禁）
├─ tools/                    # Notion 同步工具链（node tools/…，放这里是因为 Hexo 会执行 scripts/）
│  ├─ notion-sync.mjs        # 文章同步 CLI（--dry-run/--force/--only）
│  ├─ notion-pages-sync.mjs  # 独立页面 + 数据文件同步 CLI
│  ├─ notion-selftest.mjs    # 离线自检（16 项，不需要令牌）
│  └─ notion/                # 同步模块（config/api/render/convert/assets/state/log）
└─ docs/                     # 设计文档（Notion 接入结构、字段说明）
```

## Notion 字段速查（🗂 博文）

必填：标题、Slug（发布后勿改，保 URL）、日期、发布（勾选）。
可选：分类、标签、封面、摘要、置顶（单选 9/7/5/3/1）、页面 ID（脚本回写，勿手改）。

封面三件套（配合 `scripts/covermeta.js`）：

| 字段 | 规则 |
|---|---|
| 封面 | 最佳分辨率 **1600×700（16:7）webp ≤300KB**，主体放画面中部；**留空则显示该文章专属渐变** |
| 封面标题 | **大字**，强制单行：优先显示原文，放不下时在不低于可读下限内自动缩排，缩到下限仍放不下或没填 → 显示 CBM.IM（不截断）。建议 ≤8 字 |
| 封面副标题 | **【已弃用】** 小字固定渲染 **CBM.IM**（品牌署名，与 Cover.psd 默认版式一致），此字段不再影响显示效果，仅保留作触发项 |
| 蒙版强度 | 0~1 或百分数；留空默认 0.46，0 = 不加蒙版。文章顶图不叠蒙版与文字，只显示背景原图 |

**三处全空 = 原图不加效果；任一填写 = 启用主题封面效果（蒙版 + 文字层）。**

文字层（模糊框）尺寸固定为 Cover.psd 默认参数的等比复刻，任何卡片位置一致：宽 72.9% × 高 48.8%、圆角 20/760、内边距 20.75/760，只有字号随容器缩放（小卡片有可读下限）。大字已回退成 CBM.IM 时小字自动隐藏，不会重复出现。

渐变兜底：每篇文章按路径哈希生成一组固定渐变（四色 + 角度，同一篇永远一致、不同篇互不相同），在两种情况下自动生效——① 文章没配封面（主题默认图会被识别并替换）② 封面图加载失败。注意：主题的懒加载占位图（loading.webp）不算"没配封面"，不会误触发兜底。

主题可选配置（留空不写入）：侧栏 / 目录 / 评论（单选 true/false）、关键词（逗号分隔）、头图（URL 或 false）。

## 安全

- `NOTION_TOKEN` 等敏感信息只放本机 `.env`（已 gitignore）与仓库 Secrets，绝不进代码。
- Actions 需要的 Secrets：`NOTION_TOKEN`、`NOTION_DATABASE_ID`、`DEPLOY_KEY`（ShenDoyle.github.io 的可写 Deploy Key）。

## 许可

站点文章与代码除第三方组件外归站长所有；主题 [CBMIM theme](https://github.com/ShenDoyle/CBMIM-theme) 基于 GPL-3.0 派生，版权链见其 `NOTICE.md`。
