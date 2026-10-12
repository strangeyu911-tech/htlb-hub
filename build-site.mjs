/**
 * 生成聚合站 —— 单文件静态 HTML，零外部依赖
 * 用法: node htlb-hub/build-site.mjs
 * 输出: htlb-hub/site/index.html
 *       htlb-hub/data/projects.json   ← 规范数据集（worker 内嵌 + GitHub Actions 回灌同一份）
 *
 * 数据来源（全部本地已有，可复跑）：
 *   data/audit.json            采集：墙内可达性 3 轮探活 + 页面版本信号
 *   data/ecosystem.json        查证：逐项同步边界（四条方法：artifact / fork / runtime / page）
 *   data/github-probe.json     8 通道 × 5 轮 GitHub 墙内实测
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'audit.json'), 'utf8'));
const eco = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'ecosystem.json'), 'utf8'));
const ghProbe = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'github-probe.json'), 'utf8'));
const AU = audit.upstream || {};
/** upstream 元信息来自 ecosystem.json（同步查证口径），再补 audit.json 里的仓库热度 */
const UP = Object.assign({}, eco.upstream, {
  stars: AU.stars,
  forks: AU.forks,
  license: AU.license || 'CC BY 4.0',
  readmeRaw: `https://raw.githubusercontent.com/${eco.upstream.repo}/main/README.md`,
});
const UP_COUNT = UP.entries;

const ECO_BY_ID = Object.fromEntries(eco.projects.map((p) => [p.id, p]));

/**
 * 人工判读层（唯一非实测的部分，全部可追溯来源）
 *   tags      从各站实际功能页读出来的「它多做了什么」
 *   gate      照抄上游 衍生项目.md 原文的「门槛」口径；标「未标注」= 原文也没写
 *   note      说明这个站是什么
 *   verdict   仅在实测判不出、但有官方声明时覆盖（如固定快照）
 */
const CURATED = {
  'howtolivebetter.net': { tags: ['打卡/进度'], gate: '未标注（源码未公开）', note: '把条目变成待办清单，能勾、能收藏。' },
  'life.warpnav.com': { tags: ['不用注册', '能搜索'], gate: '不用注册 · 页面有广告', note: '按场景重新编排的阅读版手册。' },
  'life.xfun.fun': { tags: ['能搜索', '能分享'], gate: '未标注', note: '把每条建议画成一张生活卡片，可滑动浏览。' },
  'how2livebetter.net': { tags: ['阶段自测', '打卡/进度', '能搜索'], gate: '阅读免费 · 打卡/复查提醒以后收费', note: '先做人生阶段自测，再只给你那个阶段该看的条目。' },
  'better.aigcwei.cn': { tags: ['不用注册', '无广告', '能搜索', '给 AI 用'], gate: '不用注册 · 没有广告', note: '按性价比排序，并同时提供 MCP 接口给 AI 调用。' },
  'qingdan.lazyso.com': { tags: ['不用注册', '无广告', '打卡/进度'], gate: '不用注册 · 没有广告', note: '极简清单形态，只留可执行的动作。' },
  'livebetter101.com': { tags: ['不用注册', '无广告', '游戏化'], gate: '不用注册 · 没有广告', note: '把条目拆成 101 天挑战，打卡式推进。' },
  'HuiTurn/HowToLiveBetter': { tags: ['手机端', '能搜索', '能离线'], gate: '微信内访问，无需注册', note: '微信小程序：全文搜索、收藏、离线、每日一读。' },
  'apps.apple.com/id6818596108': { tags: ['手机端', '能离线', '打卡/进度'], gate: '免费版清单/打卡有数量限制', note: 'iOS 行动版，条目 + 打卡一体。' },
  'llzx373/BetterLifeApp': { tags: ['手机端', '打卡/进度', '给 AI 用'], gate: '测试版 · AI 问答需自填 API Key', note: '安卓测试版，内置 AI 问答。' },
  'mittsommer/daily-life-tip': { tags: ['桌面端', '最省时间', '能分享'], gate: '免费 · 无 Apple 签名，首次需放行（MIT）', note: 'macOS 桌面小组件，每天只给你一条。' },
  'sinyu1012/shiye-tab': { tags: ['桌面端', '最省时间', '不用注册'], gate: '不用注册（MIT）', note: 'Chrome 新标签页，顺手看一条。' },
  'sin0317/htlb-dataset': { tags: ['给 AI 用', '数据源'], gate: '开放数据（CC BY 4.0 / MIT）', note: '全量结构化数据集（JSON/CSV/SQLite），自称每日同步。' },
  'robiNeo2045/comics': { tags: ['能离线', '娱乐'], gate: '免费下载 · 无需注册 · 无广告', note: '四格漫画 PDF，把条目画出来。',
    verdict: 'fixed', verdictNote: '作者官方声明为固定快照、不打算自动同步 —— 这不是缺陷，是设计选择。' },
};

const V = {
  sync: { label: '已追平上游', color: '#0f6e56', bg: '#e1f5ee' },
  runtime: { label: '运行时自动跟进', color: '#0f6e56', bg: '#e1f5ee' },
  lag: { label: '落后于上游', color: '#8a5300', bg: '#faeeda' },
  fixed: { label: '固定快照', color: '#5f5e5a', bg: '#f1efe8' },
  unknown: { label: '无版本信号', color: '#a32d2d', bg: '#fcebeb' },
};
const TYPE_ORDER = ['网站+MCP', '网站', '小程序', 'iOS App', 'Android App', 'macOS 小组件', 'Chrome 插件', '数据集', '漫画'];

const rows = audit.derived.map((x) => {
  const c = CURATED[x.id] || { tags: [], gate: '—', note: x.note || '' };
  const e = ECO_BY_ID[x.id] || {};

  // ── 同步判定顺序：人工覆盖 → 运行时跟随 → 实测/自述条数 → 无信号 ──
  let verdict;
  if (c.verdict) verdict = c.verdict;
  else if (e.runtimeFetch || e.status === 'runtime') verdict = 'runtime';
  else if (e.status === 'sync') verdict = 'sync';
  else if (e.status === 'lag') verdict = 'lag';
  else verdict = 'unknown';

  const measured = e.actualEntries != null ? e.actualEntries : null;
  const declared = measured != null ? measured : e.selfDeclared != null ? e.selfDeclared : null;
  const lag = declared == null ? null : Math.max(0, UP_COUNT - declared);

  const okRuns = x.probes.filter((p) => p.ok && p.status === 200);
  const lat = okRuns.map((p) => p.ms);
  const ip = [...new Set(x.probes.map((p) => p.ip).filter(Boolean))][0] || '';
  const rawCdn = x.probes.map((p) => p.cdn).find(Boolean) || '';
  const cdn = /cloudflare/i.test(rawCdn) ? 'Cloudflare' : /edgeone/i.test(rawCdn) ? '腾讯 EdgeOne' : rawCdn || '—';
  const slug = x.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  return {
    id: x.id,
    name: x.name,
    slug,
    author: x.author,
    kind: x.kind,
    url: x.url || (x.ghRepo ? `https://github.com/${x.ghRepo}` : ''),
    ghRepo: x.ghRepo || null,
    note: c.note,
    tags: c.tags || [],
    gate: c.gate,
    // 同步状态（来自 ecosystem.json）
    verdict,
    basis: e.basis || 'none',
    confidence: e.confidence || 'none',
    actualEntries: measured,
    selfDeclared: e.selfDeclared != null ? e.selfDeclared : null,
    selfDeclaredFrom: e.selfDeclaredFrom || null,
    declared,
    lag,
    lagDays: e.lagDays != null ? e.lagDays : null,
    lagEntries: e.lagEntries != null ? e.lagEntries : null,
    runtimeFetch: !!e.runtimeFetch,
    ownVersion: e.ownVersion || null,
    ownVersionShort: e.ownVersionShort || null,
    ownVersionDate: e.ownVersionDate || null,
    ownGeneratedAt: e.ownGeneratedAt || null,
    sitemapLastmod: e.sitemapLastmod || null,
    sitemapUrls: e.sitemapUrls != null ? e.sitemapUrls : null,
    evidence: e.evidence || [],
    // 可达性（来自 audit.json）
    signals: x.signals || [],
    ok: okRuns.length,
    total: x.probes.length,
    avg: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 9999,
    ip,
    cdn,
    domestic: /^(43\.174|124\.72)/.test(ip),
    lastEdit: (x.gh?.lastCommitAt || x.gh?.pushed_at || '').slice(0, 10),
    typeIdx: TYPE_ORDER.indexOf(x.kind),
  };
});

// 排序：运行时/追平在前 → 落后（少→多）→ 无信号 → 固定快照
const rankOf = (r) => (r.verdict === 'runtime' ? -3 : r.verdict === 'sync' ? -2 : r.verdict === 'fixed' ? 2 : r.verdict === 'unknown' ? 1 : 0);
rows.sort((a, b) => {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const la = a.lag == null ? 9999 : a.lag;
    const lb = b.lag == null ? 9999 : b.lag;
    if (la !== lb) return la - lb;
  }
  return a.typeIdx - b.typeIdx;
});

const stats = {
  total: rows.length,
  probes: rows.reduce((a, r) => a + r.total, 0),
  okProbes: rows.reduce((a, r) => a + r.ok, 0),
  sync: rows.filter((r) => r.verdict === 'sync').length,
  runtime: rows.filter((r) => r.verdict === 'runtime').length,
  lag: rows.filter((r) => r.verdict === 'lag').length,
  unknown: rows.filter((r) => r.verdict === 'unknown').length,
  fixed: rows.filter((r) => r.verdict === 'fixed').length,
  measured: rows.filter((r) => r.actualEntries != null).length,
  selfDeclaredOnly: rows.filter((r) => r.actualEntries == null && r.selfDeclared != null).length,
  withOwnVersion: rows.filter((r) => r.ownVersion).length,
  hasCount: rows.filter((r) => r.declared != null).length,
  maxLag: rows.filter((r) => r.lag != null).length ? Math.max(...rows.filter((r) => r.lag != null).map((r) => r.lag)) : 0,
  maxLagName: rows.filter((r) => r.lag != null).sort((a, b) => b.lag - a.lag)[0]?.name || '',
  cf: rows.filter((r) => r.cdn === 'Cloudflare').length,
  domestic: rows.filter((r) => r.domestic).length,
};

const ALL_TAGS = [...new Set(rows.flatMap((r) => r.tags))];

// ── badge 生成（构建期与 worker 运行期共用同一算法）──
function badge(left, right, color) {
  const cw = (s) => Math.round(s.length * 6.4 + 12);
  const lw = cw(left);
  const rw = cw(right);
  const W = lw + rw;
  const lx = (lw / 2) * 10;
  const rx = (lw + rw / 2) * 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" viewBox="0 0 ${W * 10} 200" role="img" aria-label="${left}: ${right}"><title>${left}: ${right}</title><g><rect width="${lw * 10}" height="200" fill="#5f5e5a"/><rect x="${lw * 10}" width="${rw * 10}" height="200" fill="${color}"/><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110"><text x="${lx}" y="140" fill="#010101" fill-opacity=".3" transform="scale(.1)">${left}</text><text x="${lx}" y="130" transform="scale(.1)">${left}</text><text x="${rx}" y="140" fill="#010101" fill-opacity=".3" transform="scale(.1)">${right}</text><text x="${rx}" y="130" transform="scale(.1)">${right}</text></g></g></svg>`;
}
function badgeFor(r, upCount = UP_COUNT) {
  if (r.verdict === 'fixed') return badge('高性价比人生指南', `固定快照 ${r.declared} 条`, '#888780');
  if (r.verdict === 'runtime') return badge('高性价比人生指南', '运行时跟随上游', '#1d9e75');
  if (r.declared == null) return badge('高性价比人生指南', '版本未标注', '#a32d2d');
  if (r.lag === 0) return badge('高性价比人生指南', `已同步 · ${r.declared} 条`, '#1d9e75');
  return badge('高性价比人生指南', `落后 ${r.lag} 条 · ${r.declared}/${upCount}`, '#ba7517');
}

const BASIS_LABEL = {
  measured: '实测：读该项目自己的产物文件，数出真实条数',
  'self-declared': '页面自述（弱信号，未实测）',
  runtime: '源码级确认：运行时拉上游正文',
  none: '没有任何可核验的版本信号',
};
const CONF_LABEL = { high: '高', medium: '中', low: '低', none: '无' };

// ── 卡片 ──
const cards = rows
  .map((r) => {
    const v = V[r.verdict];
    const lagBadge =
      r.verdict === 'fixed'
        ? `<span class="lag dim2">快照 ${r.declared} 条 · 作者声明不打算自动同步</span>`
        : r.verdict === 'runtime'
          ? `<span class="lag ok">♻️ 运行时拉上游正文 —— 不存在「落后」</span>`
          : r.declared == null
            ? `<span class="lag bad">❓ 找不到任何可核验的版本信号</span>`
            : r.lag === 0
              ? `<span class="lag ok">✅ 追平上游 ${UP_COUNT} 条</span>`
              : `<span class="lag warn">⚠️ 落后 ${r.lag} 条<span class="dim">（${r.declared}/${UP_COUNT}）</span></span>`;
    const dn = r.lagDays != null ? ` · 内容大约停在 ${Math.round(r.lagDays * 10) / 10} 天前` : '';
    return `<article class="card" data-tags="${r.tags.join(',')}" data-lag="${r.lag === null ? -1 : r.lag}" data-speed="${r.avg}" data-type="${r.typeIdx}">
  <div class="chead">
    <h3><a href="${r.url}" target="_blank" rel="noopener">${r.name}</a></h3>
    <span class="kind">${r.kind}</span>
  </div>
  <div class="byline">by <a href="https://github.com/${r.author}" target="_blank" rel="noopener">${r.author}</a>${r.lastEdit ? ` · 末次改动 ${r.lastEdit}` : ''}</div>
  <div class="freshbox" style="border-color:${v.color}33;background:${v.bg}">
    <div class="vrow"><span class="pill" style="color:${v.color}">${v.label}</span></div>
    ${lagBadge}
    <div class="fnote">依据：${BASIS_LABEL[r.basis] || BASIS_LABEL.none}（置信 ${CONF_LABEL[r.confidence] || '无'}）${dn}</div>
  </div>
  <p class="feat">${r.note}</p>
  <div class="tags">${r.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
  <div class="foot">
    <span class="reach ${r.ok === r.total ? 'ok' : 'warn'}">${r.ok}/${r.total} 通 · ${r.avg}ms</span>
    <span class="dim">${r.cdn}${r.domestic ? ' · 国内节点' : ''}</span>
    <span class="gate">${r.gate}</span>
  </div>
</article>`;
  })
  .join('\n');

const badgeRows = rows
  .map(
    (r) => `<div class="brow">
  <div class="bmeta"><b>${r.name}</b><span class="dim">${
    r.verdict === 'sync' ? '建议挂：显示已同步' : r.verdict === 'runtime' ? '挂上说明是运行时跟随' : r.verdict === 'lag' ? '挂上会暴露落后，慎用' : r.verdict === 'fixed' ? '挂上说明是快照' : '无同步声明'
  }</span></div>
  <div class="bsvg"><img src="/badge/${r.slug}.svg" alt="${r.name} 同步状态" loading="lazy" height="20"></div>
  <code class="bcode">![同步状态](https://htlb.strangeyu.xyz/badge/${r.slug}.svg)</code>
</div>`
  )
  .join('\n');

const detailRows = rows
  .map((r) => {
    const basisTxt =
      r.basis === 'measured' ? `实测产物 <span class="dim">(${r.selfDeclared != null ? '另有页面自述 ' + r.selfDeclared : '非页面自述'})</span>`
        : r.basis === 'self-declared' ? '页面自述 <span class="dim">（弱）</span>'
          : r.basis === 'runtime' ? '运行时拉取'
            : '—';
    const nTxt = r.declared != null ? String(r.declared) : '—';
    const lagTxt = r.verdict === 'runtime' ? '跟随' : r.verdict === 'fixed' ? '快照' : r.lag == null ? '—' : r.lag === 0 ? '0 ✅' : r.lag + ' ⚠️';
    return `<tr>
  <td><b>${r.name}</b><div class="dim">${r.kind} · ${r.author}</div></td>
  <td>${basisTxt}<div class="dim">置信 ${CONF_LABEL[r.confidence] || '无'}</div></td>
  <td class="num">${nTxt}</td>
  <td class="num">${lagTxt}</td>
  <td>${r.evidence.slice(0, 3).map((e) => `<div class="ev">${e}</div>`).join('') || '<span class="dim">—</span>'}</td>
</tr>`;
  })
  .join('\n');

const ghRows = ghProbe.results
  .map(
    (r) => `<tr><td>${r.label}</td><td class="num">${r.success}/${r.total}</td><td class="num ${r.median > 3000 ? 'warn' : 'ok'}">${r.median} ms</td><td class="num">${r.p90} ms</td><td class="num ${r.spread > 8000 ? 'bad' : ''}">${r.spread} ms</td></tr>`
  )
  .join('\n');

const genAt = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>高性价比人生指南 · 墙内聚合入口</title>
<meta name="description" content="把 HowToLiveBetter 的 ${stats.total} 个衍生项目聚在一处，并逐一查证每个同步到了哪一版。">
<style>
:root{--bg:#faf9f7;--card:#fff;--line:#e6e3dc;--tx:#2c2c2a;--tx2:#5f5e5a;--tx3:#8a8880;
--g:#0f6e56;--gbg:#e1f5ee;--a:#8a5300;--abg:#faeeda;--r:#a32d2d;--rbg:#fcebeb;--b:#185fa5;--bbg:#e6f1fb}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif}
a{color:var(--b)}
.wrap{max-width:1160px;margin:0 auto;padding:0 22px}
header.top{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:9}
.top .in{display:flex;align-items:center;gap:14px;height:56px}
.brand{font-weight:600;font-size:15px}
.top .sp{flex:1}
.top .src{font-size:12.5px;color:var(--tx3);text-align:right}
.hero{padding:52px 0 34px}
h1{font-size:31px;line-height:1.32;font-weight:600;margin:0 0 14px;letter-spacing:-.01em}
.lede{font-size:16px;color:var(--tx2);max-width:790px;margin:0 0 26px}
.lede b{color:var(--tx)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:12px;margin-bottom:34px}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:15px 17px}
.stat .k{font-size:12.5px;color:var(--tx3);margin-bottom:5px}
.stat .v{font-size:23px;font-weight:600;line-height:1.25}
.stat .n{font-size:12px;color:var(--tx2);margin-top:3px}
.v.g{color:var(--g)}.v.a{color:var(--a)}.v.r{color:var(--r)}.v.b{color:var(--b)}
h2{font-size:20px;font-weight:600;margin:44px 0 8px}
.h2n{color:var(--tx2);font-size:14px;margin:0 0 18px}
.panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}
.bar .lbl{font-size:13px;color:var(--tx3);margin-right:2px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 13px;font-size:13px;cursor:pointer;color:var(--tx2);font-family:inherit}
.chip:hover{border-color:#c9c5bc}
.chip.on{background:var(--tx);color:#fff;border-color:var(--tx)}
.sorts{display:flex;gap:6px;margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;margin-top:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:19px 20px;display:flex;flex-direction:column}
.chead{display:flex;align-items:baseline;gap:9px;margin-bottom:3px}
.chead h3{margin:0;font-size:16.5px;font-weight:600}
.chead h3 a{color:var(--tx);text-decoration:none}
.chead h3 a:hover{color:var(--b)}
.kind{font-size:11.5px;color:var(--tx2);background:#f4f2ee;border-radius:5px;padding:2px 7px;white-space:nowrap}
.byline{font-size:12.5px;color:var(--tx3);margin-bottom:13px}
.freshbox{border:1px solid;border-radius:10px;padding:11px 13px;margin-bottom:13px}
.vrow{margin-bottom:6px}
.pill{font-size:12.5px;font-weight:500}
.lag{display:block;font-size:14px;font-weight:500}
.lag.ok{color:var(--g)}.lag.warn{color:var(--a)}.lag.bad{color:var(--r)}.lag.dim2{color:var(--tx2);font-weight:400;font-size:13px}
.dim{color:var(--tx3);font-weight:400;font-size:12.5px}
.fnote{font-size:12.5px;color:var(--tx2);margin-top:5px}
.feat{font-size:13.5px;color:var(--tx2);margin:0 0 12px;flex:1}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.tag{font-size:11.5px;color:var(--tx2);background:#f6f4f0;border-radius:5px;padding:2px 7px}
.foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-top:1px solid #f2f0ec;padding-top:11px;font-size:12.5px}
.reach.ok{color:var(--g)}.reach.warn{color:var(--a)}
.gate{color:var(--tx3);font-size:12px;flex-basis:100%}
.empty{grid-column:1/-1;text-align:center;color:var(--tx3);padding:40px;font-size:14px}
table{border-collapse:collapse;width:100%;font-size:13.5px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #f2f0ec;vertical-align:top}
th{font-weight:500;color:var(--tx2);background:#fcfbf9;font-size:13px}
td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
td.ok{color:var(--g)}td.warn{color:var(--a)}td.bad{color:var(--r)}
.ev{font-size:12px;color:var(--tx2);margin-bottom:3px}
.brow{display:grid;grid-template-columns:250px 240px 1fr;gap:14px;align-items:center;padding:11px 0;border-bottom:1px solid #f2f0ec}
.bmeta{font-size:13.5px;display:flex;flex-direction:column}
.bmeta .dim{font-size:12px}
.bsvg{overflow-x:auto}
.bsvg svg,.bsvg img{display:block}
.bcode{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--tx2);background:#f6f4f0;padding:5px 9px;border-radius:6px;overflow-x:auto;white-space:nowrap}
ol,ul{padding-left:21px;color:var(--tx2);font-size:14px}
li{margin-bottom:9px}
.note{background:var(--bbg);border:1px solid #b5d4f4;border-radius:12px;padding:15px 19px;font-size:14px;color:#0c447c;margin:0 0 26px}
.warnbox{background:var(--abg);border:1px solid #f0d9a8;border-radius:12px;padding:15px 19px;font-size:14px;color:#5c3b00;margin:0 0 26px}
code{background:#f4f2ee;padding:1px 5px;border-radius:4px;font-size:12.5px}
footer{margin-top:56px;border-top:1px solid var(--line);padding:22px 0 60px;color:var(--tx3);font-size:12.5px}
@media(max-width:820px){.brow{grid-template-columns:1fr}h1{font-size:25px}}
</style>
</head>
<body>
<header class="top"><div class="in wrap">
  <span class="brand">高性价比人生指南 · 墙内聚合</span>
  <span class="sp"></span>
  <span class="src">上游 <b id="upn">${UP_COUNT}</b> 条 · <code>${String(UP.headSha).slice(0, 8)}</code><br>数据 ${genAt}（可实时刷新）</span>
</div></header>

<div class="wrap">

<section class="hero">
  <h1>上游有 ${stats.total} 个项目，散在 ${stats.total} 个地方。<br>这里把它们聚在一处，并逐个查证同步到了哪一版。</h1>
  <p class="lede">这本书 <b>CC BY 4.0</b> 开源，读者做出了 ${stats.total} 个衍生工具：网站、小程序、App、浏览器插件、数据集、漫画。<b>它们唯一的聚合点是 GitHub 上的源仓库</b> —— 而 GitHub 网页在国内中位要等 <b>5.3 秒</b>、最坏 <b>18.5 秒</b>，波动 14 秒，所以很多人干脆一直开着梯子。<br>更难的是：<b>没有任何一个地方告诉你「哪个站是新的」</b>。这个页面就干这两件事。</p>

  <div class="stats">
    <div class="stat"><div class="k">已收录衍生项目</div><div class="v b">${stats.total}</div><div class="n">来自上游 README 官方清单</div></div>
    <div class="stat"><div class="k">墙内可达</div><div class="v g">${stats.okProbes}/${stats.probes}</div><div class="n">${stats.total} 项 × 3 轮探活全通（含梯子未开时）</div></div>
    <div class="stat"><div class="k">能算出同步到哪一版</div><div class="v a">${stats.hasCount}/${stats.total}</div><div class="n">实测 ${stats.measured} 项 · 仅页面自述 ${stats.selfDeclaredOnly} 项</div></div>
    <div class="stat"><div class="k">运行时自动跟进</div><div class="v g">${stats.runtime} 项</div><div class="n">每次打开直接拉上游，不存在「落后」</div></div>
    <div class="stat"><div class="k">已追平上游 ${UP_COUNT} 条</div><div class="v a">${stats.sync} 项</div><div class="n">最多落后 ${stats.maxLag} 条（${stats.maxLagName}）</div></div>
    <div class="stat"><div class="k">无版本信号</div><div class="v r">${stats.unknown} 项</div><div class="n">无法核验，只能算「不知道」</div></div>
  </div>

  <div class="note"><b>怎么用：</b>下面按「你的需求」筛，但不看广告词，只看三件事 —— <b>同步到哪一版</b>、<b>墙内多少毫秒打开</b>、<b>要不要注册 / 有没有广告</b>。可达性与延迟是本页每轮实测的，不是抄来的。</div>

  <div class="warnbox"><b>先说清楚一个坑：</b>本站挂在你自己的 Cloudflare 上。<b>Cloudflare 在国内的访问速度和 GitHub 是同一个量级的问题</b> —— 实测这台机器打开 CF 系站点中位 <b>2.1–3.5 秒</b>、打开 howtolivebetter.net 中位 <b>6.1 秒</b>；本站不会比它们更快。真正的「国内秒开」需要 <b>国内云主机 + ICP 备案</b>（要走 1–2 周实名+备案），那是另一个决定。现在这一版的价值是<b>把信息聚齐并查证</b>，而不是「更快」。</div>
</section>

<h2>选一个用</h2>
<p class="h2n">点标签筛选，或按同步新鲜度 / 访问速度排序。共 <span id="cnt">${stats.total}</span> 项。</p>
<div class="panel">
  <div class="bar">
    <span class="lbl">需求</span>
    ${ALL_TAGS.map((t) => `<button class="chip" data-tag="${t}">${t}</button>`).join('\n    ')}
    <button class="chip" id="clr">清空</button>
  </div>
  <div class="bar">
    <span class="lbl">排序</span>
    <div class="sorts">
      <button class="chip on" data-sort="fresh">同步最新</button>
      <button class="chip" data-sort="speed">访问最快</button>
      <button class="chip" data-sort="type">按类型</button>
      <button class="chip" data-sort="lag">落后最多</button>
    </div>
  </div>
</div>
<div class="grid" id="grid">
${cards}
</div>

<h2>逐项查证明细</h2>
<p class="h2n">每一行都标清了<b>依据</b>：<b>实测产物</b> = 读该项目自己的产物文件（小程序 bundle、App 的 entries.json、数据集的 stats.json…）数出来的真实条数；<b>页面自述</b> = 只是它自己在页面上写的数字，属弱信号，不能与实测混为一谈；<b>运行时拉取</b> = 它每次打开直接拉上游正文，因此不存在「落后」这个概念。右侧是这台机器抓到的原始证据。</p>
<div class="panel" style="overflow-x:auto">
<table>
<thead><tr><th>项目</th><th>估算依据</th><th>条数</th><th>落后</th><th>抓到的原始证据</th></tr></thead>
<tbody>
${detailRows}
</tbody>
</table>
</div>

<h2>同步状态 badge（动态接口）</h2>
<p class="h2n">这是本项目想推给整个生态的东西：一个<b>可机器核验</b>的「我同步到哪一版」标记。<b>目前 ${stats.total} 个项目里有 ${stats.withOwnVersion} 个自带可核验的版本号</b> —— better.aigcwei.cn 的 <code>sync/fingerprint.json</code> 直接写了上游 commit 与逐条哈希、BetterLifeApp 的 <code>entries.json</code> 带 <code>contentVersion</code>、htlb-dataset 的 <code>stats.json</code> 带 <code>upstream_commit</code>。这说明<b>「自报版本」的习惯在生态里已经存在，缺的只是统一格式和现成的读取工具</b>，而不是要去 12 个仓库挨个提需求。下面每一条都能直接贴进 README —— 它指向本站的<b>动态接口</b>，上游一更新、数字自动变，不用谁去手动改。</p>
<div class="panel">
${badgeRows}
</div>
<p class="h2n" style="margin-top:14px">接口形态：<code>/badge/&lt;项目 slug&gt;.svg</code> · 机器可读：<code>/api/status.json</code> · 数据接口每次请求会去上游取一次最新条目数（边缘缓存 10 分钟），所以 badge 上的数字是<b>活的</b>。</p>

<h2>为什么需要这个页面：GitHub 墙内实测</h2>
<p class="h2n">本机裸连（未开梯子）各通道各 5 轮取中位数。${ghProbe.samples} 轮样本，${ghProbe.generatedAt.slice(0, 10)} 采集。</p>
<div class="panel">
<table>
<thead><tr><th>通道</th><th>成功率</th><th>中位延迟</th><th>p90</th><th>波动（max−min）</th></tr></thead>
<tbody>
${ghRows}
</tbody>
</table>
<p class="h2n" style="margin:14px 0 0">读法：<b>成功率全是 100%</b> —— 所以问题不是「打不开」，而是<b>「打开要等多久、以及每次都不一样」</b>。网页通道（普通人唯一的入口）中位 5.3 秒、最坏 18.5 秒、波动 14.3 秒；开发者通道（api / raw）反而很快。这就是「能上，但习惯开梯子」的物理原因。</p>
</div>

<h2>方法与局限（先读这段再信上面的表）</h2>
<ol>
<li><b>只用四条「能落地」的路子，不猜。</b>① <b>实测产物</b>：读项目自己的产物文件（小程序 bundle、App 的 <code>entries.json</code>、数据集的 <code>stats.json</code>…），按上游官方口径（<code>book/*.md</code> 里的 <code>###</code> 标题数）数出真实条数；② <b>fork 对比</b>：它若是上游 fork，直接逐文件数它的 <code>book/*.md</code>；③ <b>sitemap</b>：读 <code>sitemap.xml</code> 的 <code>lastmod</code> 与 URL 数（弱信号）；④ <b>运行时</b>：源码级确认它每次打开直接拉上游原文 → 不存在「落后」，从落后名单里剔除。每行的依据都写在表里，<b>实测与页面自述严格分开</b>。</li>
<li><b>内容级探针试过了，结论是这条路不通，如实报告。</b>我们用上游最近 14 次提交新增的 33 条条目标题原文，去各站实际内容里做精确匹配，13/14 项 <b>0 命中</b>。定向诊断查出两个互相独立的原因：① 衍生站普遍<b>改写标题</b>（上游「家里老人遛狗，把牵绳握在手心……」在站上只剩「家里老人」能匹配）；② 更根本的是<b>正文压根不在页面或主 bundle 里</b> —— howtolivebetter.net 的 638 KB bundle 对上游前 60 条老条目 <b>0/60 命中</b>，说明它按需分块或运行时拉取，抓 <code>&lt;script src&gt;</code> 根本碰不到正文。<b>所以本页不拿探针当证据。</b></li>
<li><b>「落后多少条」用官方口径复算过。</b>上游条目数由 <code>git log -p -- book/</code> 逐次累积统计得出（本机复算 <b>${UP_COUNT} 条</b>，共 ${UP.totalCommits} 次提交），再与各项目的实测/自述条数相减。两个输入都能独立复核。</li>
<li><b>「落后 N 天」有粒度盲区。</b>${UP_COUNT} 条是某天某一刻达到的，但当天很多提交只改文档、不改条目数。准确说法是：<b>「若内容停在达到 N 条的那次提交，则内容落后 N 天」</b>。要更准只能逐站 diff 正文，本轮没做。</li>
<li><b>「运行时自动跟进」不是我们替它保证的，是读了源码。</b>例如 daily-life-tip 的 <code>RemoteBook.swift</code> 里写着「内置的那份数据是编译时快照，永远能出内容。这里只负责『书更新了，跟上去』」；shiye-tab 的 <code>src/sources.js</code> 每次打开拉 <code>raw.githubusercontent.com/eternity4719/…</code> 并按 <code>### </code> 解析。这类项目<b>不该被算作「落后」</b>。</li>
<li><b>「无版本信号」不代表内容旧。</b>它只代表该站<b>没有提供任何可核验的版本信号</b> —— 这本身就是本页要暴露的问题。</li>
<li>「门槛」一列<b>照抄上游 <code>衍生项目.md</code> 的原文口径</b>，标「未标注」= 原文也没写，<b>非本站核验</b>。可达性、延迟、CDN、条目数均为实测。</li>
<li>可达性是<b>单机单时点</b>结论。Cloudflare 站在国内「时通时不通」，探活全通只说明<b>此刻</b>通畅。本站不托管任何正文，只做指路。</li>
<li>本页<b>不转载正文、不开评论区</b>。正文版权归上游及各衍生作者，有出入时以 <a href="https://github.com/eternity4719/HowToLiveBetter" target="_blank" rel="noopener">上游中文原文</a> 为准（CC BY 4.0）。</li>
<li><b>数据是活的，但不是秒级。</b>本站 Worker 每次请求会去上游取一次最新条目数（边缘缓存 10 分钟）；完整的逐项重算由 <b>GitHub Actions 每天跑一次</b>，结果回灌进本站的 KV，页脚会显示上次重算时间。</li>
</ol>

<footer>
上游：<a href="https://github.com/eternity4719/HowToLiveBetter" target="_blank" rel="noopener">eternity4719/HowToLiveBetter</a> · CC BY 4.0 · ${UP.stars ? UP.stars.toLocaleString() : '—'} ★ / ${UP.forks ? UP.forks.toLocaleString() : '—'} forks · 最新提交 <code>${String(UP.headSha).slice(0, 8)}</code>（${UP.headDate ? new Date(UP.headDate).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—'}）<br>
本站由 <code>fetch-upstream.sh</code>（取上游 git 历史）→ <code>verify-upstream.mjs</code> / <code>verify-ecosystem.mjs</code>（查证）→ <code>build-site.mjs</code>（渲染）→ <code>deploy.mjs</code>（部署到 Cloudflare Worker）串成，生成于 ${genAt}。<br>
逐项重算由 GitHub Actions 每日自动执行并回灌本站数据层；最近一次：<b id="crawlAt">${'（随 /api/status.json 实时填入）'}</b>。聚合与查证由 Strange 维护。
</footer>
</div>

<script>
(function(){
  var grid=document.getElementById('grid');
  var cards=Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var cnt=document.getElementById('cnt');
  var activeTags=[];
  var sortKey='fresh';

  function apply(){
    var shown=0;
    cards.forEach(function(c){
      var tags=(c.getAttribute('data-tags')||'').split(',').filter(Boolean);
      var okTag=activeTags.every(function(t){return tags.indexOf(t)>=0;});
      c.style.display=okTag?'':'none';
      if(okTag)shown++;
    });
    cnt.textContent=shown;
    var vis=cards.slice().sort(function(a,b){
      if(sortKey==='speed')return (+a.dataset.speed)-(+b.dataset.speed);
      if(sortKey==='type')return (+a.dataset.type)-(+b.dataset.type);
      if(sortKey==='lag'){var x=+a.dataset.lag,y=+b.dataset.lag;if(x<0)x=-2;if(y<0)y=-2;return y-x;}
      var x=+a.dataset.lag,y=+b.dataset.lag;
      if(x<0)x=9999;if(y<0)y=9999;
      return x-y;
    });
    vis.forEach(function(c){grid.appendChild(c);});
  }

  Array.prototype.slice.call(document.querySelectorAll('.chip[data-tag]')).forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.getAttribute('data-tag');
      var i=activeTags.indexOf(t);
      if(i>=0){activeTags.splice(i,1);b.classList.remove('on');}
      else{activeTags.push(t);b.classList.add('on');}
      apply();
    });
  });
  document.getElementById('clr').addEventListener('click',function(){
    activeTags=[];
    Array.prototype.slice.call(document.querySelectorAll('.chip[data-tag]')).forEach(function(b){b.classList.remove('on');});
    apply();
  });
  Array.prototype.slice.call(document.querySelectorAll('.chip[data-sort]')).forEach(function(b){
    b.addEventListener('click',function(){
      Array.prototype.slice.call(document.querySelectorAll('.chip[data-sort]')).forEach(function(x){x.classList.remove('on');});
      b.classList.add('on');
      sortKey=b.getAttribute('data-sort');
      apply();
    });
  });
  apply();

  // 动态数据：拿到实时上游条目数后回填（失败则保持构建期的快照值）
  fetch('/api/status.json').then(function(r){return r.json();}).then(function(d){
    if(!d)return;
    var n=document.querySelector('#upn');
    if(n&&d.upstream)n.textContent=d.upstream.entries;
    var c=document.querySelector('#crawlAt');
    if(c)c.textContent=d.lastCrawlAt?new Date(d.lastCrawlAt).toLocaleString('zh-CN',{hour12:false}):'尚未回灌，当前显示的是部署时快照';
  }).catch(function(){});
})();
</script>
</body>
</html>`;

const outDir = path.join(DIR, 'site');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

const badgeDir = path.join(outDir, 'badge');
fs.mkdirSync(badgeDir, { recursive: true });
for (const r of rows) fs.writeFileSync(path.join(badgeDir, r.slug + '.svg'), badgeFor(r), 'utf8');

// 规范数据集 —— worker 内嵌 + GitHub Actions 回灌用的是同一份
const dataset = {
  generatedAt: new Date().toISOString(),
  upstream: {
    repo: eco.upstream.repo,
    readmeRaw: UP.readmeRaw,
    headSha: UP.headSha,
    headDate: UP.headDate,
    entries: UP_COUNT,
    totalCommits: UP.totalCommits,
    license: UP.license || 'CC BY 4.0',
    stars: UP.stars,
    forks: UP.forks,
  },
  stats: {
    total: stats.total,
    measured: stats.measured,
    selfDeclaredOnly: stats.selfDeclaredOnly,
    withOwnVersion: stats.withOwnVersion,
    runtime: stats.runtime,
    sync: stats.sync,
    lagging: stats.lag,
    unknown: stats.unknown,
  },
  projects: rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    author: r.author,
    kind: r.kind,
    url: r.url,
    ghRepo: r.ghRepo,
    note: r.note,
    tags: r.tags,
    gate: r.gate,
    // —— 同步状态（worker 的重算输入）——
    status: r.verdict,
    basis: r.basis,
    confidence: r.confidence,
    actualEntries: r.actualEntries,
    selfDeclared: r.selfDeclared,
    selfDeclaredFrom: r.selfDeclaredFrom,
    lag: r.lag,
    lagEntries: r.lagEntries,
    lagDays: r.lagDays,
    runtimeFetch: r.runtimeFetch,
    ownVersion: r.ownVersion,
    ownVersionShort: r.ownVersionShort,
    ownVersionDate: r.ownVersionDate,
    ownGeneratedAt: r.ownGeneratedAt,
    sitemapLastmod: r.sitemapLastmod,
    sitemapUrls: r.sitemapUrls,
    evidence: (r.evidence || []).slice(0, 5).map((e) => String(e).slice(0, 220)),
    // —— 可达性（audit.json，由采集阶段每轮实测）——
    ok: r.ok,
    total: r.total,
    avg: r.avg,
    cdn: r.cdn,
    lastEdit: r.lastEdit,
  })),
};
fs.writeFileSync(path.join(DIR, 'data', 'projects.json'), JSON.stringify(dataset, null, 1), 'utf8');

console.log('已生成:');
console.log('  site/index.html        (' + Buffer.byteLength(html) + ' B)');
console.log('  site/badge/*.svg       (' + rows.length + ' 个)');
console.log('  data/projects.json     (' + Buffer.byteLength(JSON.stringify(dataset)) + ' B)');
console.log('');
console.log('同步状态一览（上游 ' + UP_COUNT + ' 条）：');
for (const r of rows) {
  const s =
    r.verdict === 'runtime' ? '运行时跟随'
      : r.verdict === 'fixed' ? '固定快照'
        : r.declared == null ? '无版本信号'
          : r.lag === 0 ? '追平' : '落后 ' + r.lag;
  const basisMark = r.basis === 'measured' ? '实测' : r.basis === 'self-declared' ? '自述' : r.basis === 'runtime' ? '源码' : '—';
  console.log('  ' + String(s).padStart(8) + ' [' + basisMark + '/' + String(r.confidence).padEnd(6) + ']  ' + r.name.padEnd(16, '　'));
}
