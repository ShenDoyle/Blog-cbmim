---
title: jsDelivr 的使用方法
date: 2020/11/27 20:00:00
updated: 2020/11/27 20:00:00
cover: https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/source/img/cbmim/jsDelivr/2024215171707989444076time_jsDelivr.webp
categories: 技术
tags:
    - 前端
ai: 
    - 这篇文章介绍了jsDelivr公共CDN服务的使用方法。它支持通过npm、github和wordpress加速访问资源。示例展示了不同资源加载方式的URL格式，包括加载npm包、github项目分支和wordpress插件/主题。该指南可以帮助站长有效地利用 jsDelivr 提升网站的访问速度和节省CDN流量。
    - 这篇文章介绍了 **jsDelivr** 公共CDN服务的使用方法，支持npm、github和wordpress资源加载。展示了加速资源访问的URL格式，有助于站长优化网站访问速度和节省CDN流量。
---

**jsDelivr** 是一款免费开源的公共 CDN 服务，很多站长会把网站的静态文件通过 **jsDelivr** 加速来访问，这样既实现了对网站的加速，又能节约不少网站 CDN 的流量，可谓是神器。

<!--more-->

## 使用

**jsDelivr** 官网：[jsDelivr - A free, fast, and reliable CDN for open source](https://www.jsdelivr.com/)

进入 **jsDelivr** 的官网，我们能看到首页有三个网站，可以使用 jsDelivr 加速资源访问，分别是：nmp、github、wordpress，这里我们逐一做下说明。

### nmp

~~~web-idl
// 加载npm上托管的项目

https://cdn.jsdelivr.net/npm/package@version/file

https://cdn.jsdelivr.net/npm/包名@版本号/目录

// 例如，加载jQuery v3.2.1版本

https://cdn.jsdelivr.net/npm/jquery@3.2.1/dist/jquery.min.js

// 或者加载jquery目录

// 提示：目录后面的"/"不能省略，否则无法访问

https://cdn.jsdelivr.net/npm/jquery/
~~~

### github

很多人的资源托管在 github 上，其中不乏大量通过 hexo 搭建的静态博客。但是国内访问 github 速度终究不是很理想，而国产的 gitee 虽然能替代大部分的使用场景，却总是在细节上不尽人意。

这个时候 jsDelivr 的加速就十分的有用。

~~~web-idl
// 加载 github 上的项目分支

// 提示：建议支持 npm 的项目使用npm

https://cdn.jsdelivr.net/gh/user/repo@version/file

https://cdn.jsdelivr.net/gh/用户名/仓库名称@版本号/目录

// 例如，加载 jQuery v3.2.1 版本

https://cdn.jsdelivr.net/gh/jquery/jquery@3.2.1/dist/jquery.min.js

// 或者加载 jquery 目录

// 提示：目录后面的"/"不能省略，否则无法访问

https://cdn.jsdelivr.net/gh/jquery/jquery/

~~~

# wordpress

建站没折腾过 wordpress，那绝对是当站长的一大遗憾。不过因为一直不擅长优化 wordpress，后来我选择了 Typecho，与其水平不够反复折腾，不如安安静静静下心来记录下自己的成长。

~~~web-idl
// 从中加载任何插件WordPress.org网站插件SVN repo

https://cdn.jsdeliver.net/wp/plugins/project/tags/version/file

// 加载精确版本

https://cdn.jsdeliver.net/wp/plugins/wp-slimstat/tags/4.6.5/wp-slimstat.js

//加载最新版本

//你不应该在生产中使用这个

https://cdn.jsdeliver.net/wp/plugins/wp-slimstat/trunk/wp-slimstat.js

//从中加载任何主题WordPress.org网站主题SVN回购

https://cdn.jsdeliver.net/wp/themes/project/version/file

//加载精确版本

https://cdn.jsdeliver.net/wp/themes/tight-eightteen/1.7/assets/js/html5.js

//将“.min”添加到任何JS/CSS文件以获得缩小版本

//如果不存在，我们将为您生成它
~~~

> wordpress 部分的汉字解释用的百度翻译，所以可能奇奇怪怪，不过配合官网的例子，熟悉的大佬应该很快能看明白。不过，都是大佬了，应该不会看到我这种小白文章吧。