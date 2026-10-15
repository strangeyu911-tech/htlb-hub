"""两张手工指定取景的卡片图 —— 不走 CDP 流水线。

背景：维护者看过自动截的 `how2livebetter-net`（人生阶段指南）与
`www-howtoLivebetter-cn`（渐好）后，认为取景不如他自己截的那一屏，于是直接给了原图。
原图存在 `manual/`（入库，约 450 KB），本脚本负责把它们裁成与其它卡片一致的
1200×750（16:10），输出到 `site/shot/`。

为什么不能"整张塞进去"：两张都不是 16:10 ——
  · 阶段指南 1910×1415 = 1.35（竖），16:10 装不下，必须裁高度；
  · 渐好     1910×915  = 2.09（宽幅屏截的），必须裁宽度。
裁哪一边不是随便定的，见下面 spec 里的理由。

用法：
    python manual-shots.py
（这两个 slug 已从 crops.json 移除，所以 `crop.py` 不会覆盖它们。）
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
OUT = os.path.join(ROOT, "site", "shot")
TARGET = (1200, 750)      # 与其它卡片图一致

SPEC = {
    "how2livebetter-net": {
        "src": "manual/how2livebetter-net.png",
        "box": (0, 0, 1910, 1194),
        "note": "原图 1910×1415（1.35）。从**底部**裁 221px —— 页头、大标题「按你的人生阶段重排」、"
                "阶段入口两个按钮、右侧那条示例条目卡全在 0–1194 里，被裁掉的是"
                "「装进手机和浏览器」区块的下半部分。",
    },
    "www-howtolivebetter-cn": {
        "src": "manual/www-howtolivebetter-cn.png",
        "box": (0, 0, 1660, 915),
        "note": "原图 1910×915（2.09，宽幅屏截的）。从**右侧**裁 250px：左侧功能栏是站点标识、"
                "「眼前的处境」三张卡是这一站的核心，都得留住；右侧被裁掉的是插画与最右边一列主题卡。"
                "裁完还剩 6% 的高度差，用底色补齐，而不是继续裁内容。",
        "pad": True,
    },
}


def edge_color(im, rows=3):
    """取图片上下边缘的平均色，用来补边 —— 比写死一个灰更贴合原图。"""
    w, h = im.size
    top = im.crop((0, 0, w, rows)).resize((1, 1), Image.BOX).getpixel((0, 0))
    bot = im.crop((0, h - rows, w, h)).resize((1, 1), Image.BOX).getpixel((0, 0))
    return top, bot


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, spec in SPEC.items():
        src = os.path.join(HERE, spec["src"])
        im = Image.open(src).convert("RGB").crop(spec["box"])
        w, h = im.size

        scale = TARGET[0] / w
        scaled_h = max(1, round(h * scale))
        im = im.resize((TARGET[0], scaled_h), Image.LANCZOS)

        if scaled_h >= TARGET[1]:                        # 缩放后仍太高 → 再裁一次底部
            im = im.crop((0, 0, TARGET[0], TARGET[1]))
        elif spec.get("pad"):                            # 高度不够 → 上下补边，不裁内容
            top_c, bot_c = edge_color(im)
            pad_total = TARGET[1] - scaled_h
            pad_top = pad_total // 2
            pad_bot = pad_total - pad_top
            canvas = Image.new("RGB", TARGET, top_c)
            if pad_bot > 0:
                canvas.paste(Image.new("RGB", (TARGET[0], pad_bot), bot_c), (0, TARGET[1] - pad_bot))
            canvas.paste(im, (0, pad_top))
            im = canvas

        out = os.path.join(OUT, slug + ".webp")
        im.save(out, "WEBP", quality=82, method=5)
        kb = round(os.path.getsize(out) / 1024, 1)
        print(f"✅ {slug:<26} {TARGET[0]}x{TARGET[1]}  {kb}KB")


if __name__ == "__main__":
    main()
