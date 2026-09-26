# Notion 内容后台 · 使用说明

站点：https://cbm.im/ ｜ 框架：Hexo 7 + anzhiyu 1.7.1 ｜ 发布：GitHub Pages
后台：Notion 数据库 ｜ 触发：GitHub Actions（定时 + 手动）

---

## 一、原理（一眼看懂）

```
Notion 数据库 ──①同步脚本──▶ source/_posts/*.md ──②hexo 构建──▶ public/ ──③推送──▶ GitHub Pages
   （写文章）     notion-sync.mjs   （自动生成）                    （自动上线 cbm.im）
```

- **主题、样式、所有功能零改动**：脚本不碰 `themes/anzhiyu/`、`_config.yml`、`_config.anzhiyu.yml`。
- **只接管「文章」**：关于页、留言板、友链、豆瓣书影、追番、音乐列表继续手工维护。
- **手写文章不受影响**：脚本只管理 front-matter 里带 `notion_page_id` 的文件。
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
| 置顶 | 数字 | | 对应 `top_group_index`，数字越大越靠前 |
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
2. 生成部署密钥（本机执行）：

   ```bash
   ssh-keygen -t ed25519 -C "blog-source deploy" -f ~/.ssh/blog_source_deploy -N ""
   ```

   - 公钥 `~/.ssh/blog_source_deploy.pub` → 贴到 **ShenDoyle.github.io → Settings → Deploy keys → Add**，并**勾选 Allow write access**。
   - 私钥文件内容 → 源码仓 **Settings → Secrets and variables → Actions → New repository secret**，名字 `DEPLOY_KEY`。

3. 再加两个 Secrets：

   | Secret 名 | 值 |
   |---|---|
   | `NOTION_TOKEN` | 第 1 步拿到的 token |
   | `NOTION_DATABASE_ID` | 第 2.4 步复制的数据库 ID |
   | `DEPLOY_KEY` | 上一步的私钥全文（含 `-----BEGIN/END-----` 两行） |

4. 完成。Actions 页会出现「Notion 同步并发布」，点 **Run workflow** 跑第一次。

> 注意：GitHub 的定时任务在仓库连续 60 天没有任何提交后会被自动停用；届时进 Actions 页面手动点一次即可恢复。

---

## 三、日常写作规范

### 摘要截断

想控制首页显示的摘要长度，在正文里**单独一行写**：

```
[more]
```

要求：这一行独占一个段落（前后空行）。转出来就是 Hexo 的 `<!--more-->`。
**不写的话脚本会自动插在第一段之后**，并在日志里提醒。

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

## 四、命令速查

```bash
# 首次：把令牌放进本机 .env（不会被提交）
cp .env.example .env      # 然后填入 NOTION_TOKEN 和 NOTION_DATABASE_ID

# 离线自检（不需要令牌，验证转换规则）
npm run notion:selftest

# 预览：只打印将要做什么，不写文件
npm run notion:preview

# 正式同步（读 .env，或读系统环境变量）
npm run notion:sync

# 强制全量重写（怀疑状态文件出错时用）
npm run notion:sync -- --force

# 只处理某一篇（调试）
npm run notion:sync -- --only my-post-slug --verbose

# 本地一条龙：同步 → 构建 → 部署（不用 Actions 时）
npm run publish
```

> 令牌优先级：系统环境变量 > `.env`。`.env` 已在 `.gitignore` 里，不会进仓库；
> 想更安全就只放 GitHub Secrets，本地不用 `.env`。

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
| `tools/notion-sync.mjs` | 同步入口（CLI） |
| `tools/notion-selftest.mjs` | 离线自检（14 项断言） |
| `tools/notion/config.mjs` | 字段名候选、路径、图片命名空间、颜色映射 |
| `tools/notion/api.mjs` | Notion API 访问（兼容 v5 新接口） |
| `tools/notion/render.mjs` | 区块 → Markdown + 主题语法映射 |
| `tools/notion/convert.mjs` | 属性 → front-matter、日期、YAML、摘要截断 |
| `tools/notion/assets.mjs` | 图片下载落地 + CDN 改写 |
| `tools/notion/state.mjs` | 增量状态与磁盘自愈 |
| `.github/workflows/notion-publish.yml` | 定时 / 手动发布流水线 |
| `.notion-sync-state.json` | 增量状态（**需要提交**） |
| `.env.example` | 本机令牌模板；复制成 `.env` 后填入（`.env` 不进仓库） |

**不改动**：`themes/anzhiyu/**`、`_config.yml`、`_config.anzhiyu.yml`、`source/_posts/` 里原有的 25 篇手写文章。
