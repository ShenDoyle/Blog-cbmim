# Notion 内容后台 · 结构与导入设计

> 状态：**已实施并稳定运行**。本文保留当前结构与转换约定，作为新增文章、页面和设置项时的设计参考；首次导入工具和中间产物已清理，历史记录以 Git 历史为准。

## 一、目标结构

Notion 用父页面组织内容：

```text
CBMIM 博客
├── 🗂 博文              文章数据库
├── 📄 页面              独立页面与结构化数据
└── ⚙️ 站点设置          主题覆盖配置
```

数据流：

```text
Notion → GitHub Actions → source/ 生成文件 → Hexo → GitHub Pages → ESA → cbm.im
```

生产同步、构建和发布均在 GitHub Runner 完成，不依赖本机常驻服务。

## 二、博文字段

| 字段 | 类型 | Hexo 字段 | 说明 |
|---|---|---|---|
| 标题 | 标题 | `title` | 必填 |
| Slug | 文本 | 文件名 | 锁定后不改，保持 URL 稳定 |
| 日期 | 日期 | `date` | 按东八区格式化 |
| 分类 | 单选 / 多选 | `categories` | 支持单分类与多分类 |
| 标签 | 多选 | `tags` | — |
| 封面 | 文件与媒体或 URL | `cover` | Notion 图自动落地；推荐 1600×700 webp |
| 摘要 | 文本 | `ai` | 多行生成多条摘要 |
| 置顶 | 现有设置项 | `top_group_index` | 空 = 不置顶 |
| 发布 | 复选框 | — | 未勾选只提示，不自动删除本地文件 |
| 页面 ID | 文本 / 托管标记 | `notion_page_id` | 由脚本维护，不要手改 |

可选文章配置：侧栏、目录、评论、关键词、头图。封面文字层使用封面标题、封面副标题、蒙版强度三个字段。

### 封面规则

- 三处文字配置全空：显示原图。
- 任一填写：启用主题蒙版与文字层。
- 封面标题建议不超过 8 字，封面副标题建议不超过 14 字。
- 蒙版强度支持 0~1 或 0~100；`0` 表示不加蒙版。
- 未填封面时使用主题默认封面，不增加自定义兜底。

## 三、正文转换

| Notion 写法 | 站点结果 |
|---|---|
| Callout | `{% note default / info / primary / success / warning / danger %}` |
| Toggle | `{% hideToggle 标题 %}` |
| 第一条分割线 | 摘要截断 `<!--more-->` |
| 单独一行 `[more]` | 摘要截断 `<!--more-->` |
| 图片 | 下载到 `source/img/cbmim/<slug>/`，改写为同源 `/img/cbmim/<slug>/...` |
| 代码块 / 表格 / 引用 / 待办 | 对应 Markdown |
| 子页面 / 子数据库 | 忽略并提醒，需要拆成独立文章 |

Notion 图床链接约一小时过期，必须同步下载。外部非 Notion 图片保持原样。历史本站 jsDelivr 图片 URL 在同步落盘前归一为 `/img/`，构建期不再重写本站图片地址。

## 四、独立页面与数据

「📄 页面」库使用页面名称、路径、说明、发布四个字段。

| 类型 | 示例 | 处理方式 |
|---|---|---|
| Markdown 正文 | `/cc/`、`/privacy/` | 只替换正文，保留本地 front-matter |
| YAML / JSON 数据 | `link.yml`、`equipment.yml`、`about.yml` | Notion 页面放一个代码块，逐字写回 `source/_data/` |
| 主题自动生成页 | 音乐、标签、分类 | 不纳入 Notion 内容管理 |
| 交互代码 | `source/js/link-gate.js` | 保留在源码仓 |

路径必须位于 `source/` 下，并以 `.md`、`.yml` 或 `.json` 结尾。`bangumis.json` 由插件生成，不纳管。

## 五、站点设置

Notion「⚙️ 站点设置」是主题覆盖配置的唯一值来源：

```text
_config.yml                       Hexo 核心配置
主题包 _config.yml                 默认值与 schema
Notion「值」列                     唯一站点覆盖值
source/_data/site-settings.yml     自动生成的审计快照
```

- 留空使用主题默认值。
- 「启用」已废弃，不参与取值。
- 保留 `false / 0 / null / [] / {}` 精确类型；空字符串写 `""`。
- 未知扩展键允许，核心黑名单键与危险路径拒绝。
- `.notion-settings-only` 必须存在，旧 `_config.cbmim.yml*` 变体禁止存在。

## 六、首次导入记录

首批 **25 篇文章**已从本地 Markdown 导入 Notion，覆盖正文、日期、分类、标签、摘要、置顶与封面；版权、隐私、关于等页面与结构化数据也已纳管。

首次导入产生的 `tools/_import/`、`notion-import-prep.mjs` 和 `notion-link-existing.mjs` 已删除。今后新增文章直接在 Notion 博文库创建，不需要重新导入。

## 七、一致性与安全约束

- 文件名 / Slug 锁定，避免标题修改改变 URL。
- 文章与页面分别使用 `last_edited_time` 增量状态。
- 只增改，不自动删除文章或页面。
- 取消发布只提示；删除线上内容需要显式处理本地文件。
- Slug 改变时，先确认旧文件仍由同一 Notion 页面托管再删除。
- 不同步真实密钥；敏感配置使用 GitHub Secrets / 环境变量。
- 每次发布前运行离线自检、完整构建与第三方资源检查。

## 八、当前文件入口

| 文件 | 作用 |
|---|---|
| `tools/notion-sync.mjs` | 文章同步 |
| `tools/notion-pages-sync.mjs` | 页面与数据同步 |
| `tools/notion-settings.mjs` | 站点设置同步 |
| `tools/notion/assets.mjs` | 图片落地、同源改写、孤儿清理 |
| `tools/notion-selftest.mjs` | 转换与源码 URL 回归 |
| `.github/workflows/notion-publish.yml` | 自动同步、构建、发布 |
| `.github/workflows/site-monitor.yml` | 可用性监控 |
