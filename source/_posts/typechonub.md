---
title: Typecho 不用插件实现文章阅读次数统计
date: 2020/04/16 20:00:00
updated: 2026/09/26 19:20:00
cover: https://cdn.jsdelivr.net/gh/ShenDoyle/ShenDoyle.github.io@main/img/cbmim/typechonub/2024215171707989449047time_typecho_nub.webp
categories: 技术
tags:
  - 前端
ai:
  - 这篇文章分享了在Typecho中实现文章阅读次数统计的两种方法：一种是不包含cookie验证的统计方式，另一种则包含了验证以避免重复点击。这些代码需添加至Typecho的function.php文件，并在需要展示阅读次数的位置插入相应代码段。文章指出了代码来源并简要解释了两种方案的实现原理。
  - 文章介绍了在Typecho中实现文章阅读次数统计的两种方法：一种不含cookie验证，另一种包含验证避免重复点击。需在function.php添加对应代码，并在展示阅读次数的位置插入相关代码。简要指出了代码来源及两种方案的实现原理。
notion_page_id: 3e77adb0-e2e0-8150-8051-d24d8689ef53
---

Typecho 是国人开发的一款轻量的 Blog 系统，非常的受技术党的欢迎，我自己也用 Typecho 搭建了一个自认为不错的基于 Typecho 的 Blog。

在 Typecho 中，很多功能可以用过插件实现，不过有些功能依赖插件总会导致 Blog 逐渐臃肿，所以简单的改改代码是不错的选择，比如实现文章阅读次数统计的功能。

<!--more-->

## 方案说明

目前代码有两种类型，分为不包含 cookie 验证和包含 cookie 验证的两段。

## 不包含 cookie 验证

一般修改这种代码，我们选择修改 Typecho 的主题文件中的`function.php`文件，而实现这一功能，我们需要在`function.php`文件中加入下面这段代码：

```php
//get_post_view($this)
function get_post_view($archive)
{
    $cid    = $archive->cid;
    $db     = Typecho_Db::get();
    $prefix = $db->getPrefix();
    if (!array_key_exists('views', $db->fetchRow($db->select()->from('table.contents')))) {
        $db->query('ALTER TABLE `' . $prefix . 'contents` ADD `views` INT(10) DEFAULT 0;');
        echo 0;
        return;
    }
    $row = $db->fetchRow($db->select('views')->from('table.contents')->where('cid = ?', $cid));
    if ($archive->is('single')) {
       $db->query($db->update('table.contents')->rows(array('views' => (int) $row['views'] + 1))->where('cid = ?', $cid));
    }
    echo $row['views'];
}
```

加入上述的代码文件之后，我们再在想要显示浏览次数的位置加入下面这段代码即可：

```php
<?php get_post_view($this) ?>
```

## 包含 cookie 验证

上面的统计代码只是机械的统计点击次数，如果一个人反复点击多次都会被算上，队友有些要求比较高的博主体验不会很好，所以下面给一段加了 cookie 验证的代码，同样是放在`function.php`文件就可以了：

```php
function get_post_view($archive)
{
    $cid    = $archive->cid;
    $db     = Typecho_Db::get();
    $prefix = $db->getPrefix();
    if (!array_key_exists('views', $db->fetchRow($db->select()->from('table.contents')))) {
        $db->query('ALTER TABLE `' . $prefix . 'contents` ADD `views` INT(10) DEFAULT 0;');
        echo 0;
        return;
    }
    $row = $db->fetchRow($db->select('views')->from('table.contents')->where('cid = ?', $cid));
    if ($archive->is('single')) {
 $views = Typecho_Cookie::get('extend_contents_views');
        if(empty($views)){
            $views = array();
        }else{
            $views = explode(',', $views);
        }
if(!in_array($cid,$views)){
       $db->query($db->update('table.contents')->rows(array('views' => (int) $row['views'] + 1))->where('cid = ?', $cid));
array_push($views, $cid);
            $views = implode(',', $views);
            Typecho_Cookie::set('extend_contents_views', $views); //记录查看cookie
        }
    }
    echo $row['views'];
}
```

展示同样只用把下面的代码放在你想要在 Blog 展示的位置即可：

```php
<?php get_post_view($this) ?>
```

**注：**

本文代码来自[Typecho 爱好者博客](https://qqdie.com/archives/typecho-read-statistics.html)，本博客重新整理排版发布。
