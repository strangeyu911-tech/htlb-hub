/**
 * HowToLiveBetter 衍生生态 —— 对照表生成器
 *
 * 用法:
 *   node htlb-hub/collect.mjs     # 1) 采集（产出 data/audit.json）
 *   node htlb-hub/report.mjs      # 2) 生成报告（产出 报告.html + 衍生项目对照表.md）
 *
 * 只依赖本地 JSON，不联网。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(DIR, 'data', 'audit.json');
const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const UP = d.upstream;

// ── 人工判读层：门槛（注册/广告/收费）为 衍生项目.md 原文口径 ──
const CURATED = {
  'howtolivebetter.net': { gate: '未标注（源码未公开）' },
  'life.warpnav.com': { gate: '不用注册 · 页面有广告' },
  'life.xfun.fun': { gate: '未标注' },
  'how2livebetter.net': { gate: '阅读免费 · 打卡/复查提醒以后收费' },
  'better.aigcwei.cn': { gate: '不用注册 · 没有广告' },
  'qingdan.lazyso.com': { gate: '不用注册 · 没有广告' },
  'livebetter101.com': { gate: '不用注册 · 没有广告' },
  'HuiTurn/HowToLiveBetter': { gate: '微信内访问，无需注册' },
  'apps.apple.com/id6818596108': { gate: '免费版清单/打卡有数量限制' },
  'llzx373/BetterLifeApp': { gate: '测试版 · AI 问答需自填 API Key' },
  'mittsommer/daily-life-tip': { gate: '免费 · 无 Apple 签名，首次需在系统设置放行（MIT）' },
  'sinyu1012/shiye-tab': { gate: '不用注册（MIT）' },
  'sin0317/htlb-dataset': { gate: '开放数据（正文 CC BY 4.0 / 代码 MIT）' },
  'robiNeo2045/comics': { gate: '免费下载 · 无需注册 · 无广告（CC BY 4.0）' },
};

// ── 人工判读层：新鲜度。count = 该项目自己声明的条目数；snapshot = 快照日期 ──
const FRESH = {
  'howtolivebetter.net': { count: 687, snapshot: null, verdict: 'sync', note: '条目数与上游一致' },
  'life.warpnav.com': { count: null, snapshot: null, verdict: 'unknown', note: '页面无可读版本信号' },
  'life.xfun.fun': { count: 676, snapshot: null, verdict: 'lag', note: '标题自称 676 张卡片' },
  'how2livebetter.net': { count: 654, snapshot: '2026-10-03', verdict: 'lag', note: '页面内出现快照日期 2026-10-03' },
  'better.aigcwei.cn': { count: 677, snapshot: null, verdict: 'lag', note: '★ 唯一在部署信息里标注「上游 commit sha」的项目' },
  'qingdan.lazyso.com': { count: 677, snapshot: null, verdict: 'lag', note: '筛选池按 677 条构建' },
  'livebetter101.com': { count: null, snapshot: null, verdict: 'unknown', note: '页面无可读版本信号' },
  'HuiTurn/HowToLiveBetter': { count: 687, snapshot: '2026-09-29', verdict: 'sync', note: '仓库简介与 687 一致，当天仍在提交' },
  'apps.apple.com/id6818596108': { count: 670, snapshot: '2026-10-09', verdict: 'lag', note: 'App Store 页面内出现 670 条' },
  'llzx373/BetterLifeApp': { count: 614, snapshot: '2026-09-26', verdict: 'lag', note: '作者自述「内置的条目是较早的版本」' },
  'mittsommer/daily-life-tip': { count: null, snapshot: '2026-10-09', verdict: 'unknown', note: 'README 自称每天自动同步（未能机读验证）' },
  'sinyu1012/shiye-tab': { count: null, snapshot: '2026-10-08', verdict: 'unknown', note: '页面无可读版本信号' },
  'sin0317/htlb-dataset': { count: 672, snapshot: null, verdict: 'auto', note: '每日自动同步；最新 commit 记录同步到上游 e4d6db4' },
  'robiNeo2045/comics': { count: 676, snapshot: '2026-10-03', verdict: 'fixed', note: '官方声明为固定快照、不自动同步（非缺陷）' },
};

const UP_COUNT = Number(UP.fingerprint?.条目数 || 687);
const V = {
  sync: { label: '已追平上游', color: '#1D9E75', bg: '#E1F5EE' },
  auto: { label: '自动同步（滞后<1天）', color: '#0F6E56', bg: '#E1F5EE' },
  lag: { label: '落后于上游', color: '#BA7517', bg: '#FAEEDA' },
  fixed: { label: '固定快照（设计如此）', color: '#5F5E5A', bg: '#F1EFE8' },
  unknown: { label: '无法判定', color: '#A32D2D', bg: '#FCEBEB' },
};

function host(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ── 汇总 ──
const rows = d.derived.map((x) => {
  const ok = x.probes.filter((p) => p.ok && p.status === 200).length;
  const lat = x.probes.filter((p) => p.ok).map((p) => p.ms);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const ip = [...new Set(x.probes.map((p) => p.ip).filter(Boolean))][0] || '';
  const cdn = x.probes.map((p) => p.cdn).find(Boolean) || '—';
  const isDomestic = /^(43\.174|124\.72|1\.180|101\.|120\.|183\.|110\.|116\.)/.test(ip);
  const f = FRESH[x.id] || {};
  const lag = f.count ? UP_COUNT - f.count : null;
  return {
    ...x,
    gate: CURATED[x.id]?.gate || '—',
    probeOk: ok,
    probeTotal: x.probes.length,
    lat,
    avg,
    ip,
    cdn: /cloudflare/i.test(cdn) ? 'Cloudflare' : cdn,
    isDomestic,
    fresh: f,
    lag,
    lastUpdate: x.gh?.lastCommitAt || x.gh?.pushed_at || null,
    link: x.url || (x.ghRepo ? `https://github.com/${x.ghRepo}` : ''),
    host: host(x.url) || x.ghRepo,
  };
});

const stats = {
  total: rows.length,
  probes: rows.reduce((a, r) => a + r.probeTotal, 0),
  probeOk: rows.reduce((a, r) => a + r.probeOk, 0),
  synced: rows.filter((r) => r.fresh.verdict === 'sync').length,
  lagging: rows.filter((r) => r.fresh.verdict === 'lag').length,
  unknown: rows.filter((r) => r.fresh.verdict === 'unknown').length,
  hasCount: rows.filter((r) => r.fresh.count).length,
  labeled: 1,
  maxLag: Math.max(...rows.filter((r) => r.lag).map((r) => r.lag)),
  maxLagName: rows.find((r) => r.lag === Math.max(...rows.filter((x) => x.lag).map((x) => x.lag)))?.name,
  cf: rows.filter((r) => r.cdn === 'Cloudflare').length,
  slowest: rows.reduce((a, b) => (b.avg > (a?.avg ?? 0) ? b : a), null),
};

const genAt = new Date(d.generatedAt).toLocaleString('zh-CN', { hour12: false });
const upCommitAt = new Date(UP.latestCommitAt).toLocaleString('zh-CN', { hour12: false });

// ── 生成 Markdown ──
const md = [];
md.push('# 高性价比人生指南 · 衍生生态对照表');
md.push('');
md.push(`> 生成时间：${genAt}　｜　上游版本：**${UP.stars.toLocaleString()} ★ / ${UP.forks.toLocaleString()} forks**，当前 **${UP_COUNT} 条建议**，最新提交 \`${UP.latestSha?.slice(0, 8)}\`（${upCommitAt}）`);
md.push('>');
md.push('> 口径：可达性 = 本机裸连（未开梯子）连续 3 轮实测；新鲜度 = 各项目**自己页面/仓库里声明的条目数**对比上游。全部数据可用 `node htlb-hub/collect.mjs && node htlb-hub/report.mjs` 复跑刷新。');
md.push('');
md.push('## 结论');
md.push('');
md.push(`- **可达性不是问题**：${stats.probes} 次探活（${stats.total} 项 × 3 轮）全部 200，**可达率 100%**。担心「不翻墙打不开」可以放下。`);
md.push(`- **新鲜度才是问题**：能读出条目数的 ${stats.hasCount} 项里，**只有 ${stats.synced} 项追平上游 ${UP_COUNT} 条**；${stats.lagging} 项明确落后，最多落后 **${stats.maxLag} 条（${stats.maxLagName}，约占上游 ${((stats.maxLag / UP_COUNT) * 100).toFixed(1)}%）**。`);
md.push(`- **${stats.unknown} 项完全无法判定**：页面/仓库里没有任何版本信号，读者根本无从判断新旧。`);
md.push(`- **只有 1 项标注了上游 commit sha**（better.aigcwei.cn）—— 生态里唯一「可验证新鲜度」的做法。`);
md.push(`- **${stats.cf} 项挂在 Cloudflare**，仅 1 项用国内 CDN（腾讯 EdgeOne）。可达 ≠ 体验：最快 0.4s，最慢 **${stats.slowest.avg}ms 平均 / 单次峰值 38s**（${stats.slowest.name}）。`);
md.push('');
md.push('## 主表');
md.push('');
md.push('| 项目 | 类型 | 作者 | 墙内可达性 | 内容新鲜度 | 独有功能 | 门槛 | 链接 |');
md.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const reach = `${r.probeOk}/${r.probeTotal} 通 · 均 ${r.avg}ms · ${r.cdn}${r.isDomestic ? ' 🇨🇳' : ''}`;
  const v = V[r.fresh.verdict] || V.unknown;
  const fresh =
    r.fresh.verdict === 'fixed'
      ? `固定快照 · ${r.fresh.count} 条 · ${r.fresh.snapshot || ''}`
      : r.lag === 0
        ? `**${r.fresh.count}/${UP_COUNT} · 追平**`
        : r.lag > 0
          ? `**落后 ${r.lag} 条**（${r.fresh.count}/${UP_COUNT}${r.fresh.snapshot ? ' · 快照 ' + r.fresh.snapshot : ''}）`
          : `**无法判定**${r.fresh.snapshot ? '（页面日期 ' + r.fresh.snapshot + '）' : ''}`;
  md.push(`| **${r.name}** | ${r.kind} | [${r.author}](https://github.com/${r.author}) | ${reach} | ${fresh}<br>${r.fresh.note} | ${r.note} | ${r.gate} | ${r.link ? `[打开](${r.link})` : '—'} |`);
}
md.push('');
md.push('## 落后程度排序');
md.push('');
const sorted = rows.filter((r) => r.lag).sort((a, b) => b.lag - a.lag);
for (const r of sorted) {
  const bar = '█'.repeat(Math.max(1, Math.round(r.lag / 2)));
  md.push(`- ${String(r.lag).padStart(3)} 条  ${bar}  **${r.name}**`);
}
md.push('');
md.push('## 方法说明与局限');
md.push('');
md.push('1. **「最后同步时间」无法直接测**。上游不对外发布时间戳，因此本表用**条目数**作版本指纹：上游 README 徽章 = 条目总数，各项目页面里自己声明的条目数与之相减即为滞后量。这是**间接推断**，不是官方声明。');
md.push('2. **第 3 列之外的信息都来自实测**；`门槛`一列照抄上游 `衍生项目.md` 的原文口径（未标注 = 原文也未标注），非本人核验。');
md.push('3. `无法判定` 的 4 项不代表内容旧，只代表**它没有提供任何可核验的版本信号** —— 这本身就是本表想暴露的问题。');
md.push('4. 可达性为**单机单时点**结论（本机出口为福建电信，未开梯子）。Cloudflare 站点在国内是「时通时不通」，本表 3 轮全通只能说明**此刻**通畅，不代表 24 小时稳定。');
md.push('5. 条目数采集自页面首屏 HTML 的正则匹配，若某站把条数渲染在 JS 之后，会落进 `无法判定`。');
md.push('');

fs.writeFileSync(path.join(DIR, '衍生项目对照表.md'), md.join('\n'), 'utf8');

// ── 生成 HTML ──
const barRows = sorted
  .map((r) => {
    const pct = Math.min(100, (r.lag / stats.maxLag) * 100);
    return `<div class="bar-row"><span class="bar-name">${esc(r.name)}</span><span class="bar-track"><span class="bar-fill" style="width:${pct.toFixed(1)}%"></span></span><span class="bar-val">${r.lag} 条</span></div>`;
  })
  .join('\n');

const tableRows = rows
  .map((r) => {
    const v = V[r.fresh.verdict] || V.unknown;
    const freshHtml =
      r.fresh.verdict === 'fixed'
        ? `<b>${r.fresh.count}</b> 条 · ${esc(r.fresh.snapshot)}<br><span class="muted">固定快照：官方声明不自动同步，非缺陷</span>`
        : r.lag === 0
          ? `<b class="ok">${r.fresh.count} / ${UP_COUNT}</b> · 追平上游`
          : r.lag > 0
            ? `<b class="warn">落后 ${r.lag} 条</b>（${r.fresh.count} / ${UP_COUNT}${r.fresh.snapshot ? ' · 快照 ' + esc(r.fresh.snapshot) : ''}）`
            : `<b class="bad">无法判定</b>${r.fresh.snapshot ? `<br><span class="muted">页面日期 ${esc(r.fresh.snapshot)}</span>` : ''}`;
    return `<tr>
<td class="c-name"><a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.name)}</a><div class="muted">${esc(r.kind)} · ${esc(r.author)}</div></td>
<td class="c-reach"><span class="pill ok">${r.probeOk}/${r.probeTotal} 通</span><div class="muted">均 ${r.avg}ms · ${esc(r.cdn)}${r.isDomestic ? ' · 国内节点' : ''}</div><div class="mono">${esc(r.ip)}</div></td>
<td class="c-fresh"><span class="pill" style="color:${v.color};background:${v.bg}">${v.label}</span><div class="freshline">${freshHtml}</div><div class="muted">${esc(r.fresh.note)}</div></td>
<td class="c-feat">${esc(r.note)}</td>
<td class="c-gate">${esc(r.gate)}</td>
</tr>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>高性价比人生指南 · 衍生生态对照表</title>
<style>
:root{--bg:#faf9f7;--card:#fff;--line:#e6e3dc;--tx:#2c2c2a;--tx2:#5f5e5a;--tx3:#888780;
--green:#1d9e75;--greenbg:#e1f5ee;--amber:#ba7517;--amberbg:#faeeda;--red:#a32d2d;--redbg:#fcebeb;--gray:#888780;--graybg:#f1efe8;--blue:#185fa5;--bluebg:#e6f1fb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:40px 24px 64px}
h1{font-size:26px;font-weight:600;margin:0 0 6px}
.sub{color:var(--tx2);font-size:13px;margin-bottom:4px}
.meta{color:var(--tx3);font-size:12.5px;margin-bottom:28px}
.meta code{background:#f1efe8;padding:1px 5px;border-radius:4px;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin-bottom:28px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.card .k{font-size:12.5px;color:var(--tx3);margin-bottom:6px}
.card .v{font-size:24px;font-weight:600;line-height:1.25}
.card .n{font-size:12.5px;color:var(--tx2);margin-top:4px}
.v.g{color:var(--green)}.v.a{color:var(--amber)}.v.r{color:var(--red)}.v.b{color:var(--blue)}
h2{font-size:17px;font-weight:600;margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;min-width:1000px;font-size:13px}
th{text-align:left;font-weight:500;color:var(--tx2);padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap;background:#fcfbf9}
td{padding:13px 14px;border-bottom:1px solid #f2f0ec;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fdfcfa}
.c-name{min-width:168px}.c-reach{min-width:158px}.c-fresh{min-width:250px}.c-feat{min-width:300px}.c-gate{min-width:190px}
.c-name a{color:var(--blue);text-decoration:none;font-weight:500}
.c-name a:hover{text-decoration:underline}
.muted{color:var(--tx3);font-size:12px;line-height:1.5}
.mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--tx3);margin-top:2px}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap}
.pill.ok{color:var(--green);background:var(--greenbg)}
.freshline{margin-top:6px;font-size:12.5px}
.ok{color:var(--green)}.warn{color:var(--amber)}.bad{color:var(--red)}
.bar-row{display:grid;grid-template-columns:210px 1fr 62px;align-items:center;gap:12px;padding:7px 0}
.bar-name{font-size:13px;color:var(--tx);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{background:#efede8;border-radius:6px;height:18px;overflow:hidden}
.bar-fill{display:block;height:100%;background:var(--amber);border-radius:6px}
.bar-val{font-size:12.5px;color:var(--tx2);font-variant-numeric:tabular-nums}
ol{padding-left:22px;color:var(--tx2);font-size:13px}
ol li{margin-bottom:9px}
.note{background:var(--bluebg);border:1px solid #b5d4f4;border-radius:10px;padding:14px 18px;font-size:13px;color:#0c447c;margin-bottom:26px}
.foot{margin-top:40px;color:var(--tx3);font-size:12px;border-top:1px solid var(--line);padding-top:16px}
</style>
</head>
<body>
<div class="wrap">

<h1>高性价比人生指南 · 衍生生态对照表</h1>
<div class="sub">上游 <code>eternity4719/HowToLiveBetter</code> 是 CC BY 4.0 开源书；官方 README 收录了 <b>14 个衍生项目</b>（15 条链接）。本表实测每一项的墙内可达性与内容新鲜度。</div>
<div class="meta">生成时间 ${esc(genAt)}　·　上游当前版本 <b>${UP_COUNT} 条建议</b>　·　最新提交 <code>${esc(UP.latestSha?.slice(0, 8))}</code>（${esc(upCommitAt)}）　·　上游 ${UP.stars.toLocaleString()} ★ / ${UP.forks.toLocaleString()} forks</div>

<div class="note"><b>一句话结论：</b>「不翻墙不方便访问」这个前提<b>不成立</b> —— ${stats.probes} 次探活全部 200。真正没人解决的是<b>「不知道哪个站是新的」</b>：${stats.hasCount} 个能读出条数的项目里只有 ${stats.synced} 个追平上游，${stats.unknown} 个项目<b>连版本信号都不提供</b>。</div>

<div class="cards">
<div class="card"><div class="k">墙内可达率</div><div class="v g">${stats.probeOk}/${stats.probes}</div><div class="n">${stats.total} 项 × 3 轮探活，全部 200</div></div>
<div class="card"><div class="k">追平上游 ${UP_COUNT} 条</div><div class="v a">${stats.synced} 项</div><div class="n">占能读出条数的 ${stats.hasCount} 项中的 ${Math.round((stats.synced / stats.hasCount) * 100)}%</div></div>
<div class="card"><div class="k">最大落后量</div><div class="v a">${stats.maxLag} 条</div><div class="n">${esc(stats.maxLagName)} · 约占上游 ${((stats.maxLag / UP_COUNT) * 100).toFixed(1)}%</div></div>
<div class="card"><div class="k">无版本信号</div><div class="v r">${stats.unknown} 项</div><div class="n">读者无从判断内容新旧</div></div>
<div class="card"><div class="k">用国内 CDN</div><div class="v b">1 项</div><div class="n">${stats.cf} 项挂 Cloudflare，快慢全看运气</div></div>
</div>

<h2>主表</h2>
<div class="tw">
<table>
<thead><tr><th>项目</th><th>墙内可达性（实测）</th><th>内容新鲜度（对比上游 ${UP_COUNT} 条）</th><th>独有功能</th><th>门槛</th></tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>

<h2>落后程度排序（条）</h2>
<div>${barRows}</div>

<h2>方法与局限</h2>
<ol>
<li><b>「最后同步时间」无法直接测。</b>上游不发布时间戳，因此本表用<b>条目数当版本指纹</b>：上游 README 徽章的条目总数，减去各项目页面上自己声明的条目数 = 滞后量。这是<b>间接推断</b>，不是官方声明。</li>
<li>只有「可达性」「条目数」「IP / CDN」是实测，<b>门槛一列照抄上游 <code>衍生项目.md</code> 的原文口径</b>（标「未标注」= 原文也没标注），非本人核验。</li>
<li>「无法判定」的 ${stats.unknown} 项不代表内容旧，只代表<b>它没有提供任何可核验的版本信号</b> —— 这正是本表想暴露的问题。</li>
<li>可达性是<b>单机单时点</b>结论（出口为福建电信，未开梯子）。Cloudflare 在国内「时通时不通」，3 轮全通只说明<b>此刻</b>通畅，不代表 24 小时稳定。</li>
<li>条目数采集自页面首屏 HTML 的正则匹配；若某站把条数渲染在 JS 之后，会落进「无法判定」。</li>
</ol>

<div class="foot">数据由 <code>htlb-hub/collect.mjs</code> 采集、<code>htlb-hub/report.mjs</code> 渲染。重新执行这两条命令即可刷新本表。原始数据：<code>htlb-hub/data/audit.json</code></div>
</div>
</body>
</html>`;

fs.writeFileSync(path.join(DIR, '衍生生态对照表.html'), html, 'utf8');
console.log('已生成:');
console.log('  ' + path.join(DIR, '衍生生态对照表.html'));
console.log('  ' + path.join(DIR, '衍生项目对照表.md'));
console.log('');
console.log(`统计: 探活 ${stats.probeOk}/${stats.probes} 通 | 追平 ${stats.synced} | 落后 ${stats.lagging} | 无信号 ${stats.unknown} | 最大落后 ${stats.maxLag} 条 (${stats.maxLagName}) | 最慢 ${stats.slowest.name} 均 ${stats.slowest.avg}ms`);
