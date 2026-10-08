# 我的图库 · KingLear1606.github.io

按**原始文件夹目录结构**浏览照片的静态图库站点（GitHub Pages）。

照片数据来自公开的 Hugging Face 数据集 [`KingLear1606/my-photos`](https://huggingface.co/datasets/KingLear1606/my-photos)，
站点本身只托管一个目录清单 `manifest.json` + 纯静态页面，图片通过 Hugging Face 的
`resolve` 直链按需加载，因此仓库只有几百 KB，不会受 GitHub 1GB 限制。

## 目录结构

```
KingLear1606.github.io/
├── index.html                # 图库页面
├── manifest.json             # 目录清单（脚本生成，可提交）
├── assets/
│   ├── app.js                # 前端逻辑（目录树 / 网格 / 搜索 / 灯箱）
│   └── style.css             # 样式（支持深色/浅色模式）
└── tools/
    └── build_manifest.py     # 扫描数据集，生成 manifest.json
```

## 功能

- **打开即进入 `JPG` 根目录**（顶层只显示一个 JPG 文件夹时自动跳过这一层），下面直接是城市文件夹
- 左侧文件夹树 + 面包屑导航，完整还原 `JPG/城市/…` 的原始层级
- 首页文件夹卡片显示每个目录的照片数量
- 网格瀑布式浏览，**每页最多 50 张 + 页码跳转**（底部可翻页，也可用 `←` `→` 翻页）
- **图片默认走 [hf-mirror.com](https://hf-mirror.com) 镜像站**（只换主机名，路径与清单一致；
  官方站直连慢时切换更稳）——顶栏「镜像 / 官方」按钮可随时切换，选择会被记住
- **网格默认直接加载原图**（中位数约 15MB/张）：滚动到哪张才下哪张，队列并发自适应（8 路起，失败就砍），
  所以翻页很快、画质是原图；顶栏「原图 / 缩略图」按钮可切到**缩略图模式**——
  通过 [wsrv.nl](https://wsrv.nl) 代理按需缩放成 480px WebP（约 15~25KB/张），一屏几十张也只拉几 MB（选择会被记住）
- 全局搜索：匹配文件名或文件夹名，可跨目录查看结果（结果同样按每页 50 张分页）
- 灯箱：上一张/下一张、键盘 `←` `→` `Esc`、显示文件名与体积、跳转原图/下载
- 每张照片地址可分享（`#/JPG/上海/20240820-DSC_0117.jpg` 直接打开灯箱）
- 移动端适配（侧边栏抽屉化）

## 重新生成目录清单

数据集有更新后执行：

```bash
pip install requests pypinyin      # pypinyin 可选，用于按拼音排序中文文件夹
python tools/build_manifest.py
```

常用参数：

```bash
python tools/build_manifest.py -o manifest.json      # 输出路径
python tools/build_manifest.py --dataset 其他用户/数据集 --revision main
HF_TOKEN=hf_xxx python tools/build_manifest.py       # 数据集若转为私有时使用
```

脚本只收录 `.jpg` / `.jpeg`（NEF/DNG/MOV 等原始文件会被忽略），并默认**只统计 `JPG/` 目录**下的照片（`RAW/` 等其它顶层目录不进图库，可用 `--root` 改或传 `--root ''` 收录全部）：

```
限定目录 JPG/：18401 -> 18400 张（排除 1 张）
完成: 40 个文件夹 / 18,400 张图片 (271.4 GB)
```

## 自动更新

`.github/workflows/update-manifest.yml` 每周自动重新扫描数据集并提交变更的 `manifest.json`，
也可在 Actions 页面手动触发（Run workflow）。

## 本地预览

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

## 改完前端记得 bump 版本号

GitHub Pages 对静态资源发的是 `Cache-Control: max-age=600`，浏览器会把 `assets/app.js`
和 `assets/style.css` 缓存 10 分钟——只 push 不改 URL 的话，用户那边可能还在跑旧代码，
看起来「改动没生效」。

所以**每次改 `assets/` 下的文件**，把 `index.html` 里两个引用后面的 `?v=` 串改掉：

```html
<link rel="stylesheet" href="assets/style.css?v=20261008b" />
<script src="assets/app.js?v=20261008b"></script>
```

串随便取（建议用日期+字母），和上次不同即可，用户普通刷新就能拿到新版本。
用户自己被强制硬刷（Ctrl+F5）也能解决，但 bump 版本号更省事。

同理，若要**改变默认行为**（比如缩略图/原图的默认值），别只改判断逻辑——
`localStorage` 里可能还存着旧偏好的值。给 key 加个版本后缀
（`gallery:thumbs` → `gallery:thumbs:v2`），新默认值才会对所有浏览器生效。

## 说明 / 安全

- 站点不包含任何 token，图片全部走 Hugging Face 公开直链（默认经 hf-mirror.com 镜像，内容与官方站一致）。
  镜像站是第三方服务，若担心可用性可点顶栏「官方」切回 `huggingface.co`。
- 默认直接拉原图（原图中位数约 15MB/张，只有滚动到视口里的瓦片才会发请求，并发由队列限流）；
  切到缩略图模式时才会用到免费的 wsrv.nl 代理（它先取一次原图再缩放并缓存 7~31 天，源站仍是 HF 直链）。
  缩略图偶发被源站限流时会自动退避重试（1.5s / 6s 各一次）；仍失败时只显示「点击加载原图」，不会悄悄替你下载大图。
  若想彻底去掉第三方依赖，可改为预生成缩略图并随数据集一起托管（`tools/` 下加一个批量缩放脚本 + `manifest.json`
  增加缩略图路径即可），需要时可以再加。
