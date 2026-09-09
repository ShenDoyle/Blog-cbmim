---
title: Hexo 常用的命令
date: 2021/01/07 20:00:00
updated: 2021/01/07 20:00:00
cover: https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/source/img/cbmim/hexocommand/2024215171707989443076time_hexo_command.webp
categories: 技术
tags:
    - 博客
ai: 
    - 这篇文章是作者记录 Hexo 使用过程中常忘记的命令和修改参数的方法。作者提供了问题解决渠道、常用命令（如生成网站、本地预览、部署等）、清理缓存、创建文章和检查版本等操作，以及文章格式的头部和摘要模板。这些指南可以帮助作者更顺利地使用 Hexo。
    - 这篇文章记录了作者使用Hexo时常用的命令和修改参数方法，包括生成网站、本地预览、部署等操作，以及文章头部和摘要模板。这些指南有助于作者更有效地利用Hexo。
---

用 Hexo 的时间不是很长，但是用了一段时间真的非常喜欢。不过由于 Github 使用不是很熟练，所以经常过一段时间不用就忘了命令和一些常需要修改的参数，所以在这篇文章里面记录下来。

<!--more-->

## 问题解决渠道

[hexo 皮肤Github](https://github.com/theme-nexmoe/hexo-theme-nexmoe)

[hexo 主题使用说明](https://docs.nexmoe.com/)

[hexo 皮肤预览](https://r9.cm/)

[hexo 官网使用说明](https://hexo.io/zh-cn/docs/commands.html)

## 最常用

- 生成网站

`hexo g` # 生成全站静态文件

> ```bash
> hexo generate # 完整写法
> ```
>
> 生成或者更新 `public` 文件夹

- 本地预览

`hexo s` # 启动本地预览服务

> ```bash
> hexo server # 完整写法
> ```
>
> 启动服务器，访问网址： http://localhost:4000/ 进行本地预览。

- 部署

`hexo d` # 部署网站到 `Github` 。

> ```bash
> hexo deploy # 完整写法
> ```
>
> 把本地的网站推送到 `Github` ，完成推送后，需要重新到项目设置处绑定域名。

- 清理缓存

`hexo clean` # 清除缓存文件 (`db.json`) 和已生成的静态文件 (`public`)

> 部分情况（比如更换主题后），发现站点的更改不生效，可以试试运行该命令。

- 创建文章

`hexo n "我的博客"` # 新建文章

> ```bash
> hexo new "我的博客" # 完整写法
> ```
>
> 新建一篇名字为我的博客的文章。我一般是用 **Typora** 写文章，所以这个命令使用的不多。

- 检查版本

`hexo version` # 显示 hexo 版本

## 文章格式

### 头部

```
---
title: # 文章标题
date: # 发表日期
updated: # 更新日期
cover: # 封面图片
categories: # 分类
tags:
    - # 标签
---

```

### 摘要

下列代码前面的内容会被渲染成摘要。

```
<!--more-->
```



