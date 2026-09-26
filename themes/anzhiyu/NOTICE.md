# NOTICE · 版权归属与修改声明

本文件用于声明 **CBMIM theme** 与上游 **AnZhiYu（安知鱼）主题** 的派生关系。
依据 GNU General Public License v3.0 第 5 条（修改版本必须带有显著声明，说明其被修改过及修改日期）而设立。

---

## 一、上游项目

| 项 | 内容 |
|---|---|
| 项目名 | **AnZhiYu / hexo-theme-anzhiyu**（中文名「安知鱼」） |
| 仓库 | <https://github.com/anzhiyu-c/hexo-theme-anzhiyu> |
| 文档 | <https://docs.anheyu.com/> |
| 预览 | <https://hexo.anheyu.com/> |
| 作者 | anzhiyu `<me@anheyu.com>` |
| 主题设计 | [@张洪 Heo](https://github.com/zhheo) |
| 文档编写 | [@xiaoran](https://github.com/xiaoran) |
| 源头项目 | 基于 [hexo-theme-butterfly](https://github.com/jerryc127/hexo-theme-butterfly) 修改而来 |
| 许可证 | **GNU General Public License v3.0**（见 `LICENSE`，未作任何改动） |

原主题的完整说明与全部署名、贡献者名单、赞助信息已原样保留在：

- `upstream/README.zh-CN.md` —— 官方中文 README 原文
- `upstream/README.en.md` —— 官方英文 README 原文

## 二、本派生项目

| 项 | 内容 |
|---|---|
| 项目名 | **CBMIM theme**（hexo-theme-cbmim） |
| 仓库 | <https://github.com/ShenDoyle/CBMIM-theme> |
| 维护者 | ShenDoyle（cbm.im / 南城左立方） |
| 用途 | 站点 <https://cbm.im/> 使用的主题版本库，**不对外发布、不用于二次分发** |
| 许可证 | 同上，**GNU GPL v3.0**（派生作品沿用上游许可证，不得改为专有许可） |

### 修改声明

自分支起点起，本仓库对上游作了以下修改。以下为**完整改动清单**，除此之外的文件与上游对应版本逐字节一致。

| 类别 | 文件 | 改动内容 |
|---|---|---|
| 资源格式 | `_config.yml`、`scripts/events/merge_config.js` | 默认图由 jpg / gif / png 改为 **webp**（`error_img.flink`、`error_img.post_page`、`valine.bg`、`cover.default_cover`） |
| 缺陷修复 | `layout/includes/header/index.pug` | 修复独立页面顶部图不显示：原写法恒用 `home_index_img_bg`，而该变量仅在首页分支被赋值 |
| 图片资源 | `source/img/404.webp`、`comment_bg.webp`、`default_cover.webp`、`friend_404.webp`、`loading.webp` | 转 webp 并删除对应的 5 个旧格式文件 |
| 品牌资源 | `source/favicon.ico`、`source/img/512.png`、`source/img/siteicon/*` | 替换为本站图标 |
| 文档 | `README.md`、`NOTICE.md`、`upstream/*` | 本仓库自有说明与上游原文归档，不影响运行时行为 |

### 修改时间线

| 日期 | 说明 |
|---|---|
| 2026-09-26 | 自上游 v1.7.1（commit `07114b6`，dev 分支）建立派生分支；上述修改生效；`README.md` 改写为 CBMIM theme 自有说明，上游 README 归档至 `upstream/` |

## 三、合规要点

1. **保留署名**：上游作者、设计者、文档作者、贡献者与赞助信息均已保留，未作删减。
2. **保留许可证**：`LICENSE` 为上游 GPL-3.0 全文，未作修改；派生版本继续以 GPL-3.0 授权。
3. **标注修改**：修改内容与日期见上文，符合 GPL-3.0 §5(a)(b)。
4. **未使用上游商标**：本仓库名为 CBMIM theme，与上游「AnZhiYu / 安知鱼」品牌区分；上游名称仅用于**事实性来源标注**与同步说明。
5. **源代码可得**：本仓库为公开仓库，满足 GPL-3.0 对派生作品提供对应源代码的要求。

---

如上游作者对本派生项目的署名方式或使用方式有异议，请通过本仓库 Issue 联系，将立即调整。
