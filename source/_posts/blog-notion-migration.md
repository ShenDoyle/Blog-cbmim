---
title: 把博客搬进 Notion：一次完整的后台迁移实录
date: 2026/09/26 08:00:00
updated: 2026/09/27 22:43:00
cover: https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/cover.webp
categories: 技术
tags:
  - Notion
  - Hexo
  - GitHub Actions
ai:
  - 把博客后台从本地 Markdown + 手动部署整套搬进 Notion 的完整实录：链路设计、同步脚本的关键设计、踩过的坑，以及为什么封面最佳分辨率是 1600×700。
covertitle: 把博客搬进 Notion
coverset: 一次完整的后台迁移实录
coverdim: 0.46
notion_page_id: 3e77adb0-e2e0-81c7-8d96-c5f700a89ada
---

把博客后台从「本地写 Markdown → 本地构建 → 手动部署」整套搬到了 Notion。这篇记录链路怎么跑、踩了哪些坑，顺便给新链路做一次端到端实测——你正在看的这篇文章，从 Notion 到线上，走的就是它描述的流程。

<!--more-->

## 一、现在的架构：三个仓库 + 一层加速

| 仓库                                                 | 角色                   | 说明                                                                       |
| -------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| Blog-cbmim                                         | 源码仓（唯一需要手改的地方）       | Hexo 站点源码、source/ 内容、scripts/ 构建脚本、tools/ Notion 同步脚本、GitHub Actions 工作流 |
| CBMIM-theme                                        | 主题仓                  | 主题源码，公开。站点通过 npm 依赖 hexo-theme-cbmim 引用，改主题在这里提交后更新依赖                    |
| [ShenDoyle.github.io](http://shendoyle.github.io/) | 产物仓（GitHub Pages 源站） | 只放构建产物，绑 CNAME [cbm.im](http://cbm.im/)，由部署步骤强推覆盖，不要手改                   |
| Vercel                                             | 前置加速层                | 不参与构建，只是给 GitHub Pages 套一层 CDN 缓存                                        |

> 为什么源码和产物必须分两个仓？因为部署用的是 git push --force，放一个仓里，第一次部署就会把源码覆盖掉。

{% note danger %}
产物仓当「只读」看待：任何手改都会被下一次部署覆盖，所有改动都走源码仓。
{% endnote %}

## 二、发布是怎么跑起来的

整条链路只有一个构建者：**Notion 是内容源，GitHub Actions 是唯一的构建与发布者。**

```
Notion 文章 / 页面 / 设置
        │  npm run notion:sync / notion:pages / notion:settings
        ▼
写回 source/（含图片落地）→ 提交回源码仓
        │
        ▼
hexo generate → hexo deploy → 强推产物仓 → Pages → cbm.im
```

触发方式三种：

| 触发              | 行为                          |
| --------------- | --------------------------- |
| push 到 main     | 立刻构建并部署——改主题、改脚本、改配置，推上去就上线 |
| 每 6 小时定时        | 只在「Notion 内容有变化」时才构建，避免空跑   |
| 手动 Run workflow | 强制走一遍，手机上也能点                |

这里踩过一个很隐蔽的坑：最初只写了「定时 + 手动」，判定条件是「内容有变化才部署」。结果**源码改动永远不会上线**——我改的是主题和脚本，Notion 内容没动，工作流每次都判定"无需部署"就结束了。表现是本地怎么改都不生效、线上停在几天前的版本。加上 push 触发、再给任务加一句"机器人提交不触发"（防止同步回写形成死循环）之后才真正闭环。

{% hideToggle 怎么快速判断「线上到底是不是最新」？ %}

看产物仓的最后一次提交时间，不要看页面响应头。血泪教训：[cbm.im](http://cbm.im/) 的响应头写着 Server: Vercel，我一度以为站点托管在 Vercel，其实带 Server: [GitHub.com](http://github.com/) 的那次 301 才说明 GitHub Pages 是源站，Vercel 只是前面那层缓存。

{% endhideToggle %}

## 三、在 Notion 里怎么写一篇

1. 在「🗂 博文」库里新建，标题就是文章标题；
2. 填 Slug（即文件名，锁定 URL，**发布后别改**）、日期，勾上发布；
3. 选分类（小卡上显示的就是它）、填标签、摘要（留空则取分割线之前的内容）；
4. 封面：传一张 1600×700 的图，或者留空用主题默认图；
5. 正文正常写，需要截断的位置写一行 [more]（不写会自动插在第一段之后）；
6. 等定时任务，或者去 Actions 点一次 Run workflow。

同步会把每篇落成 source/_posts/&lt;slug&gt;.md，正文之外的元信息写在 front-matter 里。

{% note success %}
只增不删：脚本只改带 notion_page_id 的文件，手写文章永不触碰；Notion 取消勾选「发布」只会提示，不会删掉你的 md。
{% endnote %}

## 四、封面规则（已定稿）

封面分「图」和「文字层」两部分。文字层不是烘焙进图片的，而是前端实时渲染——因为封面在首页大卡、轮播、置顶小卡、侧栏缩略图里被裁成不同比例，烘焙进像素的字在小尺寸下必然糊掉或被切掉。

| 项    | 规则                                                         |
| ---- | ---------------------------------------------------------- |
| 封面图  | 最佳 1600×700（16:7）webp、≤300KB；留空则用主题默认封面图                   |
| 小字   | 固定 [CBM.IM](http://cbm.im/)（品牌署名，不可配）                      |
| 大字   | 封面标题。单行放不下会**自动缩排**，缩到可读下限仍放不下则回退 [CBM.IM](http://cbm.im/) |
| 小卡   | 容器宽 &lt; 300px（轮播 / 侧栏 / 置顶小卡）只显示分类                        |
| 蒙版   | 0~1 或百分数，留空默认 0.46，填 0 表示不加                                |
| 模糊框  | 严格等比复刻设计稿 554×162（圆角、内边距都按卡片宽等比），装不下是加宽而不是改比例              |
| 文章顶图 | 不叠蒙版、不叠文字，只保留背景图                                           |

{% note warning %}
坑一：主题的懒加载占位图不能被当成"没配封面"。 一开始我把 loading.webp（懒加载占位图）和无封面默认图混在一个判断里，结果所有有图的封面在图片加载完成前都被判成"无图"，整站渲染成渐变。

**坑二：pangu.js（盘古之白，主题全站开启）会往文字节点前塞空格。** 它把「[CBM.IM](http://cbm.im/)」和中文标题之间的空格塞进了大字的文本节点，导致临界溢出出现省略号。解法是给文字卡片挂 g_editable="true"，pangu 的忽略判断会整棵跳过。
{% endnote %}

## 五、图片：直接往 Notion 里拖

图片是这次迁移最省事的部分：**Notion 图床的图会在同步时自动下载落地**，正文图和封面图都覆盖。

- 落盘：source/img/cbmim/&lt;slug&gt;/notion-&lt;hash&gt;.&lt;ext&gt;
- 引用：自动改写成 [cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/](http://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/)...
- 外链：不是 Notion 图床的图片原样保留（比如你自己图床的地址）
- 去重：同一张图重复同步不会重复下载

下面这张就是直接拖进 Notion 的，同步时自动落地：

![Vvik_2026-09-27_21-11-42.webp](https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/notion-10d1493be8.webp)

{% note success %}
为什么一定要落地？Notion 的图片是带签名的临时链接，大约 1 小时就过期。直接引用它的地址，文章上线一小时后图就全挂了。
{% endnote %}

## 六、主题设置也搬进了 Notion

主题配置有近 500 个键。与其每次改都去翻 YAML，不如做成一个 Notion 数据库「⚙️ 站点设置」：

- 一行一个键：键 / 值 / 类型 / 分组 / 当前值 / 说明 / 风险 / 启用
- 值留空 = 不覆盖，沿用仓库里的值；勾「启用」且值非空才生效
- 危险键（cdn / lazyload / pjax / pangu 这类影响加载链路的）单独标注；theme / deploy / server 这类连行都不会建
- 同步生成 source/_data/site-settings.yml，构建期合并进主题配置，不重写原始 YAML（回写会丢注释）
- 生效时机：下一次构建

## 七、主题效果展示

下面这些是主题自带效果，逐个实测过渲染。

### 提示块

{% note success %}
success：搞定了。
{% endnote %}

{% note warning %}
warning：注意这里有坑。
{% endnote %}

{% note danger %}
danger：这一步会覆盖产物仓。
{% endnote %}

### 复选框与折叠

- [x] 封面已处理为 1600×700 webp
- [ ] 评论与统计也接入 Notion
- [ ] 还没做的：独立图床仓

{% hideToggle 展开看：部署的门控条件 %}
- 生成的 HTML 不能是空文件；
- 首页与文章页要命中关键内容；
- 封面的元信息文件要能正常生成。

{% endhideToggle %}

### 标签页

{% tabs 构建链路 %}

<!-- tab 本地 -->

改完本地跑 npx hexo server 预览。

<!-- endtab -->

<!-- tab 线上 -->

push 到 main，Actions 自动构建并部署。

<!-- endtab -->

{% endtabs %}

### 时间线

{% timeline 迁移三步 %}

<!-- timeline 第一步 -->

25 篇存量文章导入 Notion。

<!-- endtimeline -->

<!-- timeline 第二步 -->

独立页面与 _data 数据文件纳管。

<!-- endtimeline -->

<!-- timeline 第三步 -->

Actions 接管发布，本地环境退居二线。

<!-- endtimeline -->

{% endtimeline %}

### 按钮与卡片

{% btns %}

{% cell 打开 Notion, https://www.notion.so/, https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/site-avatar.webp %}

{% cell 源码仓库, https://github.com/ShenDoyle/Blog-cbmim, https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/site-avatar.webp %}

{% endbtns %}

{% sitegroup %}

{% site 南城左立方, url=https://cbm.im/, screenshot=https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/notion-10d1493be8.webp, avatar=https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/site-avatar.webp, description=就是本站：运营笔记与 GEO 实践 %}

{% endsitegroup %}

{% hideToggle 这两个标签我一开始写错了 %}

按钮那两处我按别的主题的习惯写了 Markdown 链接语法，结果主题把 [文字](链接) 整串当成了 href，链接是坏的，还退回用外部 CDN 的默认图标；站点卡片我写成了位置参数，而这个主题只认具名参数 url= / screenshot= / avatar= / description=，于是卡片 href 和图片双空，渲染出一张破图卡片。

{% endhideToggle %}

### 行内标签

快捷键 {% kbd Ctrl %}+{% kbd S %}，{% u 下划线 %}，{% emp 着重 %}，{% wavy 波浪线 %}，{% label 标签 blue %}，{% span red, 红色文字 %}。

### 图廊

{% gallery %}

![封面：雨夜搬迁](https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/cover.webp)

![正文配图](https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/body-full.webp)

{% endgallery %}

## 八、复盘

值得记下来的几条：

- **别让"只在内容变化时部署"挡住源码改动**——触发条件要覆盖"配置和代码"这条路径；
- **测量文字宽度不要用 scrollWidth**：文字比容器窄时它返回容器宽度，"是否放得下"的判断会退化成"永远放不下"；要用 Range 量文字本身；
- **flex 列里的文字元素必须给 width:100%**，否则它的 clientWidth 会被收缩成文字自身宽度，同样导致误判；
- **跨主题抄标签语法一定会翻车**：每个主题的标签实现都不一样，用之前先去主题的 scripts/tag 里看一眼签名；
- **同步脚本里"外链原样保留、Notion 图床落地"这条规则很值得**，既不会把你自己的图床地址改坏，又能兜住 Notion 的临时链接。
