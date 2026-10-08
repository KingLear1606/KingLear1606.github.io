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
- 网格瀑布式浏览，**分批加载 + 懒加载**（原图中位数约 15MB/张，避免一次拉爆带宽）
- **网格默认只加载缩略图**：通过 [wsrv.nl](https://wsrv.nl) 图片代理按需缩放成 600px WebP（约 15~50KB/张），
  一屏几十张也只拉几 MB；顶栏「缩略图 / 原图」按钮可随时切换（记住选择），灯箱、下载、「在 HF 打开」始终用原图
- 全局搜索：匹配文件名或文件夹名，可跨目录查看结果
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

## 说明 / 安全

- 站点不包含任何 token，图片全部走 Hugging Face 公开直链。
- 网格缩略图由免费的 wsrv.nl 代理生成（它先取一次原图再缩放并缓存 7~31 天，源站仍是 HF 直链）。
  代理偶发被源站限流时会自动重试一次；仍失败时只显示「点击加载原图」，不会悄悄替你下载十几 MB 的大图。
  若想彻底去掉第三方依赖，可改为预生成缩略图并随数据集一起托管（`tools/` 下加一个批量缩放脚本 + `manifest.json`
  增加缩略图路径即可），需要时可以再加。
