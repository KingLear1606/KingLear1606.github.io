#!/usr/bin/env python3
"""从公开的 Hugging Face 数据集扫描目录，生成图库所需的 manifest.json。

用法:
    python tools/build_manifest.py                 # 默认输出到仓库根目录 manifest.json
    python tools/build_manifest.py -o public/manifest.json
    HF_DATASET=other/user/ds python tools/build_manifest.py

说明:
- 只收录图片文件 (.jpg / .jpeg)，其余文件 (NEF/DNG/MOV/...) 会被忽略。
- 数据集是公开的，无需 token；若数据集改为私有，可设置环境变量 HF_TOKEN。
- 目录排序：优先用 pypinyin 按拼音排序中文文件夹（未安装则按 Unicode 码点），文件按自然排序。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:  # pragma: no cover
    sys.exit("缺少依赖 requests，请先执行: pip install requests")

try:
    from pypinyin import lazy_pinyin  # type: ignore
except ImportError:  # pragma: no cover - 可选依赖
    lazy_pinyin = None

DATASET = os.environ.get("HF_DATASET", "KingLear1606/my-photos")
REVISION = os.environ.get("HF_REVISION", "main")
IMAGE_EXTS = {".jpg", ".jpeg"}
API_ROOT = "https://huggingface.co/api/datasets"


# --------------------------------------------------------------------------- #
# 目录树抓取
# --------------------------------------------------------------------------- #
def fetch_tree(dataset: str, revision: str, token: str | None = None) -> list[dict]:
    """分页拉取数据集完整目录树，返回 [{type, path, size}, ...]。"""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    url = f"{API_ROOT}/{dataset}/tree/{revision}"
    params = {"recursive": "true", "expand": "false", "limit": "1000"}
    entries: list[dict] = []
    while url:
        resp = requests.get(url, params=params, headers=headers, timeout=60)
        if resp.status_code != 200:
            sys.exit(f"拉取目录失败 HTTP {resp.status_code}: {resp.text[:300]}")
        entries.extend(resp.json())
        url = resp.links.get("next", {}).get("url")
        params = {}
        print(f"  已获取 {len(entries)} 条目 ...", flush=True)
    return entries


# --------------------------------------------------------------------------- #
# 排序
# --------------------------------------------------------------------------- #
_NAT_RE = re.compile(r"(\d+)")


def natural_key(text: str) -> list:
    """文件名自然排序: DSC_9 < DSC_10。"""
    return [int(p) if p.isdigit() else p.lower() for p in _NAT_RE.split(text)]


def folder_key(name: str) -> list:
    """文件夹排序: 装了 pypinyin 就按拼音，否则按名称。"""
    if lazy_pinyin:
        py = "".join(lazy_pinyin(name)).lower()
        return [py, name]
    return [name]


# --------------------------------------------------------------------------- #
# 构建 manifest
# --------------------------------------------------------------------------- #
def build_tree(paths: list[tuple[str, int]]) -> dict:
    """把 (相对路径, 字节数) 列表变成嵌套节点 {dirs: {名: 节点}, files: [[名, 字节数]]}。"""
    root: dict = {"dirs": {}, "files": []}
    for path, size in sorted(paths, key=lambda p: natural_key(p[0])):
        parts = path.split("/")
        node = root
        for part in parts[:-1]:
            node = node["dirs"].setdefault(part, {"dirs": {}, "files": []})
        node["files"].append([parts[-1], size])

    def sort_node(node: dict) -> None:
        node["dirs"] = {
            name: sort_node(child) or child
            for name, child in sorted(node["dirs"].items(), key=lambda kv: folder_key(kv[0]))
        }
        node["files"].sort(key=lambda f: natural_key(f[0]))
        if not node["dirs"]:
            node.pop("dirs")
        if not node["files"]:
            node.pop("files")
        return node

    return sort_node(root)


def count_stats(node: dict) -> tuple[int, int, int]:
    """递归统计 (文件夹数, 图片数, 字节数)，文件夹数不含仓库根目录。"""
    folders = 0
    images = len(node.get("files", []))
    size = sum(f[1] for f in node.get("files", []))
    for child in (node.get("dirs") or {}).values():
        f, i, s = count_stats(child)
        folders += 1 + f
        images += i
        size += s
    return folders, images, size


def main() -> None:
    parser = argparse.ArgumentParser(description="生成图库 manifest.json")
    parser.add_argument("-o", "--output", default=None, help="输出文件路径，默认 <repo>/manifest.json")
    parser.add_argument("--dataset", default=DATASET, help="HF 数据集 id，如 owner/name")
    parser.add_argument("--revision", default=REVISION, help="分支/revision，默认 main")
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output = args.output or os.path.join(repo_root, "manifest.json")
    token = os.environ.get("HF_TOKEN")

    print(f"扫描数据集 {args.dataset}@{args.revision} ...")
    entries = fetch_tree(args.dataset, args.revision, token)

    images: list[tuple[str, int]] = []
    skipped = 0
    for entry in entries:
        if entry.get("type") != "file":
            continue
        path = entry["path"]
        if os.path.splitext(path)[1].lower() in IMAGE_EXTS:
            images.append((path, int(entry.get("size") or 0)))
        else:
            skipped += 1

    tree = build_tree(images)
    folders, total_images, total_bytes = count_stats(tree)
    manifest = {
        "dataset": args.dataset,
        "revision": args.revision,
        "source": f"https://huggingface.co/datasets/{args.dataset}",
        "treeUrl": f"https://huggingface.co/datasets/{args.dataset}/tree/{args.revision}",
        "base": f"https://huggingface.co/datasets/{args.dataset}/resolve/{args.revision}/",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totals": {"folders": folders, "images": total_images, "bytes": total_bytes},
        "tree": tree,
    }

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(output) / 1e6
    print(
        f"完成: {folders} 个文件夹 / {total_images:,} 张图片 "
        f"({total_bytes / 1e9:.1f} GB)，跳过非图片 {skipped} 个\n"
        f"清单: {output} ({size_mb:.2f} MB)"
    )


if __name__ == "__main__":
    main()
