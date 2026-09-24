#!/usr/bin/env python3
"""扫截图的一行像素，找内容的左右边界，打印两侧留白。
用法：edges.py 截图.png [--y 450] [--tol 12]
第一列像素当底色；连续不是底色的一段算一块内容，打印每块的 x 范围和它到两边的距离。
交付前量：两侧留白必须相等。需要 Pillow：pip3 install pillow
"""
import sys, argparse
try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow：pip3 install pillow")
ap = argparse.ArgumentParser()
ap.add_argument("png")
ap.add_argument("--y", type=int, default=None, help="扫哪一行，默认中间")
ap.add_argument("--tol", type=int, default=12, help="和底色差多少算内容")
a = ap.parse_args()
im = Image.open(a.png).convert("RGB")
w, h = im.size
y = a.y if a.y is not None else h // 2
bg = im.getpixel((0, y))
def diff(p): return max(abs(p[i] - bg[i]) for i in range(3))
runs, start = [], None
for x in range(w):
    on = diff(im.getpixel((x, y))) > a.tol
    if on and start is None: start = x
    if not on and start is not None: runs.append((start, x - 1)); start = None
if start is not None: runs.append((start, w - 1))
print(f"{a.png}  {w}×{h}  扫第 {y} 行  底色 {bg}")
if not runs:
    print("这一行全是底色"); sys.exit()
for i, (s, e) in enumerate(runs):
    gap_l = s - (runs[i - 1][1] + 1) if i else s
    print(f"块 {i + 1}: x {s}–{e}（宽 {e - s + 1}）  左边空 {gap_l}")
left, right = runs[0][0], w - 1 - runs[-1][1]
print(f"右边空 {right}")
print(f"最左内容离左边 {left}，最右内容离右边 {right}" + ("，两侧相等" if left == right else "，两侧不相等"))
