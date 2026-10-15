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

## 五、几种不走 capture.cjs 的图

### 「四格漫画 PDF」——它是 PDF，没有网页可截

原来截的是 GitHub Release 页（能看到「762 页」和 Assets 里的 PDF），但读者真正想看的是**漫画本身长什么样**。
PDF 没法用 CDP 打开截屏，所以改成：**临时下载 → 渲染 → 截图 → 删掉**。

```bash
mkdir -p .cache/comics
curl -L -C - --max-time 2400 -o .cache/comics/comics.pdf \
  https://github.com/robiNeo2045/HowToLiveBetter/releases/download/comics-2026-10-03/HowToLiveBetter-comics-2026-10-03.pdf
python comics-pdf.py          # → site/shot/robineo2045-comics.webp
rm .cache/comics/comics.pdf   # 18 MB，别留在本地
```

- **为什么是「两页并排」**：单页是 540×770 竖版，裁成 16:10 只剩中间两格，四格漫画被砍一半；
  两页并排比例 1.40，从顶部裁掉底部脚注后正好是 16:10，而且一眼能看出「这是一本四格漫画书」。
- 这条**不在 `crops.json` 里**，`crop.py` 不管它 —— 否则下次全量重跑会用旧的 Release 页截图把它覆盖回去。
  重跑命令见 `comics-pdf.py` 头部注释。

### 「另见」区块的 5 张

那 5 个站点不在 `data/projects.json`（上游官方清单）里，所以用单列的 `capture-extra.cjs`：

```bash
node capture-extra.cjs && python over.py mirror patch justin-sun-corpus howtoworkbetter shangbanbao
python crop.py               # 取景规格在 crops.json 里，和其它站同一条流水线
```

页面那一块是**左图右文**（`.mrow` / `.mshot`），图能放到 ~565px —— 网格卡片里只有 ~346px，
所以同样 16:10 的图在这一块显得更大，取景时可以比卡片图更"完整"，不必只挑一个特写。

### 两张手工指定的取景（`manual/` + `manual-shots.py`）

`how2livebetter-net`（人生阶段指南）与 `www-howtolivebetter-cn`（渐好）—— 维护者看过自动截的版本后
认为取景不如他自己截的那一屏，于是**直接给了原图**。原图入库在 `manual/`，由 `manual-shots.py` 裁成 16:10：

```bash
python manual-shots.py       # manual/*.png → site/shot/<slug>.webp
```

钳制的理由写在脚本 `SPEC` 里，核心是**两张都不是 16:10，而裁哪边有讲究**：

- 阶段指南 1910×1415（1.35，竖）→ 只能裁高度，**从底部裁**：页头、大标题、阶段入口、右侧示例条目卡全在上半部。
- 渐好 1910×915（2.09，宽幅屏截的）→ 只能裁宽度，**从右侧裁**：左侧功能栏是站点标识、
  「眼前的处境」三张卡是这一站的核心，都得留住；裁完差的 6% 高度**用边缘色补齐**，不再切内容。

这两个 slug 也已从 `crops.json` 移除（否则 `crop.py` 会用 CDP 截的旧图覆盖回去）。
要换成新的手工图：把 PNG 放进 `manual/`、改脚本里的 `box`、重跑一次即可。
