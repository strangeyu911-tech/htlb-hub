"""把 raw/<slug>-s1..sN.png 竖向拼成整页原图，再缩成宽 400 的 <slug>-over.png。
顺带写一份 <slug>-full.png（1280 宽的原分辨率整页，供裁图用）。

为什么不在 Chrome 里直接拍整页：captureBeyondViewport 会先把整页渲染一遍，
几万像素高的页面（打勾清单那种）会卡死。切片是分屏拍的，天然绕开这个问题。
"""
import os, glob, re, json
from PIL import Image

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
Image.MAX_IMAGE_PIXELS = None
ONLY = [a for a in os.sys.argv[1:]]

rows = []
slugs = sorted({re.sub(r"-s\d+\.png$", "", os.path.basename(f)) for f in glob.glob(os.path.join(RAW, "*-s[0-9].png"))})
for slug in slugs:
    if ONLY and not any(k in slug for k in ONLY):
        continue
    segs = sorted(
        glob.glob(os.path.join(RAW, slug + "-s[0-9].png")),
        key=lambda f: int(re.search(r"-s(\d+)\.png$", f).group(1)),
    )
    if not segs:
        continue
    ims = [Image.open(f).convert("RGB") for f in segs]
    W = max(i.width for i in ims)
    H = sum(i.height for i in ims)
    full = Image.new("RGB", (W, H), (255, 255, 255))
    y = 0
    for i in ims:
        full.paste(i, (0, y))
        y += i.height
    full.save(os.path.join(RAW, slug + "-full.png"), optimize=True)

    nw = 400
    nh = max(1, round(H * nw / W))
    full.resize((nw, nh), Image.LANCZOS).save(os.path.join(RAW, slug + "-over.png"), optimize=True)
    rows.append({"slug": slug, "segs": len(segs), "full": f"{W}x{H}", "over": f"{nw}x{nh}"})

for r in rows:
    print(f"{r['slug']:<46} segs={r['segs']}  full={r['full']:<12} over={r['over']}")
print(f"共 {len(rows)} 张")
