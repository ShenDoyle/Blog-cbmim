<p align="center">
  <a title="Hexo Version" target="_blank" href="https://hexo.io/zh-cn/"><img alt="Hexo Version" src="https://img.shields.io/badge/Hexo-%3E%3D%205.3.0-orange?style=flat"></a>
  <a title="Node Version" target="_blank" href="https://nodejs.org/zh-cn/"><img alt="Node Version" src="https://img.shields.io/badge/Node-%3E%3D%2010.13.0-yellowgreen?style=flat"></a>
  <a title="License" target="_blank" href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-GPL--3.0-blue.svg?style=flat"></a>
  <br>
  <a title="Upstream" target="_blank" href="https://github.com/anzhiyu-c/hexo-theme-anzhiyu"><img alt="Upstream" src="https://img.shields.io/badge/upstream-hexo--theme--anzhiyu-informational?style=flat"></a>
  <a title="Site" target="_blank" href="https://cbm.im/"><img alt="Site" src="https://img.shields.io/badge/site-cbm.im-success?style=flat"></a>
</p>

<p align="center">🇨🇳 中文简体 ｜ 上游原文：<a href="upstream/README.zh-CN.md">中文</a> · <a href="upstream/README.en.md">English</a></p>

# CBMIM theme

**cbm.im（南城左立方）专用主题** —— 基于 [AnZhiYu 安知鱼主题](https://github.com/anzhiyu-c/hexo-theme-anzhiyu)（`hexo-theme-anzhiyu`）的定制版本。

本站仓库：<https://github.com/ShenDoyle/CBMIM-theme>　｜　站点：<https://cbm.im/>

> 本主题是安知鱼主题的**派生作品**，不是新写的主题。全部上游功能、界面、文档一律继承；
> 上游作者署名、贡献者名单、许可证与原始说明均完整保留，见 [NOTICE.md](NOTICE.md) 与 [`upstream/`](upstream/)。

---

## 📌 这个仓库是什么

| 项 | 内容 |
|---|---|
| 基线 | `anzhiyu-c/hexo-theme-anzhiyu` **v1.7.1**（上游 commit `07114b6`，官方主线分支为 **dev**） |
| 内容 | 站点 `anviyu` 实际运行中的主题状态 = 官方基线 + 本站改造（共 **21 个文件**有差异，其余逐字节一致） |
| 用途 | 主题的**版本库与唯一来源**：以后主题改动先在本仓库提交，再同步到站点目录 |
| 可见性 | public |
| 许可证 | **GNU GPL v3.0**（沿用上游，`LICENSE` 未作改动） |

## 🧩 相对上游的改造

| 文件 | 改动 |
|---|---|
| `_config.yml` | 默认图格式 jpg / gif / png → **webp**（`error_img.flink`、`error_img.post_page`、`valine.bg`、`cover.default_cover`） |
| `scripts/events/merge_config.js` | 同上，默认图片路径同步改为 webp |
| `layout/includes/header/index.pug` | **修复独立页面顶部图丢失**：原写法恒用 `home_index_img_bg`，而该变量仅在首页分支赋值，导致 about / link / comments 等页面顶部图不显示 |
| `source/img/` | `404`、`comment_bg`、`default_cover`、`friend_404`、`loading` 转 webp，并删除对应的 5 个旧格式文件 |
| `source/favicon.ico`、`source/img/512.png`、`source/img/siteicon/*` | 替换为本站图标 |
| `README.md`、`NOTICE.md`、`upstream/*` | 本仓库自有文档与上游原文归档，不影响运行时行为 |

> `package.json` 的 **`version` 刻意保持 `1.7.1`**，与上游一致。原因：`scripts/events/cdn.js` 会用该版本号拼 CDN 路径（`...@1.7.1/...`），改动会导致 CDN 资源取不到。

## 💻 安装 / 启用

主题目录名沿用 **`anzhiyu`**，因此站点配置无需改动：

```powershell
# 克隆到站点主题目录
git clone https://github.com/ShenDoyle/CBMIM-theme.git themes/anzhiyu
```

站点 `_config.yml`：

```yaml
theme: anzhiyu
```

> 若缺少渲染器：`npm install hexo-renderer-pug hexo-renderer-stylus --save`

## ⚙ 覆盖配置

主题配置请放在站点根目录的 `_config.anzhiyu.yml`，避免更新主题时丢失。

```bash
cp -rf ./themes/anzhiyu/_config.yml ./_config.anzhiyu.yml
```

- `_config.anzhiyu.yml` 中的配置**优先级高于**主题内 `_config.yml`
- 主题更新后可能新增配置项，升级时需对照上游说明手动同步
- 想把某项覆盖为空，注意**不要删掉主键**

## 🔄 与上游同步

```bash
git fetch upstream
git merge upstream/dev          # 官方主线是 dev 分支，不是 main
```

冲突通常只出现在上面「相对上游的改造」表里的文件——那是本站改造所在处，按**本地优先**处理。

```bash
git remote -v
# origin    git@github.com:ShenDoyle/CBMIM-theme.git
# upstream  https://github.com/anzhiyu-c/hexo-theme-anzhiyu.git
```

## 🚀 应用到站点

站点路径：`~/OneDrive/Backup/GitHub Page/anviyu/themes/anzhiyu`

流程：**本仓库提交 → 同步到站点 `themes/anzhiyu` → 提交站点仓库 → 构建发布（cbm.im）**。

> 后续可选：把站点的 `themes/anzhiyu` 改为指向本仓库的 `git clone` / submodule，实现单一来源，改主题只需改一处。

## 📁 目录结构

```
├── _config.yml            主题默认配置（被站点 _config.anzhiyu.yml 覆盖）
├── layout/                页面模板（pug）
├── scripts/               Hexo 注入器 / 生成器 / 标签插件
│   ├── events/            构建期注入（含 cdn.js、merge_config.js）
│   ├── helpers/           模板助手
│   └── tag/               标签语法（note / hideToggle / tabs / tip 等）
├── source/                主题静态资源（css / js / img / font）
├── languages/             多语言文案
├── upstream/              上游 README 原文归档（中文 / 英文）
├── NOTICE.md              版权归属与修改声明（GPL-3.0 §5）
├── LICENSE                GNU GPL v3.0（上游原文，未改动）
└── README.md              本文件
```

## 📜 许可证与致谢

本项目以 **GNU General Public License v3.0** 发布，派生自 AnZhiYu 主题，许可证与署名均完整保留。

- **AnZhiYu / hexo-theme-anzhiyu**：<https://github.com/anzhiyu-c/hexo-theme-anzhiyu>
- 主题设计：[@张洪 Heo](https://github.com/zhheo)
- 文档编写：[@xiaoran](https://github.com/xiaoran)
- 上游文档：<https://docs.anheyu.com/>
- 源头项目：[hexo-theme-butterfly](https://github.com/jerryc127/hexo-theme-butterfly)

完整归属与逐项修改声明见 **[NOTICE.md](NOTICE.md)**。
