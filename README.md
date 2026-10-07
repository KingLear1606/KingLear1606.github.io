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

- 左侧文件夹树 + 面包屑导航，完整还原 `JPG/城市/…` 的原始层级
- 首页文件夹卡片显示每个目录的照片数量
- 网格瀑布式浏览，**分批加载 + 懒加载**（原图中位数约 15MB/张，避免一次拉爆带宽）
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

脚本只收录 `.jpg` / `.jpeg`（NEF/DNG/MOV 等原始文件会被忽略），并输出统计：

```
完成: 43 个文件夹 / 18,401 张图片 (271.4 GB)
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
- 之前用于扫描 ModelScope 私有数据集 `KingLear1606/ms_space` 的 token 已不再需要，
  **建议前往 ModelScope「访问令牌」页面吊销该 token**（它曾出现在聊天记录中）。
