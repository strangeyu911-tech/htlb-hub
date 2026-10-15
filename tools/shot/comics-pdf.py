"""四格漫画那张卡片图不走 CDP —— 它是 PDF，没法像网页那样"打开截一屏"。

做法（2026-10-15 起）：把 release 里的合并版 PDF 临时下载到 .cache/comics/，
用 PyMuPDF 渲染其中两页并排，输出 site/shot/robineo2045-comics.webp，然后把 PDF 删掉。

为什么是「两页并排」而不是单页：
  单页是 540×770 的竖版，直接裁成 16:10 只剩中间两格（试过，四格只剩一半）；
  两页并排比例 1.40，裁掉底部脚注后正好落到 16:10 —— 而且一眼能看出「这是一本
  四格漫画书」，正是这张卡片要传达的东西。

用法：
    python comics-pdf.py [PDF路径]        # 默认 .cache/comics/comics.pdf

重新下载（Release asset 约 18 MB，国内直连很慢，务必带 -C - 续传）：
    mkdir -p .cache/comics
    curl -L -C - --max-time 2400 -o .cache/comics/comics.pdf \\
      https://github.com/robiNeo2045/HowToLiveBetter/releases/download/comics-2026-10-03/HowToLiveBetter-comics-2026-10-03.pdf
"""
import os
import sys

import pymupdf
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".cache", "comics", "comics.pdf")
OUT = os.path.join(ROOT, "site", "shot", "robineo2045-comics.webp")

PAGES = [0, 1]          # 取第 1、2 页（索引从 0 起）
DPI = 160
TARGET = (1200, 750)    # 与其它卡片图一致，16:10

if not os.path.exists(PDF):
    sys.exit(f"找不到 PDF：{PDF}\n先按文件头的 curl 命令把它下载到 .cache/comics/ 再跑。")

doc = pymupdf.open(PDF)


def render(i):
    pix = doc[i].get_pixmap(dpi=DPI)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


ims = [render(i) for i in PAGES]
row = Image.new("RGB", (sum(im.width for im in ims), max(im.height for im in ims)), (255, 255, 255))
x = 0
for im in ims:
    row.paste(im, (x, 0))
    x += im.width

W, H = row.size
want = round(W * 10 / 16)
if want <= H:
    row = row.crop((0, 0, W, want))          # 太高：从顶部裁，切掉底部脚注
row = row.resize(TARGET, Image.LANCZOS)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
row.save(OUT, "WEBP", quality=82, method=5)
doc.close()

kb = round(os.path.getsize(OUT) / 1024, 1)
print(f"✅ {os.path.relpath(OUT, ROOT)}  {TARGET[0]}x{TARGET[1]}  {kb}KB  "
      f"（PDF 共 {pymupdf.open(PDF).page_count} 页，取 {'+'.join(str(p + 1) for p in PAGES)} 页并排）")
