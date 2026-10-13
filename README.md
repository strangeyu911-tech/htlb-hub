# htlb-hub · 高性价比人生指南 衍生生态聚合入口

把 [HowToLiveBetter](https://github.com/eternity4719/HowToLiveBetter)（CC BY 4.0 的开源生活指南）散落在各处的
衍生项目聚到一处，并**逐个查证它同步到了上游哪一版**，把「谁落后了」这件事变成公开可见的。

- 线上地址：<https://htlb.strangeyu.xyz/>
- 动态徽章：`https://htlb.strangeyu.xyz/badge/<slug>.svg`
- 机器可读：<https://htlb.strangeyu.xyz/api/status.json>

## 它解决什么

这本书有 17 个衍生形态：网站、微信小程序、iOS/Android App、macOS 小组件、Chrome 插件、数据集、四格漫画。
它们的**唯一聚合点是 GitHub 源仓库**，而 GitHub 网页在国内中位要等 5 秒多、最坏 18 秒，波动十几秒。

更麻烦的是：**没有任何一个地方告诉你「哪个站是新的」**。这个项目干两件事 —— 聚齐入口 + 查证新鲜度。

⚠️ 收录范围**以上游 `衍生项目.md` 为唯一准绳**：上游收了我们才收。所以每次上游收新项目，
本地清单必须跟着补，否则页面会对外报一个偏小的总数（2026-10-13 就这样漏过 3 项：循证建议地图、渐好、阅读版）。

## 查证方法论（这是本项目的主要产出）

条目数的**官方口径**来自上游自己的 `tools/sync-stats.mjs`：

> 条目数 = `book/*.md` 里的 `###` 标题数

在这个口径下，用四条**能落地**的路子判断每个项目的同步边界（按证据强度排序）：

| 方法 | 做法 | 置信 |
|---|---|---|
| `artifact` | 读项目自己的产物文件（小程序数据包、App 的 `entries.json`、数据集的 `stats.json`、站点自带的数据文件、SSR 的 hydration 内联数据…），按官方口径数出真实条数 | 高 |
| `fork` | 它若是上游 fork，直接逐文件数它的 `book/*.md` | 高 |
| `sitemap` | 很多静态站给每条内容都生成了一个独立页面 → 数 sitemap 里的**逐条页**个数 | 高 |
| `runtime` | 源码级确认它每次打开直接拉上游正文 → **不存在「落后」**，从落后名单剔除 | 高 |
| `page` | 只有 `sitemap.xml` 的 `lastmod` 或页面自述数字 | 低 |

⚠️ **页面自述的数字只作交叉参考，绝不冒充实测** —— 数据结构里 `actualEntries`（实测）与
`selfDeclared`（自述）是两个字段，页面上也分开标注。

当前 17 项里 **14 项拿到实测依据**：1 项（iOS App）只能读商店页文案 —— App 的条目数不下载安装包就测不了，
这是诚实的边界；另 2 项（macOS 小组件、Chrome 插件）是源码确认的「运行时拉上游」，本就不该算作落后。
**「无版本信号」保持 0 项。**

### 四条铁律（都踩过坑）

1. **归一化必须双向**：比对的两边都要过同一套 `normAll()`（剔空白/标点/符号），单向会产生假阴性。
2. **`sitemap` 的 `lastmod` 要取全量最大值**，不能只拿第一个 —— howtolivebetter.net 有 62 个 `lastmod`，
   第一个是 10-11、最大值才是 10-12。
3. **「内容时间」优先用站点自己的构建/修订时间**（HTTP `Last-Modified`、更新记录页、App 版本发布日期），
   其次才是 `sitemap` 的 `lastmod`，最后才是「该条数首次出现在上游的时间」。
4. **可达性探针的超时不能按「快站」设。** 一开始给 9 s，把 WorkBuddy 托管的一个站误判成「打不开」——
   它首包要 14–19 s（冷启动），复测时第 2、3 轮只要 1.3 s。可达性问的是「**能不能打开**」，
   不是「快不快」；**速度由 `ms` 字段单独记录**。现阈值 18 s。

### 三个「读产物文件」的实战例子（2026-10-13 新增）

同一件事有几种完全不同的落点，正好说明为什么不能只靠一种模式：

- **循证建议地图**：单页站，构建期把全站索引打进 `data/home.json`（70 KB）→ 读 `stats.items`；
  首页 `title` / `meta description` / 正文首段三处自述同一个数，与之吻合。
- **渐好**：静态 SPA，全量内容在 `content.json`（3.9 MB）里 → `manifest.entryCount`
  = `entries` 数组实长 = `revisions` 实长，两条独立信号一致。它还把**上游 commit 与源仓库地址写进 manifest**，
  是这个生态里少见的「可机器核验同步点」做法，本站据此算出精确落后量。
- **阅读版（7 语言）**：多语言静态站，sitemap 有 5200 个 URL。中文原文**不带语言前缀**，
  剔掉 6 个语言前缀、再扣掉 `/guides/*` 说明页，剩下的 689 条才是它的正文条目数 ——
  与页面自述「搜索 689 条建议」一致。

### 一条被部分证伪的路，如实记下来（含自我更正）

最初想用「内容级探针」：拿上游最近新增的条目标题原文，去各站内容里做精确匹配。结果当时 14 项里 **13 项 0 命中**。

原因有两层：

1. 衍生站普遍**改写标题** —— 这条仍然成立（例如 life.xfun.fun 把「每天睡 7 小时」写成「每晚睡 7 小时左右，作息固定」）；
2. ~~正文压根不在页面或主 bundle 里~~ —— **这条当时判断错了，这里更正**。复查发现
   [howtolivebetter.net](https://howtolivebetter.net/) 的正文完整打在另一个 `modulepreload` chunk
   （`book-index-*.js`，174 KB）里，对上游标题 **684/685 = 99.9% 命中**。当时只抓了 `<script src>` 那两个资源，
   **漏掉了它 42 个 `modulepreload` 链接**。所以真实原因是「**靠猜资源路径本身不可靠**」，
   而不是人家没有正文。

现在做覆盖交叉验证时，会**遍历页面里所有资源引用**（`script src` + `modulepreload` + `link href` + `import()`），
不再猜路径。同时，「逐条页清单」（数 sitemap 里的逐条页）成了 `artifact` 之外第二条高置信路子 ——
`life.warpnav.com`、`how2livebetter.net`、`qingdan.lazyso.com` 三项就是靠它从「无版本信号」升到「实测」的。

## 页面结构

首屏只放「卡片 + 统计」，读者一眼看到 17 个入口、每个都能点进去。
四段技术内容 —— 逐项查证明细表、badge 接口、GitHub 墙内实测、方法边界 ——
统一收进一个 `<details>` 区块，**默认折叠**，想复核的读者主动点开才展开。

## 目录

```
fetch-upstream.sh      # 取上游 git 历史 → .cache/（git 只能在 shell 里跑，见下）
verify-upstream.mjs    # 解析 book/ 全量 diff → 条目数时间线 + 条目数→commit 映射
verify-ecosystem.mjs   # 逐项查证 17 个衍生项目的同步边界 → data/ecosystem.json
build-site.mjs         # 渲染单文件 HTML + badge + data/projects.json
build-worker.mjs       # 把 HTML/DATA 注入 worker.template.js → deploy/worker.js
worker.template.js     # Cloudflare Worker：聚合站 + 动态 badge + KV 数据层 + /api/ingest
selftest.mjs           # 本地起临时端口，用真实 HTTP 跑一遍 worker（含回灌链路）
deploy.mjs             # 部署到 Cloudflare Workers 并绑自定义域名
collect.mjs            # 采集：墙内可达性多轮探活（data/audit.json）
probe-github.mjs       # 8 通道 × 5 轮 GitHub 墙内实测（data/github-probe.json）
report.mjs             # 早期一次性对照报告生成器
```

`data/` 下是各阶段的产物，`build-site.mjs` 与 Worker 读的就是它们。

### 本地跑一遍

```bash
bash fetch-upstream.sh        # 需要 git；会完整 clone 上游（~18 MB）
node verify-upstream.mjs      # 需要 fetch 的产物
node verify-ecosystem.mjs     # 需要 audit.json（仓库里已有）+ 上一步产物
node build-site.mjs
node build-worker.mjs
node selftest.mjs             # 应输出「通过 32 / 失败 0」
```

> `selftest.mjs` 里期望的项目数**从 `data/projects.json` 读**，不写死 ——
> 写死过一次，上游一收新项目就假失败。

### 部署

```bash
CLOUDFLARE_API_TOKEN=xxx node deploy.mjs
```

⚠️ 三个坑，都踩过：

1. **`PUT /accounts/{id}/workers/scripts/{name}` 是全量替换** —— `bindings` 必须每次都带全
   （KV + secret），否则已有的绑定会被静默抹掉。`deploy.mjs` 已经这么做了。
2. **Worker 优先读 KV**，所以只重新部署脚本**不够** —— 页面 HTML 换了新数据、`/api/status.json`
   还在吐 KV 里的旧数据，两边会对不上。改完数据要**顺手 `POST /api/ingest` 回灌一次**。
3. **`fetch-upstream.sh` 不能用 `--filter=blob:none`**。仓库总共才 ~18 MB，而 blobless 会让
   `git log -p -- book/` 触发「逐 blob 按需 fetch」，实测挂十几分钟、且产出的 patch 是**截断的**
   —— 时间线会被静默写坏（累积条目数只剩 614）。完整 clone 只要几秒。

## 为什么不把重活放 Cloudflare Cron Trigger

Cloudflare Workers 免费版 CPU 上限是 **10 ms/次**（Cron Trigger 同样 10 ms；官方文档口径），
而「跑 git 全量历史 + 抓 17 个项目的产物文件」远超这个量级。

所以分工是：**GitHub Actions 干重活**（每天重算一次），**Worker 干轻活**（对外接口 + 实时取上游条目数），
两者用 `POST /api/ingest` 连接 —— Actions 把结果写进 KV，Worker 读 KV。

（另外 GitHub Actions 的 `schedule` 在 public 仓库**60 天无活动会被自动停用且静默失败**，
所以 workflow 每天都在仓库里 commit 状态快照，既留痕也防停用。这也意味着 **push 前要先 `fetch` + `rebase`**，
冲突只会落在生成物上。）

## 数据是活的，但不是秒级

- Worker 每次请求会去上游取一次最新条目数（边缘缓存 10 分钟）→ badge 上的数字是活的；
- 完整的逐项重算由 GitHub Actions **每天一次**，结果回灌 KV，页脚显示上次重算时间。

## 边界

- 本项目**不转载正文、不开评论区**。版权归上游及各衍生作者，有出入时以上游中文原文为准（CC BY 4.0）。
- 收录范围以上游 `衍生项目.md` 为准，**本站自己不在其内** —— 这一点在页面上明写，不装成"官方认可"。
- **不参与对比的内容一律单列「另见」**：目前放的是本站维护者自己的两个站点（《以日为鉴》增补版、下行周期补丁包）。
  区块标题带「未被收录进衍生项目清单」标记，正文写明它们不参与同步对比、不计入版本总数，
  避免读者误以为那些判断出自本书，或误以为本站与上游有隶属关系。
- 上游对「衍生项目」的界定是**读者在里面读到本书条目**（阅读站 / App / 插件 / 数据集）。
  本站是索引与查证页，不属于这个范围 —— 已提 PR 尝试过收录（#130），维护者未表态前先自行撤回。
- 可达性结论是**单机单时点**的：Cloudflare 站在国内「时通时不通」，探活全通只说明此刻通畅。
- 「门槛」一列照抄上游 `衍生项目.md` 的原文口径，非本项目核验。
- 「落后 N 天」有粒度盲区：条目数是某天某一刻达到的，而当天很多提交只改文档不改条目数。
  准确说法是「**若内容停在达到 N 条的那次提交，则内容落后 N 天**」。

## 许可

代码 MIT。上游正文 CC BY 4.0，版权归上游作者。
