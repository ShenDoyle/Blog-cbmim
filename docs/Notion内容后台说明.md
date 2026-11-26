# Notion 内容后台 · 使用说明

站点：https://cbm.im/ ｜ 框架：Hexo 7 + CBMIM theme 1.7.1 ｜ 发布：GitHub Pages → 阿里云 ESA
后台：Notion 数据库（文章 / 页面 / 站点设置） ｜ 触发：GitHub Actions（定时 + 手动）

---

## 零、当前状态（2026-11-26）

Notion 侧结构与首次导入**已经建好**，下面「一次性配置」的第 1、2 步不用再手工做。站点设置正在切换为「Notion 单一值来源」：迁移与校验工具已就绪，实际写入和删除旧 YAML 需要本机临时 Integration token。

| 项 | 值 |
|---|---|
| Notion 根页面 | [CBMIM 博客](https://app.notion.com/p/3e77adb0e2e081148917e6673992874f) |
| 博文库（data source） | `8aee0783-0b53-41e0-861e-0b26993518e3` |
| 页面库（data source） | `b12990b0-b20f-47d5-81a6-6c3096ef4249` |
| 已导入文章 | **25 篇**（全部，含封面 / 日期 / 分类 / 标签 / 摘要 / 置顶） |
| 本地托管标记 | 25 篇 `source/_posts/*.md` 已写入 `notion_page_id` |
| slug → 页面 ID 映射 | `tools/_import/page-ids.json` |

**生产环境不需要本地 Token 或 Node**：给同步脚本一个 Notion **Integration token**（OAuth 连接器那个 token 不能给脚本用），并把它写入 GitHub repository Secrets：

1. https://www.notion.so/profile/integrations → **New integration** → Internal → 拿 `ntn_` 开头的 token
2. 打开 Notion 里的「CBMIM 博客」页面 → 右上角 `···` → **连接** → 选中刚建的 Integration（父页面连上，下面的两个库自动生效）
3. 在仓库 Settings → Secrets and variables → Actions 中配置 `NOTION_TOKEN` 与 `NOTION_DATABASE_ID`
4. 在 Actions 手动运行 **拉取 Notion → 构建 → 发布**；本机 `.env` 与 npm 命令只作为可选开发排障工具

> ⚠️ `npm run notion:sync` 会用 Notion 侧内容**重写**这 25 篇的 front-matter（字段顺序会变、`updated` 会更新为 Notion 的最后编辑时间）。
> 执行前先 `git status` 确认工作区干净，跑完用 `git diff` 检查，不满意直接 `git checkout -- source/_posts` 回滚。

---

## 一、原理（一眼看懂）

```
Notion 数据库 ──①同步脚本──▶ source/_posts/*.md / source/_data/* ──②hexo 构建──▶ public/ ──③推送──▶ GitHub Pages → ESA
   （文章/页面/设置） notion-sync / pages / settings      （自动生成）                    （自动上线 cbm.im）
```

- **主题、样式、所有功能零改动**：脚本不碰 `themes/anzhiyu/`、`_config.yml`、`_config.anzhiyu.yml`。
- **接管文章、独立页面/数据与站点设置**：Notion 是内容与站点覆盖配置的唯一后台。
- **手写文章不受影响**：文章脚本只管理 front-matter 里带 `notion_page_id` 的文件。
- **不再使用第二份站点主题 YAML**：`_config.yml` 仅保留 Hexo 核心配置，主题默认值来自主题包，站点覆盖值只来自 Notion「值」列。
- **平时不用开电脑**：Notion 改完，最多 6 小时后自动上线；也能手动点一下立刻发。

---

## 二、一次性配置

### 1. Notion 侧

1. 打开 https://www.notion.so/profile/integrations → **New integration** → 类型选 Internal → 拿到 **token**（`ntn_` 开头）。
   > token 只存到 GitHub Secrets / 本机环境变量，**不要写进代码、不要贴到聊天里**。
2. 新建一个数据库（表格视图即可），按下面的字段表建属性：

| 属性名 | 类型 | 必填 | 说明 |
|---|---|---|---|
| 标题 | Title | ✅ | 文章标题 |
| Slug | 文本 | ✅ | 文件名，**决定文章 URL**，一旦发布不要再改 |
| 日期 | Date | ✅ | 发布时间；改了 URL 会变 |
| 分类 | 单选 | | 对应 `categories`；只填一个时按字符串输出 |
| 标签 | 多选 | | 对应 `tags` |
| 封面 | 文件与媒体 或 URL | | 对应 `cover`，图会下载落地 |
| 置顶 | **下拉（9/7/5/3/1）** | | 对应 `top_group_index`，数字越大越靠前；空 = 不置顶 |
| 摘要 | 文本 | | 对应 `ai`；**多行 = 多条摘要** |
| 发布 | 复选框 | ✅ | 勾选才生成文章，用来做草稿箱 |
| 封面标题 | 文本 | | 对应 `covertitle`，配合现有封面蒙版脚本 |
| 封面副标题 | 文本 | | 对应 `coverset` |
| 蒙版强度 | 数字 | | 对应 `coverdim`，0~1 或 0~100 |
| 封面底图 | 文件与媒体 或 URL | | 对应 `cover_base` |

> 字段名可以改（中英文都认），候选名单在 `tools/notion/config.mjs` 的 `PROPS` 里。

3. 在数据库页面右上角 **··· → 连接 → 添加你的 Integration**（不加这一步会报 `object_not_found`）。
4. 从浏览器地址栏复制数据库 ID：`notion.so/xxxx?v=<这一串 32 位>`。

### 2. GitHub 侧

1. 新建**源码仓库**，例如 `ShenDoyle/blog-source`（建议 public，Actions 免费不限量），把本站源码推上去。
   主站仓 `ShenDoyle.github.io` 从此**只放生成的网页**。
2. 分别为产物仓和图片仓生成部署密钥（本机执行）：

   ```bash
   ssh-keygen -t ed25519 -C "cbmim pages deploy" -f ~/.ssh/cbmim_pages_deploy -N ""
   ssh-keygen -t ed25519 -C "cbmim images deploy" -f ~/.ssh/cbmim_images_deploy -N ""
   ```

   - `cbmim_pages_deploy.pub` → **ShenDoyle.github.io → Settings → Deploy keys → Add**，勾选 Allow write access；私钥存入源码仓 Secret `DEPLOY_KEY`。
   - `cbmim_images_deploy.pub` → **ShenDoyle/img → Settings → Deploy keys → Add**，勾选 Allow write access；私钥存入源码仓 Secret `IMG_DEPLOY_KEY`。

3. 再配置以下 Secrets：

   | Secret 名 | 值 |
   |---|---|
   | `NOTION_TOKEN` | 第 1 步拿到的 token |
   | `NOTION_DATABASE_ID` | 第 2.4 步复制的数据库 ID |
   | `DEPLOY_KEY` | 产物仓私钥全文 |
   | `IMG_DEPLOY_KEY` | 图片仓私钥全文 |

4. 完成。Actions 页会出现「Notion 同步并发布」，点 **Run workflow** 跑第一次。

> 注意：GitHub 的定时任务在仓库连续 60 天没有任何提交后会被自动停用；届时进 Actions 页面手动点一次即可恢复。

---

## 三、日常写作规范

### 摘要截断

想控制首页显示的摘要长度，正文里**两种写法都认**：

| 写法 | 说明 |
|---|---|
| 插入一条**分割线**（Notion 输入 `---`） | 推荐。页面上一目了然 |
| 单独一行写 `[more]` | 兼容写法，转出来同样是 `<!--more-->` |

规则：取**第一条**分割线作为截断点，它之后的分割线保持原样。
**都不写的话脚本会自动插在第一段之后**，并在日志里提醒。

### 提示框（callout → 主题 note）

用 Notion 的 **Callout** 块，按颜色自动映射成主题的 note 样式：

| Notion Callout 颜色 | 生成的标签 | 效果 |
|---|---|---|
| 灰 / 默认 / 棕 | `{% note default %}` | 灰色提示 |
| 蓝 | `{% note info %}` | 蓝色信息 |
| 紫 | `{% note primary %}` | 紫色主色 |
| 绿 | `{% note success %}` | 绿色成功 |
| 黄 / 橙 | `{% note warning %}` | 黄色警告 |
| 红 / 粉 | `{% note danger %}` | 红色危险 |

图标是这些 emoji 且颜色为灰时，也会按 emoji 判定：
`💡ℹ️→info`、`✅→success`、`⚠️→warning`、`❗❌🚫🔥→danger`、`📌→primary`。

**想精确控制**，在 callout 正文第一行写指令：

```
[note:danger]            → 强制红色危险样式
[note:warning no-icon]   → 强制警告且不显示图标
[note:success 已完成]     → 强制成功样式，并把「已完成」作为加粗小标题
```

可选类型：`default / primary / info / success / warning / danger`。

### 折叠块（toggle → 主题 hideToggle）

Notion 的 **Toggle** 块会自动转成主题的折叠面板，标题取 toggle 的标题行。

> 不支持嵌套折叠（Hexo 标签不支持同名嵌套）。真用了嵌套，内层会保留原生 HTML —— 功能正常，样式朴素，日志会提醒。

### 图片

- **Notion 里的图片会被自动下载**到 `source/img/cbmim/<slug>/`，并改写成 jsDelivr CDN 地址。
  为什么必须这样做：Notion 的图片链接约 1 小时后失效，直接引用迟早 404。
- 已经在用外链图片（非 Notion 图床）的，脚本**原样保留**，不动。
- 封面图（`封面` 属性或页面封面）同样会落地，规则一致。

### 支持的与不支持的

| Notion 内容 | 结果 |
|---|---|
| 标题 1/2/3、段落、加粗斜体删除线、行内代码、链接 | ✅ 正常 |
| 无序 / 有序列表、待办列表、引用、分割线 | ✅ 正常 |
| 代码块（含语言高亮）、表格、公式 | ✅ 正常 |
| Callout、Toggle、图片、文件 / 视频 / 书签链接 | ✅ 正常 |
| 子页面、子数据库 | ⚠️ 内容被忽略（日志提醒），需拆成独立文章 |
| 同步块（synced block）、数据库视图、Notion AI 块 | ⚠️ 不渲染 |
| 分栏（columns） | ➖ 变成顺序排列 |

---

### 站点设置（Notion 单一值来源）

在 Notion「⚙️ 站点设置」只编辑「值」列：

- 留空 = 使用主题包默认值；填了才覆盖。
- 「启用」已废弃，不参与取值；关闭功能请填 `false`。
- `false / 0 / null / [] / {}` 保留精确类型；空字符串写 `""`。
- 「当前值 / 说明 / 优先级 / 类型 / 分组 / 风险」是自动生成列，不要手改。
- 设置同步生成 `source/_data/site-settings.yml`，构建脚本在 `before_generate` 优先级 2 合并；文件缺失、损坏、空配置、黑名单键或危险路径都会让构建失败。

旧 `_config.cbmim.yml` 的一次性迁移全程在 GitHub Actions 执行：

1. 运行 **Notion 站点设置云端迁移**，`mode=preview`，只预览合并计划。
2. `mode=migrate`、`confirmation=MIGRATE`，写入 Notion、逐叶校验、构建并提交设置快照；旧 YAML 暂不删除。
3. `mode=finalize`、`confirmation=FINALIZE`，重新同步 Notion 并确认与快照完全一致，然后删除旧 YAML、构建并触发正式发布。

成功后产生 `.notion-settings-only`，CI 拒绝任何 `_config.cbmim.yml*` 变体。重试基线在写入 Notion 前创建，使用 Notion Token 加密后保存为保留期 30 天的 Actions artifact，finalize 成功后删除；不需要本机 `.cbmim-migration/`。迁移快照暂存于 `source/_data/site-settings.migration.yml`，finalize 一致后才替换正式生成物并删除旧 YAML。

## 四、本机排障命令速查（可选，不是网站依赖）

```bash
# 仅在本机排障时：把令牌放进 .env（不会被提交）
cp .env.example .env      # 然后填入 NOTION_TOKEN 和 NOTION_DATABASE_ID

# 离线自检（不需要令牌，验证转换规则）
npm run notion:selftest

# 预览：只打印将要做什么，不写文件
npm run notion:preview

# 正式同步文章 / 页面 / 站点设置（读 .env，或读系统环境变量）
npm run notion:sync
npm run notion:pages
npm run notion:settings

# 强制全量重写（怀疑状态文件出错时用）
npm run notion:sync -- --force

# 只处理某一篇（调试）
npm run notion:sync -- --only my-post-slug --verbose

# 本地一条龙：同步文章 / 页面 / 设置 → 构建 → 部署（不用 Actions 时）
npm run publish
```

`notion:settings` 在 `.notion-settings-only` 存在前会主动跳过，避免迁移窗口内覆盖旧配置；只有云端 finalize 的一致性校验使用 `--force`。本机命令仅用于开发排障，生产迁移与发布仍全部在 GitHub Actions 执行。

**首次导入相关（已完成，留档备用）**

```bash
# 本地文章 → Notion 导入包（tools/_import/<slug>.json）
npm run notion:prep

# 把 tools/_import/page-ids.json 的映射回写进 md 的 notion_page_id
npm run notion:link -- --dry-run    # 先看会改什么
npm run notion:link                 # 实际写入
```

> 生产环境统一使用 GitHub repository Secrets，不依赖本机 `.env`。本机排障时令牌优先级为系统环境变量 > `.env`；`.env` 已在 `.gitignore` 里，不会进仓库。

### 增量与安全规则

- `.notion-sync-state.json` 记录每篇的 `last_edited_time`，**没改过的整篇跳过**（不重下图片、不产生噪音 diff）。
- **只增改，不自动删除**：Notion 里取消「发布」或删页面，本地文章保留，只在日志里列出提醒你。
- **Slug 与日期锁定**：URL 只由 Notion 的 `Slug` + `日期` 决定。Slug 留空时会沿用历史文件名；确实是新文章才用标题生成，并在日志里提醒补填。
- 改 Slug 会删掉对应的旧 md 文件（避免同一篇出现两个 URL），删之前会确认那是脚本托管文件。

---

## 五、排错

| 现象 | 原因 / 处理 |
|---|---|
| `缺少环境变量：NOTION_TOKEN` | 本地跑要先设环境变量；Actions 里检查 Secrets |
| `object_not_found` | 数据库没「连接」到 Integration，或 `NOTION_DATABASE_ID` 填错 |
| `unauthorized` | token 不对，或 Integration 没被授权 |
| 文章没生成 | 检查「发布」是否勾选 |
| 图片 404 | 图片不是 Notion 图床而是外部链接，且原站挂了；或图片下载当时失败（看日志） |
| 首页摘要不对 | 在 Notion 正文里加一行 `[more]` 指定位置 |
| 提示框变成了普通引用 | Callout 的颜色没映射到，用 `[note:xxx]` 指令强制 |
| 折叠块样式没生效 | 用了嵌套折叠，内层保留原生 HTML |
| 定时任务不跑了 | GitHub 60 天无提交会停用定时任务，手动跑一次恢复 |
| 构建失败且提到 douban | 豆瓣抓取超时，工作流已内置一次重试；仍失败就等下次 |

---

## 六、涉及的文件

| 路径 | 作用 |
|---|---|
| `tools/notion-sync.mjs` | 文章同步入口（CLI） |
| `tools/notion-pages-sync.mjs` | 独立页面与数据文件同步（CLI） |
| `tools/notion-settings.mjs` | 站点设置同步、旧 YAML 迁移与校验（CLI） |
| `scripts/apply-site-settings.js` | 构建期应用 Notion 设置；缺失/空/危险配置直接失败 |
| `tools/notion-selftest.mjs` | 文章转换离线自检 |
| `tools/notion-import-prep.mjs` | 本地文章 → Notion 导入包（首次导入用） |
| `tools/notion-link-existing.mjs` | 把 `notion_page_id` 回写进 md（首次导入用） |
| `tools/_import/` | 首次导入的中间产物：`<slug>.json` + `page-ids.json` |
| `tools/notion/config.mjs` | 字段名候选、路径、图片命名空间、颜色映射 |
| `tools/notion/api.mjs` | Notion API 访问（兼容 v5 新接口） |
| `tools/notion/render.mjs` | 区块 → Markdown + 主题语法映射 |
| `tools/notion/convert.mjs` | 属性 → front-matter、日期、YAML、摘要截断 |
| `tools/notion/assets.mjs` | 图片下载落地 + CDN 改写 |
| `tools/notion/state.mjs` | 增量状态与磁盘自愈 |
| `.github/workflows/notion-publish.yml` | 定时 / 手动发布流水线 |
| `.notion-sync-state.json` | 文章增量状态（**需要提交**） |
| `source/_data/site-settings.yml` | Notion 站点设置生成物（**需要提交**） |
| `.notion-settings-only` | 迁移完成标记；禁止旧主题 YAML 变体 |
| `.env.example` | 可选的本机排障令牌模板；生产环境只使用 GitHub Secrets（`.env` 不进仓库） |

**不改动**：`themes/**`（主题定制版另存于 [CBMIM-theme](https://github.com/ShenDoyle/CBMIM-theme)）、`_config.yml`。旧 `_config.cbmim.yml` 仅在迁移窗口内存在，校验通过后删除且不留同名备份。

**关于原有 25 篇文章**：正文与 front-matter 全部原样保留，只多了一行 `notion_page_id`（首次导入的托管标记）。
所以它们**现在是 Notion 托管的**——第一次跑 `notion:sync` 会按 Notion 侧内容重写一次（内容等价，字段顺序会变）。
若不想让某篇被托管，删掉那一行 `notion_page_id` 即可。
