---
title: 把博客搬进 Notion：一次完整的后台迁移实录
date: 2026/09/26 08:00:00
updated: 2026/09/27 00:27:00
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

把博客后台从「本地写 Markdown → 本地构建 → 手动部署」整套搬到了 Notion。这篇记录一下迁移做了什么、链路怎么跑、踩了哪些坑——也算给新链路做一次端到端的实测：你现在看到的这篇文章，从 Notion 到线上，走的正是它所描述的流程。

<!--more-->

## 为什么要迁

以前写一篇文章的完整路径是：打开编辑器 → 建 md 文件 → 手写 front-matter → `hexo clean && hexo generate && hexo deploy` → 等构建推完。麻烦倒在其次，真正的问题是**换一台电脑就得重新搭环境**，手机上更是完全没法写。

迁移之后，写作入口只剩一个 Notion 数据库，改完勾一下「发布」，最多 6 小时后线上就更新了；急的话去仓库点一次 Run workflow，一分钟内触发。本地环境只在改主题和配置时才需要。

## 现在的链路长什么样

```yaml
Notion（写作 / 管理）
  ↓ 同步脚本：增量拉取，带字段校验与告警
source/_posts/*.md + source/img/
  ↓ GitHub Actions：每 6 小时 cron，也可手动触发
hexo generate → 构建产物强推到产物仓
  ↓
GitHub Pages → cbm.im
```

源码仓和产物仓是分开的——`hexo-deployer-git` 是 force push，共用一个仓库会把源码直接覆盖掉，这个坑提前绕开了。

## Notion 侧的结构

Notion 里建了「CBMIM 博客」页面，下面两个数据库：

- **🗂 博文**：25 篇存量文章已全部导入，每篇回写 `notion_page_id` 锁定对应关系。字段覆盖标题、Slug、日期、分类、标签、封面、摘要、置顶权重，以及封面标题 / 副标题 / 蒙版强度这套封面效果三件套。
- **📄 页面**：版权协议、隐私政策这类独立页，加上友链、好物、关于页等五个 `_data` 数据文件——YAML 全文放在页面里的代码块，同步时逐字写回仓库。

## 同步脚本做了什么

脚本只认带 `notion_page_id` 的文件，手写的文章永远不会被碰。几个关键设计：

1. **增量同步**：按 Notion 的 `last_edited_time` 判断，没改过的文章直接跳过；
2. **Slug 与日期一旦确定就锁定**，防止文章 URL 悄悄变化；
3. **图片立即下载落地**到仓库并改写成本地路径——Notion 的图片链接大约一小时就过期，不能直接引用；
4. **只增改不删**：取消「发布」只提示、不动文件，删文章永远是人手动确认的事。

## 踩过的坑

| 坑                 | 现象                | 解法                         |
| ----------------- | ----------------- | -------------------------- |
| MCP 桥接数字序列化       | 「置顶」NUMBER 属性写不进去 | 改成 SELECT（9/7/5/3/1）       |
| shallow clone 推空仓 | `unpack failed`   | 先 `fetch --unshallow` 补全历史 |
| Notion 图片链接过期     | 约 1 小时失效          | 同步时立即下载落地到仓库               |
| README 手改撞车       | push 被拒           | rebase 取完整重写版              |

## 图片怎么处理

封面最佳分辨率是 **1600×700（16:7）的 webp**——按主题各展示位的裁切逻辑反推出来的：文字层设计画布是 760×332，1600×700 正好是它的两倍，retina 下足够清晰；首页卡片、置顶小卡都是居中裁切，主体内容放画面中部就稳。

本文的封面和下图就是这么处理的：原图是 7680×4320，按 16:7 中心裁切再缩到 1600×700，因为大面积暗色场景压缩率极高，整张图只有 20KB。

![雨夜里抱着纸箱的电脑人](https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/blog-notion-migration/body-full.webp)

## 之后怎么写文章

手机或电脑打开 Notion → 「🗂 博文」新建一行 → 填标题、Slug、日期 → 正文随便写 → 勾「发布」→ 等 Actions。本地环境不再是必需品，但依然保留：改主题、改配置、大重构时还是本地顺手。

## 结语

这次迁移最满意的不是省掉了哪条命令，而是**写作和发布彻底解耦**：Notion 负责内容，GitHub 负责构建，两边靠一个同步脚本对话。后面打算把「📄 页面」库也补满，再把评论和统计的配置收进 Notion 管——慢慢来。
