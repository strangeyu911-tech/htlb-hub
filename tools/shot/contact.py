"""把 site/shot/*.webp 拼成一张 3 列的联表，方便一次看完 18 张取景是否合适。"""
import os, glob, json
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SHOT = os.path.join(HERE, "..", "..", "site", "shot")
spec = json.load(open(os.path.join(HERE, "crops.json"), encoding="utf-8"))
slugs = list(spec.keys())

TW, TH, LAB = 400, 250, 24
COLS = 3
ROWS = (len(slugs) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * TW, ROWS * (TH + LAB)), (255, 255, 255))
d = ImageDraw.Draw(sheet)

for i, slug in enumerate(slugs):
    p = os.path.join(SHOT, slug + ".webp")
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert("RGB").resize((TW, TH), Image.LANCZOS)
    c, r = i % COLS, i // COLS
    x, y = c * TW, r * (TH + LAB)
    d.text((x + 4, y + 5), f"{i+1}. {slug[:44]}", fill=(0, 0, 0))
    sheet.paste(im, (x, y + LAB))
    d.rectangle([x, y + LAB, x + TW - 1, y + LAB + TH - 1], outline=(190, 190, 190))

out = os.path.join(HERE, "contact.png")
sheet.save(out, optimize=True)
print(f"{out}  {sheet.size}  {round(os.path.getsize(out)/1024)}KB")
