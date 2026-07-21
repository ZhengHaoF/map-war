#!/usr/bin/env python3
"""汇文明朝体 unicode-range 分片切片 — 输出 woff2 子集

用法: python scripts/subset-font.py

输出到 apps/web/public/fonts/huiwen/
"""
import subprocess
import os
import sys

# 项目根目录（脚本所在 scripts/ 的上一级）
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_SRC = os.path.join(ROOT, "apps", "web", "src", "assets", "fonts", "汇文明朝体.otf")
OUT_DIR  = os.path.join(ROOT, "apps", "web", "public", "fonts", "huiwen")

# pyftsubset：优先用当前 Python 解释器的 fonttools 模块（避免 PATH 问题）
PYTHON = sys.executable
PYFTSUBSET = [PYTHON, "-m", "fontTools.subset"]

# unicode-range 分片定义
SLICES = [
    # 片 0：Latin + 数字 + 标点 + 全角符号（所有页面必定命中）
    (
        "latin",
        "U+0020-007E,"     # Basic Latin（空格～~）
        "U+00A0-00FF,"     # Latin-1 Supplement
        "U+2000-206F,"     # General Punctuation
        "U+3000-303F,"     # CJK Symbols and Punctuation（、。「」 etc.）
        "U+FF00-FFEF,"     # Halfwidth and Fullwidth Forms
        "U+2018-2019,"     # '' 左右单引号
        "U+201C-201D,"     # "" 左右双引号
        "U+2013-2014,"     # – — 短破折号 / 长破折号
        "U+2026",          # … 省略号
    ),
    # 片 1：CJK 高频字（覆盖 ~5000 字，90% 中文 UI 命中）
    ("cjk-1", "U+4E00-62FF"),
    # 片 2：CJK 中频字
    ("cjk-2", "U+6300-77FF"),
    # 片 3：CJK 低频字
    ("cjk-3", "U+7800-9FFF"),
    # 片 4：CJK 扩展 A（异体字、古籍用字，正常 UI 不会下载）
    ("cjk-ext-a", "U+3400-4DBF"),
    # 片 5：特殊符号（〇 · ， 。 等遗漏补丁）
    (
        "cjk-misc",
        "U+3007,"     # 〇
        "U+00B7,"     # · 中间点
        "U+FF0C,"     # ，全角逗号
        "U+3001-3002,"# 、。顿号句号
        "U+FF01,"     # ！全角叹号
        "U+FF1F,"     # ？全角问号
    ),
]

os.makedirs(OUT_DIR, exist_ok=True)

print(f"源字体: {FONT_SRC}")
print(f"输出目录: {OUT_DIR}")
print("-" * 50)

for name, *unicodes in SLICES:
    unicode_str = "".join(unicodes)
    out_path = os.path.join(OUT_DIR, f"huiwen-{name}.woff2")
    cmd = PYFTSUBSET + [
        FONT_SRC,
        f"--unicodes={unicode_str}",
        f"--output-file={out_path}",
        "--flavor=woff2",
        "--layout-features=",
        "--no-hinting",
        "--desubroutinize",
    ]
    subprocess.run(cmd, check=True)
    size_kb = os.path.getsize(out_path) / 1024
    print(f"  OK  {name:12s}  →  {size_kb:8.1f} KB")

print("-" * 50)
total_kb = sum(
    os.path.getsize(os.path.join(OUT_DIR, f)) / 1024
    for f in os.listdir(OUT_DIR)
)
print(f"总计 {len(SLICES)} 个子集，{total_kb / 1024:.1f} MB")
print("Done.")
