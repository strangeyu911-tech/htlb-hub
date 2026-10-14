# 卡片截图是怎么来的

首页那 18 张「卡片缩略图」不是设计稿、也不是官方的宣传图，
是**逐个打开该项目的真实页面、挑出最有价值的一屏、原尺寸截下来的**。

图不对，外面看着就没什么特别的；点进去才发现是个真东西 —— 卡片图就是为了把这个「真东西」提到外面。

## 一、为什么用 CDP 而不是 `chrome --screenshot`

一开始图省事用命令行开关，踩了两个坑，都记在这儿：

1. **`--virtual-time-budget` 下拿不到 iframe 的 load 事件**，异步探针永远卡住不返回。
2. **`--window-size=414` 截图右侧会被裁**，看上去像移动端横向溢出，其实只是取景窗口比页面窄。
3. **`captureBeyondViewport` 会先把整页渲染一遍** —— 「打勾清单」那种几万像素高的页面，
   1280×20000 的 PNG 编码几乎不收敛（实测挂 9 分钟、0 输出）。

改用 CDP 之后这三件事都没了：视口用 `Emulation.setDeviceMetricsOverride` 设，
切片按 1280×900 一屏一屏拍（每屏都是独立渲染，不受页面总高影响）。

## 二、流程

```bash
cd tools/shot

# 1) 逐个真机截图（raw/<slug>-s1..s7.png；可传 slug 片段只跑其中几个）
node capture.cjs

# 2) 竖向拼回整页原图 + 生成宽 400 的整页缩略（raw/<slug>-full.png / -over.png）
python over.py

# 3) 照着 over.png 挑「最有价值的一屏」，把取景写进 crops.json，然后裁图
python crop.py          # → site/shot/<slug>.webp（1200×750, q=80）

# 4) 拼一张 3 列联表自查取景对不对
python contact.py       # → contact.png
```

**取景别靠估。** 浏览器页面的首屏、GitHub 的文件树、README 里的某一段，位置差别很大；
用 `node locate.cjs <url>` 把各标题和大图的纵向坐标打出来，照着坐标写 `crops.json` 里的 `y`。
（`huiturn` 那一站就是靠它才发现「预览」段在 1485px 而不是 400px。）

拍之前脚本会注入一段 `animation:none;transition:none` 的样式 ——
`better.aigcwei.cn` 首屏有一层文字淡入，拍到一半会出现字叠字的「重影」，看着像页面坏了。

## 三、crops.json

每个 slug 一条，`{x, y, w, h}` 是 **raw 原图（1280 宽）像素**，缺省整宽、从顶端取 16:10。
`note` 写清楚为什么取这一块，方便下次刷新时照着改。

一条经验：**缩略图最终只显示在 346–361px 宽的卡片里，正文小字缩到 4~5px，等于看不见。**
所以取景要挑「大标题 / 大插图 / 大数字 / 彩色标签 / 商店截图」这类在缩略尺寸下还立得住的东西，
别挑正文段落。

## 四、复查清单

- `capture.cjs` 里 `MAX_SEG = 7`，即最多拍 6300px 高 —— 够覆盖任何站的「值得截」区间。
- 跑完看一遍 `contact.png`：有没有截成一片空白、截到大段导航、或者关键词被切掉。
- 上站后在 1440 与 390 各量一次：`shot` 容器应恒为 16:10、宽 = 卡片宽 − 2px，页面横向溢出 0。

> 这些图会过时（项目改版、GitHub 换 UI）。介意的站点按上面流程重跑单个 slug 即可：
> `node capture.cjs <slug> && python over.py <slug> && python crop.py && python contact.py`
