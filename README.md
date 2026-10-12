# htlb-hub · 高性价比人生指南 衍生生态聚合入口

把 [HowToLiveBetter](https://github.com/eternity4719/HowToLiveBetter)（CC BY 4.0 的开源生活指南）散落在各处的
衍生项目聚到一处，并**逐个查证它同步到了上游哪一版**，把「谁落后了」这件事变成公开可见的。

- 线上地址：<https://htlb.strangeyu.xyz/>
- 动态徽章：`https://htlb.strangeyu.xyz/badge/<slug>.svg`
- 机器可读：<https://htlb.strangeyu.xyz/api/status.json>

## 它解决什么

这本书有 14 个衍生形态：网站、微信小程序、iOS/Android App、macOS 小组件、Chrome 插件、数据集、四格漫画。
它们的**唯一聚合点是 GitHub 源仓库**，而 GitHub 网页在国内中位要等 5 秒多、最坏 18 秒，波动十几秒。

更麻烦的是：**没有任何一个地方告诉你「哪个站是新的」**。这个项目干两件事 —— 聚齐入口 + 查证新鲜度。

## 查证方法论（这是本项目的主要产出）

条目数的**官方口径**来自上游自己的 `tools/sync-stats.mjs`：

> 条目数 = `book/*.md` 里的 `###` 标题数

在这个口径下，用四条**能落地**的路子判断每个项目的同步边界（按证据强度排序）：

| 方法 | 做法 | 置信 |
|---|---|---|
| `artifact` | 读项目自己的产物文件（小程序 bundle、App 的 `entries.json`、数据集的 `stats.json`…），按官方口径数出真实条数 | 高 |
| `fork` | 它若是上游 fork，直接逐文件数它的 `book/*.md` | 高 |
| `runtime` | 源码级确认它每次打开直接拉上游正文 → **不存在「落后」**，从落后名单剔除 | 高 |
| `page` | 只有 `sitemap.xml` 的 `lastmod` 或页面自述数字 | 低 |

⚠️ **页面自述的数字只作交叉参考，绝不冒充实测** —— 数据结构里 `actualEntries`（实测）与
`selfDeclared`（自述）是两个字段，页面上也分开标注。

### 一条被证伪的路，如实记下来

最初想用「内容级探针」：拿上游最近 14 次提交新增的 33 条条目标题原文，去各站内容里做精确匹配。
结果 **13/14 项 0 命中**。定向诊断出两个互相独立的原因：

1. 衍生站普遍**改写标题** —— 上游「家里老人遛狗，把牵绳握在手心……」在站上只剩「家里老人」能匹配；
2. 更根本的是**正文压根不在页面或主 bundle 里** —— howtolivebetter.net 的 638 KB bundle 对上游前 60 条老条目
   **0/60 命中**，说明它按需分块或运行时拉取，抓 `<script src>` 根本碰不到正文。

所以本项目**不拿探针当证据**，只留「条目数 → 上游提交」这一条可独立复核的硬链路。

## 目录

```
fetch-upstream.sh      # 取上游 git 历史 → .cache/（git 只能在 shell 里跑，见下）
verify-upstream.mjs    # 解析 book/ 全量 diff → 条目数时间线 + 条目数→commit 映射
verify-ecosystem.mjs   # 逐项查证 14 个衍生项目的同步边界 → data/ecosystem.json
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
node selftest.mjs             # 应输出「通过 28 / 失败 0」
```

### 部署

```bash
CLOUDFLARE_API_TOKEN=xxx node deploy.mjs
```

⚠️ 两个坑，都踩过：

1. **`PUT /accounts/{id}/workers/scripts/{name}` 是全量替换** —— `bindings` 必须每次都带全
   （KV + secret），否则已有的绑定会被静默抹掉。`deploy.mjs` 已经这么做了。
2. **`fetch-upstream.sh` 不能用 `--filter=blob:none`**。仓库总共才 ~18 MB，而 blobless 会让
   `git log -p -- book/` 触发「逐 blob 按需 fetch」，实测挂十几分钟、且产出的 patch 是**截断的**
   —— 时间线会被静默写坏（累积条目数只剩 614）。完整 clone 只要几秒。

## 为什么不把重活放 Cloudflare Cron Trigger

Cloudflare Workers 免费版 CPU 上限是 **10 ms/次**（Cron Trigger 同样 10 ms；官方文档口径），
而「跑 git 全量历史 + 抓 14 个项目的产物文件」远超这个量级。

所以分工是：**GitHub Actions 干重活**（每天重算一次），**Worker 干轻活**（对外接口 + 实时取上游条目数），
两者用 `POST /api/ingest` 连接 —— Actions 把结果写进 KV，Worker 读 KV。

（另外 GitHub Actions 的 `schedule` 在 public 仓库**60 天无活动会被自动停用且静默失败**，
所以 workflow 每天都在仓库里 commit 状态快照，既留痕也防停用。）

## 数据是活的，但不是秒级

- Worker 每次请求会去上游取一次最新条目数（边缘缓存 10 分钟）→ badge 上的数字是活的；
- 完整的逐项重算由 GitHub Actions **每天一次**，结果回灌 KV，页脚显示上次重算时间。

## 边界

- 本项目**不转载正文、不开评论区**。版权归上游及各衍生作者，有出入时以上游中文原文为准（CC BY 4.0）。
- 可达性结论是**单机单时点**的：Cloudflare 站在国内「时通时不通」，探活全通只说明此刻通畅。
- 「门槛」一列照抄上游 `衍生项目.md` 的原文口径，非本项目核验。
- 「落后 N 天」有粒度盲区：条目数是某天某一刻达到的，而当天很多提交只改文档不改条目数。
  准确说法是「**若内容停在达到 N 条的那次提交，则内容落后 N 天**」。

## 许可

代码 MIT。上游正文 CC BY 4.0，版权归上游作者。
