"""按 crops.json 的每站取景规格，从 raw/<slug>-full.png 裁出卡片缩略图。

crops.json: { "<slug>": {"x":0,"y":0,"w":1280,"h":800}, ... }
  - 坐标是 raw 原图（1280 宽）像素；缺省 = 整宽、从顶端取 16:10 一块
  - y 会被自动钳制，保证不越界（不够高就往上顶）
  - "note": 该站为什么取这一块（写进 _crops-log.json，便于以后回溯）

输出: site/shot/<slug>.webp（1200×750, q=80）
"""
import os, json
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "..", "site", "shot")
OUT_W, OUT_H = 1200, 750

spec = json.load(open(os.path.join(HERE, "crops.json"), encoding="utf-8"))
Image.MAX_IMAGE_PIXELS = None
os.makedirs(OUT, exist_ok=True)

log = []
for slug, c in spec.items():
    src = os.path.join(RAW, slug + "-full.png")
    if not os.path.exists(src):
        log.append({"slug": slug, "error": "缺 full.png"})
        print(f"❌ {slug}  缺 {slug}-full.png")
        continue
    im = Image.open(src).convert("RGB")
    W, H = im.size
    ch = c.get("h", 800)
    cw = c.get("w", W)
    x = max(0, min(c.get("x", 0), W - cw))
    y = max(0, min(c.get("y", 0), max(0, H - ch)))
    box = (x, y, min(W, x + cw), min(H, y + ch))
    tile = im.crop(box)
    # 不够高/宽就贴白补齐（极少数矮页面）
    if tile.size != (cw, ch):
        pad = Image.new("RGB", (cw, ch), (255, 255, 255))
        pad.paste(tile, (0, 0))
        tile = pad
    tile.resize((OUT_W, OUT_H), Image.LANCZOS).save(
        os.path.join(OUT, slug + ".webp"), "WEBP", quality=80, method=5
    )
    kb = round(os.path.getsize(os.path.join(OUT, slug + ".webp")) / 1024, 1)
    log.append({"slug": slug, "box": list(box), "out": f"{OUT_W}x{OUT_H}", "kb": kb, "note": c.get("note", "")})
    print(f"✅ {slug:<46} box={box}  {kb}KB")

json.dump(log, open(os.path.join(HERE, "_crops-log.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
total = sum(x.get("kb", 0) for x in log)
print(f"\n共 {len([x for x in log if 'kb' in x])} 张，合计 {round(total)} KB")
