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

/**
 * 双域名分工（2026-10-14 定的国内可达性方案，与 mirror.strangeyu.xyz 同一套思路）
 *
 * 背景：原先整站挂在 Cloudflare Worker 上，`CF-RAY` 实测落点是 **LAX 洛杉矶** ——
 * 国内每次请求都要跨太平洋往返，全国拨测 CF 4.975 s vs GitHub Pages 0.765 s。
 * 所以把**静态页**搬到 GitHub Pages（Fastly CDN，与 CF 完全不同的厂商），
 * **动态接口**留在 Cloudflare Worker。CF 侧 DNS 必须设成**灰云（DNS only）**，
 * 否则流量仍会回到 CF —— 这一步不做等于没搬（mirror 项目已实测过）。
 *
 *   SITE_ORIGIN = 静态页 + 静态徽章（GitHub Pages，每日 Actions 重建）
 *   API_ORIGIN  = 活的接口 + 活的徽章（Cloudflare Worker）
 */
const SITE_ORIGIN = 'https://htlb.strangeyu.xyz';
const API_ORIGIN = 'https://htlb-api.strangeyu.xyz';

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
  'howtolivebetter-92110.app.workbuddy.host': { tags: ['不用注册', '能搜索', '能分享'], gate: '不登录也能用 · 微信登录可把清单存到云端', note: '把全书摊成一张可探索的地图：词云 + 条目关系图，挑中的条目能生成分享卡片。' },
  'www.howtolivebetter.cn': { tags: ['不用注册', '能搜索'], gate: '不用注册 · 记录存在浏览器里，可导出备份', note: '按主题或原书章节读，能把想试的建议写成小行动、按周回顾。' },
  'life.hcju.com': { tags: ['不用注册', '无广告', '能搜索'], gate: '不用注册 · 没有广告 · 外语版为非官方翻译', note: '每条一个网址的阅读站，另配 6 个语言版；外语版按当地情况补了急救、劳动、租房、医保等要点。' },
  'parveen0029/The-Evidence-Based-Life': { tags: ['不用注册', '无广告', '能搜索', '给 AI 用'], gate: '不用注册 · 没有广告 · 非官方英文翻译', note: '全书的英文对照阅读版，另带一个能给 Claude Code / Codex 用的 AI 决策助手。' },
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

/**
 * 每张卡的「落地入口」—— 让人能直接点进去，而不是先落到仓库再自己找。
 * 网站类直连站点；手机/桌面/插件/数据集/漫画类指向各自的发布页或商店页。
 * ⚠️ 全部用 /releases/latest 这类**永久指向最新版**的地址，不写死版本号（否则一发新版就过期）。
 */
const CTA = {
  'HuiTurn/HowToLiveBetter': { link: 'https://github.com/HuiTurn/HowToLiveBetter', label: '看小程序说明 / 源码' },
  'llzx373/BetterLifeApp': { link: 'https://github.com/llzx373/BetterLifeApp/releases/latest', label: '下载 Android 安装包' },
  'mittsommer/daily-life-tip': { link: 'https://github.com/mittsommer/daily-life-tip/releases/latest', label: '下载 macOS 安装包' },
  'sinyu1012/shiye-tab': {
    link: 'https://chromewebstore.google.com/detail/%E6%8B%BE%E9%A1%B5-%C2%B7-shiye-tab/fkkcecjdalionkdjbpdhgigpcimopfmg?hl=zh',
    label: '去 Chrome 应用商店安装',
  },
  'sin0317/htlb-dataset': { link: 'https://github.com/sin0317/htlb-dataset', label: '在 GitHub 取数据' },
  'robiNeo2045/comics': { link: 'https://github.com/robiNeo2045/HowToLiveBetter/releases/latest', label: '下载漫画 PDF' },
};

const rows = audit.derived.map((x) => {
  const c = CURATED[x.id] || { tags: [], gate: '—', note: x.note || '' };
  const e = ECO_BY_ID[x.id] || {};

  const measured = e.actualEntries != null ? e.actualEntries : null;
  const declared = measured != null ? measured : e.selfDeclared != null ? e.selfDeclared : null;
  const lag = declared == null ? null : Math.max(0, UP_COUNT - declared);

  // ── 同步判定：人工覆盖 → 运行时跟随 → 有「条数」才算落后 → 其余算「无版本信号」──
  // ⚠️ 只有 sitemap lastmod、却没有条数的项目**不标落后** —— 否则「落后于上游」这个标签
  //    会落在一个其实算不出落差的项目上。Worker 侧同样只认条数，两边口径必须一致。
  let verdict;
  if (c.verdict) verdict = c.verdict;
  else if (e.runtimeFetch || e.status === 'runtime') verdict = 'runtime';
  else if (declared == null) verdict = 'unknown';
  else if (lag === 0) verdict = 'sync';
  else verdict = 'lag';

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
    // ⚠️ 只在该项目**确实有 GitHub 仓库**时才把作者链到 GitHub（拿仓库 owner）。
    //    网站类项目的作者名很多不是 GitHub 账号，硬拼 https://github.com/<作者名> 会造出死链
    //    （实测踩过：https://github.com/GUGU VITALITY LIMITED 这种带空格的地址）。
    authorGh: x.ghRepo ? x.ghRepo.split('/')[0] : null,
    kind: x.kind,
    url: (CTA[x.id] && CTA[x.id].link) || x.url || (x.ghRepo ? `https://github.com/${x.ghRepo}` : ''),
    ghRepo: x.ghRepo || null,
    linkLabel:
      (CTA[x.id] && CTA[x.id].label) ||
      (x.kind === '网站' || x.kind === '网站+MCP' ? '打开网站' : x.ghRepo ? '前往 GitHub' : '打开'),
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
    carriedFrom: e.carriedFrom || null,
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
/** 「尚未追平、落后最少」的那批项目 —— minLag 与 minLagName 必须共用这一个数组。
 *  ⚠️ 原来 minLag 用 `lag != null`（把已追平项目的 0 也算了进去），minLagName 用 `lag > 0`，
 *     于是首屏那张卡显示成「最接近最新版 落后 0 条 · 打勾清单（699/699）」——
 *     名字取的是落后 9 条的项目，数字却按 0 算，自相矛盾。 */
const lagging = rows.filter((r) => r.lag != null && r.lag > 0);

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
  minLag: lagging.length ? Math.min(...lagging.map((r) => r.lag)) : 0,
  minLagName: [...lagging].sort((a, b) => a.lag - b.lag)[0]?.name || '',
  cf: rows.filter((r) => r.cdn === 'Cloudflare').length,
  domestic: rows.filter((r) => r.domestic).length,
  platforms: new Set(rows.map((r) => r.kind)).size,
  autoFollow: rows.filter((r) => r.verdict === 'sync' || r.verdict === 'runtime').length,
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
  carried: '上次实测值（本轮探针被该站 WAF 挡掉，未能复核）',
  'self-declared': '商店/页面自述（未实测）',
  runtime: '源码确认：运行时直接拉上游正文',
  none: '无版本信号',
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
    const dn = r.lagDays == null ? '' : r.lagDays <= 0.05 ? ' · 内容时间 ≈ 上游最新' : ` · 内容大约停在 ${Math.round(r.lagDays * 10) / 10} 天前`;
    return `<article class="card" data-tags="${r.tags.join(',')}" data-lag="${r.lag === null ? -1 : r.lag}" data-speed="${r.avg}" data-type="${r.typeIdx}">
  <a class="shot" href="${r.url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${SITE_ORIGIN}/shot/${r.slug}.webp" alt="" width="1200" height="750" loading="lazy" decoding="async"></a>
  <div class="chead">
    <h3><a href="${r.url}" target="_blank" rel="noopener">${r.name}</a></h3>
    <span class="kind">${r.kind}</span>
  </div>
  <div class="byline">by ${r.authorGh ? `<a href="https://github.com/${r.authorGh}" target="_blank" rel="noopener">${r.author}</a>` : r.author}${r.lastEdit ? ` · 末次改动 ${r.lastEdit}` : ''}</div>
  <div class="freshbox" style="border-color:${v.color}33;background:${v.bg}">
    <div class="vrow"><span class="pill" style="color:${v.color}">${v.label}</span></div>
    ${lagBadge}
    <div class="fnote">${BASIS_LABEL[r.basis] || BASIS_LABEL.none}（置信 ${CONF_LABEL[r.confidence] || '无'}）${dn}${r.carriedFrom ? ` · 上次核实 ${String(r.carriedFrom).slice(0, 10)}` : ''}</div>
  </div>
  <p class="feat">${r.note}</p>
  <div class="tags">${r.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
  <a class="cta" href="${r.url}" target="_blank" rel="noopener">${r.linkLabel} →</a>
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
  <code class="bcode">![同步状态](${API_ORIGIN}/badge/${r.slug}.svg)</code>
</div>`
  )
  .join('\n');

const detailRows = rows
  .map((r) => {
    const basisTxt =
      r.basis === 'measured' ? `实测产物<span class="dim">（读它自己发布的文件数出来的）</span>`
        : r.basis === 'carried' ? `实测产物<span class="dim">（上一次的实测值，本轮探针被该站 WAF 挡掉）</span>`
          : r.basis === 'self-declared' ? `商店/页面自述<span class="dim">（弱信号）</span>`
            : r.basis === 'runtime' ? '运行时拉取<span class="dim">（无需版本号）</span>'
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

/** 页底「读法」段引用的秒数 —— 从实测数据算出来，不写死。
 *  （原先硬编码的「5.3 秒 / 18.5 秒 / 14.3 秒」会在下次拨测后变成假话。） */
const ghHtml = ghProbe.results.find((r) => r.id === 'gh-html') || ghProbe.results[0];
const ghSec = (ms) => (ms / 1000).toFixed(1);

const genAt = new Date().toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>高性价比人生指南 · 18 个衍生项目墙内聚合（逐个核实同步到哪一版）</title>
<meta name="description" content="《高性价比人生指南》的 ${stats.total} 个衍生项目聚在一处，逐个实测同步到了哪一版、墙内打开多快、要不要注册、有没有广告。民间自建、非官方。">
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
/* 顶栏里的官方原站入口 —— 顶栏是 sticky，滚动时一直可见，所以这是全页曝光最高的位置。
   做成胶囊按钮 + 「官方」字样，是为了让它一眼区别于普通导航锚点（它是外链、会离开本站）。 */
.top .official{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:#fff;background:var(--g);padding:5px 13px;border-radius:999px;text-decoration:none;white-space:nowrap}
.top .official em{font-style:normal;font-weight:400;font-size:11.5px;color:#cfeadf}
/* 正文里那一行同名入口 —— 极简的一条，不是区块，所以只用左侧色条 */
.officialbar{display:flex;align-items:center;gap:10px;margin:0 0 26px;padding:10px 14px;border-left:3px solid var(--g);background:#f6faf8;text-decoration:none;color:var(--tx)}
.officialbar b{font-size:15px;flex:1}
.officialbar .go{color:var(--b);font-weight:600;font-size:14px;white-space:nowrap}
.hero{padding:52px 0 34px}
h1{font-size:31px;line-height:1.32;font-weight:600;margin:0 0 10px;letter-spacing:-.01em}
/* 副标题：一行小字，只承担「卖点 + 信任声明」。放在 h1 紧邻处是刻意的 ——
   读者第一眼就要知道这不是官方站，别等滚到段尾才看见。
   用 --tx2 而非 --tx3：这句要真被读到，浅灰（3.4:1）只够当提示，不够当声明。 */
.sub{font-size:13.5px;color:var(--tx2);margin:0 0 20px;line-height:1.6}
.sub b{color:var(--tx);font-weight:600}
.lede{font-size:16px;color:var(--tx2);max-width:790px;margin:0 0 26px}
.lede b{color:var(--tx)}
/* minmax 阈值 152px（原 178px）：178px 时桌面 1160px 容器刚好只能排 5 张，第 6 张会独自占一行；
   更要紧的是 iPhone 逻辑宽 390px 下 178px 只够单列，6 张统计卡会堆成整整一屏。
   降到 152px 后桌面 6 张一行（1fr 撑满，每张实际仍 ~176px），390px 也能排 2 列。 */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:12px;margin-bottom:34px}
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
/* minmax 310px（原 330px）：目录侧栏会吃掉 224px 横向空间。降到 310px 后
   3 列只需 962px 可用宽，配合 1024px 的侧栏断点 —— 1024–1300px 区间侧栏
   常驻、卡片 2 列，1300px 以上两者兼得。 */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:16px;margin-top:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:19px 20px;display:flex;flex-direction:column;overflow:hidden}
/* 卡片顶部实拍截图：卡片本身有 19px/20px 内边距，靠负 margin 让图贴到圆角边上。
   16:10 是量出来的 —— 卡片在 1440 下宽 361px、390 下宽 346px，
   16:10 出图高约 216px，一排卡片高度不至于失控，又够看清页面骨架。 */
.shot{position:relative;display:block;margin:-19px -20px 15px;background:#efece6;line-height:0}
.shot img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top center}
/* 「另见」区块的条目：左图右文。
   这一块一条占一整行，横向空间比上面的卡片网格宽得多 —— 网格卡片里缩略图只有 ~346px，
   这里能放到 ~565px，所以图直接给到 1.15:1 的栏宽而不是缩成小图。图与文字顶对齐，窄屏堆叠。 */
.mrow{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:24px;align-items:start}
.mshot{display:block;line-height:0;border:1px solid var(--line);border-radius:11px;overflow:hidden;background:#efece6;transition:border-color .15s}
.mshot:hover{border-color:#c9c5bc}
.mshot img{display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;object-position:top center}
.mtext{display:flex;flex-direction:column;min-width:0}
@media(max-width:900px){.mrow{grid-template-columns:1fr;gap:14px}}
@media(max-width:620px){.card{padding:15px 16px}.shot{margin:-15px -16px 13px}}
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
.cta{display:block;text-align:center;margin:0 0 13px;padding:9px 12px;border-radius:9px;background:var(--b);color:#fff;text-decoration:none;font-size:13.5px;font-weight:500}
.cta:hover{background:#0f4a80}
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
details.more{margin:44px 0 0;border:1px solid var(--line);border-radius:14px;background:#fff}
details.more>summary{cursor:pointer;padding:15px 20px;font-size:15.5px;font-weight:600;list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:'▸';color:var(--tx3);font-size:13px;display:inline-block}
details.more[open]>summary::before{content:'▾'}
details.more>summary:hover{color:var(--b)}
details.more>summary .sm{font-weight:400;color:var(--tx3);font-size:13px}
details.more .morebody{padding:0 20px 24px;border-top:1px solid var(--line)}
details.more .morebody h2:first-child{margin-top:24px}
.aside-tag{display:inline-block;font-size:11.5px;color:var(--tx2);background:#f4f2ee;border-radius:5px;padding:2px 7px;margin-left:6px}
footer{margin-top:56px;border-top:1px solid var(--line);padding:22px 0 60px;color:var(--tx3);font-size:12.5px}
@media(max-width:820px){.brow{grid-template-columns:1fr}h1{font-size:25px}}
/* 窄屏顶栏放不下三样东西（站名 / 官方入口 / 上游数据）—— 隐掉胶囊按钮，
   正文里那一行 .officialbar 仍在，读者不会找不到官方原站。 */
@media(max-width:760px){.top .official{display:none}}

/* ── 页面目录 ──────────────────────────────────────────────────────────
   窄屏（<1024px）：左滑抽屉 + 遮罩 + 顶栏按钮。手机版整页约 14 屏，
     导航缺口在手机上最大 —— 只做桌面常驻侧栏，恰好避开了最需要它的地方。
   ≥1024px：常驻左侧栏，正文列连同顶栏内容一起右移、并在「侧栏之外的剩余
     空间」里居中（排法照 mirror-guide 的 #toc / .wrap 那套）。
   断点原来定在 1300px（理由是「低于它卡片会从 3 列掉成 2 列」），实测这个
     阈值太保守：1280×800、1366 缩放 150%（逻辑宽 910）、PC 微信内置浏览器
     这类最常见的桌面视口都落在 1024–1300 区间 —— 读者看到的就只有顶栏那个
     「☰ 目录」按钮，等于没有目录。现在改成 1024px：1024–1300 之间侧栏常驻、
     卡片落成 2 列，多滚一点，但目录是看得见的。 */
:root{--toc-w:224px;--bar-h:56px}
#toc{position:fixed;top:var(--bar-h);left:0;width:var(--toc-w);max-width:84vw;height:calc(100vh - var(--bar-h));height:calc(100dvh - var(--bar-h));background:var(--card);border-right:1px solid var(--line);overflow:auto;overscroll-behavior:contain;padding:14px 12px 28px;transform:translateX(-103%);transition:transform .25s;z-index:950}
#toc.open{transform:translateX(0)}
#toc h4{margin:4px 6px 10px;font-size:12px;color:var(--tx3);letter-spacing:.1em;display:flex;align-items:center;gap:6px}
#toc h4 .sp{flex:1}
#toc .toc-tool{border:0;background:transparent;color:var(--tx3);font-size:11.5px;cursor:pointer;padding:2px 6px;font-family:inherit;border-radius:5px;letter-spacing:0}
#toc .toc-tool:hover{color:var(--b);background:#f4f2ee}
#toc a{display:block;padding:7px 10px;border-radius:7px;font-size:13px;color:var(--tx);line-height:1.45;text-decoration:none}
#toc a:hover{background:#f4f2ee;color:var(--tx)}
#toc a.active{background:#eaf3fe;color:var(--b);font-weight:600}
#toc .sep{margin:10px 8px 6px;border-top:1px solid var(--line)}
#toc .hint{margin:12px 8px 0;font-size:11.5px;color:var(--tx3);line-height:1.5}
#toc-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);opacity:0;pointer-events:none;transition:opacity .25s;z-index:940}
#toc-mask.show{opacity:1;pointer-events:auto}
#tocbtn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:#fff;color:var(--tx2);font:inherit;font-size:12.5px;padding:5px 11px;border-radius:999px;cursor:pointer;white-space:nowrap}
#tocbtn:hover{border-color:#c9c5bc;color:var(--tx)}
/* 锚点跳转时给 sticky 顶栏让出高度，否则标题会被顶栏盖住 */
#pick,#mine,#related,#verify,#badge,#probe,#source,details.more{scroll-margin-top:calc(var(--bar-h) + 14px)}
html{scroll-behavior:smooth}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}#toc{transition:none}}
@media(min-width:1024px){
  /* 桌面让它一路顶到最上面：白色与顶栏连成一片、右边框是一条不断开的竖线，
     目录项则靠 padding-top 让到顶栏下面 */
  #toc{transform:none;top:0;height:100vh;height:100dvh;padding-top:calc(var(--bar-h) + 18px)}
  #toc-mask,#tocbtn{display:none!important}
  .wrap{margin-left:calc(var(--toc-w) + max(0px,(100% - var(--toc-w) - 1160px) / 2))}
}
/* 窄屏顶栏要挤下「目录按钮 + 站名 + 上游条数」三样，把技术细节全砍掉：
   站名的缀语、上游提交号（页脚里还写着）、数据时间行。同时站名不许折行 ——
   折了会把顶栏撑到两三行高，而顶栏是 sticky，一直占着屏幕。 */
@media(max-width:620px){
  .top .brand .bs,.top .src .hs,.top .src .dt{display:none}
  .brand{font-size:13.5px;white-space:nowrap}
}
</style>
</head>
<body>
<div id="toc-mask"></div>
<nav id="toc" aria-label="页面目录">
  <h4>目录<span class="sp"></span><button class="toc-tool" id="toc-expand" type="button">展开技术细节</button></h4>
  <a href="#top">页首</a>
  <a href="#pick">选一个用 · ${stats.total} 个衍生项目</a>
  <a href="#mine">另见：本站维护者自己的三个站</a>
  <a href="#related">另见：与《高性价比人生指南》有关的两件</a>
  <div class="sep"></div>
  <a href="#verify">逐项查证明细</a>
  <a href="#badge">同步状态 badge</a>
  <a href="#probe">GitHub 墙内实测</a>
  <a href="#source">数据是怎么来的</a>
  <p class="hint">后四项在默认收起的「技术细节」里，点一下会自动展开。</p>
</nav>
<header class="top"><div class="in wrap">
  <button id="tocbtn" type="button" aria-label="打开页面目录" aria-controls="toc" aria-expanded="false">☰ 目录</button>
  <span class="brand">高性价比人生指南<span class="bs"> · 衍生项目聚合</span></span>
  <span class="sp"></span>
  <a class="official" href="https://eternity4719.github.io/HowToLiveBetter/" target="_blank" rel="noopener">📖 官方原站 <em>原书全文</em> ↗</a>
  <span class="sp"></span>
  <span class="src">上游 <b id="upn">${UP_COUNT}</b> 条<span class="hs"> · <code>${String(UP.headSha).slice(0, 8)}</code></span><span class="dt"><br>数据 ${genAt}（可实时刷新）</span></span>
</div></header>

<div class="wrap">

<section class="hero">
  <h1>《高性价比人生指南》的 ${stats.total} 个衍生项目，都在这儿</h1>
  <p class="sub">每个都核实了同步到哪一版 · <b>民间自建、非官方</b>，不收正文、不接广告</p>
  <p class="lede">《高性价比人生指南》是一本开源、还在持续更新的循证生活建议书。读者自发做出了 ${stats.total} 个衍生项目（网站、小程序、App、浏览器插件），散在各处，唯一的汇总点只有作者的 GitHub 仓库 —— 墙内访问不稳定，而且没人告诉你哪个是新的。它们有的会比上游落后一些。本页把它们聚到一处，逐个测出谁新谁旧，给出最省事的打开方式。</p>

  <div class="stats">
    <div class="stat"><div class="k">已收录的衍生项目</div><div class="v b">${stats.total}</div><div class="n">来自上游 README 的官方清单</div></div>
    <div class="stat"><div class="k">墙内可达</div><div class="v g">${stats.okProbes}/${stats.probes}</div><div class="n">${stats.total} 项 × 3 轮探活全通（含未开梯子时）</div></div>
    <div class="stat"><div class="k">已核实同步到哪一版</div><div class="v g">${stats.hasCount}/${stats.total}</div><div class="n">其中 ${stats.measured} 项读的是实测产物；另 ${stats.runtime} 项运行时自动跟进、无需版本号</div></div>
    <div class="stat"><div class="k">最接近最新版</div><div class="v g">落后 ${stats.minLag} 条</div><div class="n">${stats.minLagName}（${UP_COUNT - stats.minLag}/${UP_COUNT}）</div></div>
    <div class="stat"><div class="k">落后最多</div><div class="v a">${stats.maxLag} 条</div><div class="n">${stats.maxLagName}</div></div>
    <div class="stat"><div class="k">运行时自动跟进</div><div class="v g">${stats.runtime} 项</div><div class="n">每次打开直接拉上游，不存快照</div></div>
  </div>

  <div class="note"><b>怎么用：</b>点下面的标签按需求筛（要不要注册、有没有广告、手机还是电脑用），或按「同步最新 / 访问最快」排序。每张卡都写了三件我们实测过的事：<b>同步到哪一版</b>、<b>墙内打开多少毫秒</b>、<b>要不要注册、有没有广告</b>。想直接开始用，点卡片上的蓝色按钮。</div>

</section>

<a class="officialbar" href="https://eternity4719.github.io/HowToLiveBetter/" target="_blank" rel="noopener"><b>📖 官方原站</b><span class="go">打开 →</span></a>

<h2 id="pick">选一个用</h2>
<p class="h2n">点标签筛选，或按同步新鲜度 / 访问速度排序。共 <span id="cnt">${stats.total}</span> 项，每张卡都能直接点开。</p>
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

<h2 id="mine">另见：本站维护者自己的三个站点<span class="aside-tag">未被上游清单收录 · 不计入同步对比</span></h2>
<div class="warnbox" style="border-style:dashed;border-color:#e0dcd2;background:#fbfaf6"><b>先把话说清楚：</b>下面三条都是<b>本站维护者 Strange 自己的作品</b>，都不在上游 <code>衍生项目.md</code> 的收录范围里，也<b>不参与上面的同步对比、不计入这 ${stats.total} 个项目</b>。三条性质各不相同 —— 第一条《以日为镜》讲的是<b>另一部作品</b>（Boden《以日为鉴》），与《高性价比人生指南》<b>没有任何内容或版本关系</b>；第二条补丁包是<b>《高性价比人生指南》的独立增补</b>，照该书体例另写、与该书并列，但<b>不收录、不复制该书任何一条正文</b>；第三条《孙割这十年》整理的是<b>一个人的公开语料</b>，与《高性价比人生指南》同样没有内容关系。列在这里只是因为主题相邻、读者可能感兴趣。（想判断衍生站谁更新，请看上面的卡片。）</div>
<div class="panel" style="border-style:dashed;border-color:#e0dcd2;background:#fcfbf8">

  <div class="mrow">
    <a class="mshot" href="https://mirror.strangeyu.xyz/" target="_blank" rel="noopener"><img src="${SITE_ORIGIN}/shot/mirror.webp" alt="「以日为镜」首屏：左侧全站目录、标题「我们判断，你执行」与三个置信度标签" width="1200" height="750" loading="lazy" decoding="async"></a>
    <div class="mtext">
      <div class="bmeta">
        <b><a href="https://mirror.strangeyu.xyz/" target="_blank" rel="noopener">以日为镜：衰退时代普通人生存指南（以日为鉴 增补版）</a></b>
        <span class="dim">讲的是另一部作品 · 与《高性价比人生指南》无内容交集 · 本站维护者自己的作品</span>
      </div>
      <p class="feat" style="margin:12px 0 0;flex:none">灵感源自 Boden《以日为鉴》，以日本「失去三十年」为镜，综合 20 余位中日与国际学者的观点与 2026 年最新数据，直接给出结论、置信度与分人群行动。</p>
      <p class="dim" style="margin:8px 0 0">它<strong>没有使用《高性价比人生指南》的任何内容</strong>，与该书之间没有版本关系 —— 它既不是该书的某一版，该书也不是它的某一版。作者 Strange。</p>
      <a class="cta" style="margin:14px 0 0;max-width:330px" href="https://mirror.strangeyu.xyz/" target="_blank" rel="noopener">打开增补版 →</a>
    </div>
  </div>

  <hr style="border:0;border-top:1px solid #f2f0ec;margin:20px 0">

  <div class="mrow">
    <a class="mshot" href="https://mirror.strangeyu.xyz/patch" target="_blank" rel="noopener"><img src="${SITE_ORIGIN}/shot/patch.webp" alt="「衰退时代补丁包」首屏：升级 / 反转 / 新增 / 降级四个彩色标签与证据体系说明" width="1200" height="750" loading="lazy" decoding="async"></a>
    <div class="mtext">
      <div class="bmeta">
        <b><a href="https://mirror.strangeyu.xyz/patch" target="_blank" rel="noopener">衰退时代补丁包：41 条下行周期要改的账</a></b>
        <span class="dim">《高性价比人生指南》的独立增补 · 不含该书正文 · 本站维护者自己的作品</span>
      </div>
      <p class="feat" style="margin:12px 0 0;flex:none">《高性价比人生指南》讲的是「正常时代怎么活」，这份只讲<b>衰退期哪些账会变</b>：升级 / 反转 / 新增 / 降级四类，每条写明成本、换回什么、证据档和适用人群，另按「情形档位」与证伪信号决定要不要加码。</p>
      <p class="dim" style="margin:8px 0 0">它<b>没有收录、复制或改动《高性价比人生指南》任何一条正文</b>，是作者依据自己的研究另写的独立作品，与它并列而非它的某一版。文字与代码以 CC BY-NC-SA 4.0 开源。作者 Strange。</p>
      <a class="cta" style="margin:14px 0 0;max-width:330px" href="https://mirror.strangeyu.xyz/patch" target="_blank" rel="noopener">打开补丁包 →</a>
    </div>
  </div>

  <hr style="border:0;border-top:1px solid #f2f0ec;margin:20px 0">

  <div class="mrow">
    <a class="mshot" href="https://strangeyu911-tech.github.io/justin-sun-corpus/" target="_blank" rel="noopener"><img src="${SITE_ORIGIN}/shot/justin-sun-corpus.webp" alt="「孙割这十年」首屏：左侧目录、大标题「说中了什么，说错了什么」与两卷入口" width="1200" height="750" loading="lazy" decoding="async"></a>
    <div class="mtext">
      <div class="bmeta">
        <b><a href="https://strangeyu911-tech.github.io/justin-sun-corpus/" target="_blank" rel="noopener">高性价比人生指南（孙割版）</a></b>
        <span class="dim">孙割这十年：说中了什么，说错了什么 · 整理孙宇晨十年公开语料 · 本站维护者自己的作品</span>
      </div>
      <p class="feat" style="margin:12px 0 0;flex:none">把<b>孙宇晨</b>跨度约十年的两套公开材料放在一起：2016–2017 年的付费音频专栏《财富自由革命之路》全 156 集，与 2026 年的一次 4 小时 22 分长访谈。按年份分卷、逐板块标注证据等级，另附一张逐条的十年对照表。</p>
      <p class="dim" style="margin:8px 0 0">它<b>不下判断，只做转述与来源定级</b> —— 每条引语标明「离原话有多远」，精确到讲号或时间码。「高性价比人生指南（孙割版）」是一句顺口别名；内容全部整理自孙宇晨的公开语料，与《高性价比人生指南》没有内容关系。作者 Strange。</p>
      <a class="cta" style="margin:14px 0 0;max-width:330px" href="https://strangeyu911-tech.github.io/justin-sun-corpus/" target="_blank" rel="noopener">打开孙割版人生指南 →</a>
    </div>
  </div>
</div>

<h2 id="related">另见：与《高性价比人生指南》有关、但还没进上游清单的两件<span class="aside-tag">未被收录进衍生项目清单</span></h2>
<p class="h2n"><b>本站收录的这 ${stats.total} 个衍生项目，准绳是只收上游 <code>衍生项目.md</code> 里已经列出的项目</b>。下面这两件不在那份清单里，所以<b>不参与本页的同步对比，也不计入「${stats.total} 个项目」</b>。放在这里只是因为它们确实与《高性价比人生指南》相关、也确有其用。</p>
<div class="panel">

  <div class="mrow">
    <a class="mshot" href="https://nicecao.github.io/HowToWorkBetter/" target="_blank" rel="noopener"><img src="${SITE_ORIGIN}/shot/howtoworkbetter.webp" alt="「高性价比工作指南」首屏：大标题与「按你现在在哪一步」的阶段卡片" width="1200" height="750" loading="lazy" decoding="async"></a>
    <div class="mtext">
      <div class="bmeta">
        <b><a href="https://nicecao.github.io/HowToWorkBetter/" target="_blank" rel="noopener">高性价比工作指南</a></b>
        <span class="dim">另一部作品（上班篇）· 不含《高性价比人生指南》正文 · 未被收录进衍生项目清单</span>
      </div>
      <p class="feat" style="margin:12px 0 0;flex:none">跟着《高性价比人生指南》那套体例另写的一本「上班篇」：<b>51 章 454 条</b>，从选行业、投简历、谈薪、社保公积金、被裁怎么拿最多、跳槽涨薪，到向上管理、反 PUA、劳动合同与劳动仲裁、工伤、职业转型、商务礼仪。每条同样写明成本、收益、证据等级和原始出处。</p>
      <p class="dim" style="margin:8px 0 0">它<b>没有收录、复制或改动《高性价比人生指南》任何一条正文</b>，是与该书并列的独立作品，不是该书的某一版。作者 NiceCao。正文 CC BY 4.0、代码 MIT，<a href="https://github.com/NiceCao/HowToWorkBetter" target="_blank" rel="noopener">仓库里有 PDF / EPUB / 离线单页</a>。</p>
      <a class="cta" style="margin:14px 0 0;max-width:330px" href="https://nicecao.github.io/HowToWorkBetter/" target="_blank" rel="noopener">打开在线检索页 →</a>
    </div>
  </div>

  <hr style="border:0;border-top:1px solid #f2f0ec;margin:20px 0">

  <div class="mrow">
    <a class="mshot" href="https://shangbanbao.com/" target="_blank" rel="noopener"><img src="${SITE_ORIGIN}/shot/shangbanbao.webp" alt="「上班宝」首屏：「今天这 3 条」与三张带出处标签的当日建议卡" width="1200" height="750" loading="lazy" decoding="async"></a>
    <div class="mtext">
      <div class="bmeta">
        <b><a href="https://shangbanbao.com/" target="_blank" rel="noopener">上班宝</a></b>
        <span class="dim">把《高性价比人生指南》与《工作指南》放一起的检索/问答工具 · 未被收录进衍生项目清单</span>
      </div>
      <p class="feat" style="margin:12px 0 0;flex:none">同一位作者做的小工具：<b>每天推 3 条</b>（标明出自哪一本）、可按关键词和章节搜、也可以直接提问 —— 答案只依据这两部作品里的条目，并列出依据是第几章第几条；书里查不到的会直说答不上来。免费、无广告。</p>
      <p class="dim" style="margin:8px 0 0">⚠️ 它<b>确实会读到《高性价比人生指南》条目</b>，但页面上没有标注自己同步到了哪一版，本站<b>核实不出它的内容版本</b>，所以没有把它放进本站的同步对比里 —— 这是「测不出来」，不是「它旧」。作者同样把它的出处与许可写明在<a href="https://github.com/NiceCao/HowToWorkBetter" target="_blank" rel="noopener">自己的仓库</a>里。</p>
      <a class="cta" style="margin:14px 0 0;max-width:330px" href="https://shangbanbao.com/" target="_blank" rel="noopener">打开上班宝 →</a>
    </div>
  </div>
</div>
<p class="dim" style="margin:12px 0 0">这两件的作者曾向上游提交过收录申请，维护者以「第三方工具栏已经列得比较长了」为由暂未收进清单 —— 所以本站收录的这 ${stats.total} 个项目里没有它们。原申请与答复可在上游仓库查到。</p>

<details class="more">
<summary>逐项查证依据 · badge 接口 · GitHub 墙内实测 · 测不到什么<span class="sm">（技术细节，默认收起）</span></summary>
<div class="morebody">

<h2 id="verify">逐项查证明细</h2>
<p class="h2n">每一行都写明了<b>我们是怎么知道的</b>：<b>实测产物</b> = 读该项目自己发布的文件（小程序数据包、App 的 <code>entries.json</code>、数据集的 <code>stats.json</code>…）数出来的真实条数；<b>商店/页面自述</b> = 只有它自己写的数字可参考，属弱信号；<b>运行时拉取</b> = 每次打开都直接向源仓库取最新正文，所以不存在「落后」这个概念。右侧是这台机器抓到的原始证据，可逐条复核。</p>
<div class="panel" style="overflow-x:auto">
<table>
<thead><tr><th>项目</th><th>核实方式</th><th>该项目已收录</th><th>落后条数</th><th>抓到的原始证据</th></tr></thead>
<tbody>
${detailRows}
</tbody>
</table>
</div>

<h2 id="badge">同步状态 badge（动态接口）</h2>
<p class="h2n">这是本项目想推给整个生态的东西：一个<b>可机器核验</b>的「我同步到哪一版」标记。<b>${stats.total} 个项目里已有 ${stats.withOwnVersion} 个自带可核验的版本号</b> —— 比如 better.aigcwei.cn 的 <code>sync/fingerprint.json</code> 直接写了上游 commit 与逐条哈希，BetterLifeApp 的 <code>entries.json</code> 带 <code>contentVersion</code>，htlb-dataset 的 <code>stats.json</code> 带 <code>upstream_commit</code>。这说明<b>「自报版本」的习惯在生态里已经存在，缺的只是统一格式和现成的读取工具</b>。下面每一条都能直接贴进你自己的 README —— 它指向本站的动态接口，上游一更新、数字自动变，不用谁手动改。</p>
<div class="panel">
${badgeRows}
</div>
<p class="h2n" style="margin-top:14px">下面是可直接粘贴的<b>动态接口</b>地址：<code>${API_ORIGIN}/badge/&lt;项目 slug&gt;.svg</code> · 机器可读：<code>${API_ORIGIN}/api/status.json</code> · 该接口每次请求会去上游取一次最新条目数（边缘缓存 10 分钟），所以 badge 上的数字是<b>活的</b>，不用谁手动改。<br>⚠️ 页面上你看到的那几张徽章走的是<b>本站静态副本</b>（<code>${SITE_ORIGIN}/badge/&lt;slug&gt;.svg</code>），它跟着本站每日重算一起更新 —— 所以本页自身不依赖那个动态接口，加载更快；要<b>实时</b>数字请用上面的动态地址。</p>

<h2 id="probe">为什么需要这个页面：GitHub 墙内实测</h2>
<p class="h2n">本机裸连（未开梯子）各通道各 5 轮取中位数。${ghProbe.samples} 轮样本，${ghProbe.generatedAt.slice(0, 10)} 采集。</p>
<div class="panel">
<table>
<thead><tr><th>通道</th><th>成功率</th><th>中位延迟</th><th>p90</th><th>波动（max−min）</th></tr></thead>
<tbody>
${ghRows}
</tbody>
</table>
<p class="h2n" style="margin:14px 0 0">读法：<b>成功率全是 100%</b> —— 所以问题不是「打不开」，而是<b>「打开要等多久、以及每次都不一样」</b>。网页通道（普通人唯一的入口）中位 <b>${ghSec(ghHtml.median)} 秒</b>、最坏 <b>${ghSec(ghHtml.max)} 秒</b>、波动 <b>${ghSec(ghHtml.spread)} 秒</b>；开发者通道（api / raw）反而很快。这就是「能上，但习惯开梯子」的物理原因。</p>
<p class="h2n" style="margin:14px 0 0"><b>本页自己不在上面这一列。</b>本站的静态页放在 <b>GitHub Pages</b>（走 Fastly，<code>*.github.io</code>），跟 <code>github.com</code> 的网页不是同一条链路；动态接口（活的徽章、<code>/api/status.json</code>）留在 <code>htlb-api.strangeyu.xyz</code>。所以下面这些卡片的「打开多快」，取决于各站自己的服务器，而不是本站。</p>
</div>

<h2 id="source">数据是怎么来的，以及它测不到什么</h2>
<ol>
<li><b>主证据是「条数」，只用四条能落地的路子。</b>① <b>实测产物</b>：读项目自己发布的文件（小程序数据包、App 的 <code>entries.json</code>、数据集的 <code>stats.json</code>、站点自带的数据文件…），按上游官方口径（<code>book/*.md</code> 里的 <code>###</code> 标题数）数出真实条数；② <b>fork 对比</b>：它若是上游 fork，直接逐文件数它的 <code>book/*.md</code>；③ <b>逐条页清单</b>：很多静态站给每条内容都生成了一个独立页面，数 sitemap 里的逐条页即可；④ <b>运行时</b>：读源码确认它每次打开都直接向上游取最新正文 → 不存在「落后」，从落后名单里剔除。每行用的哪条路子，都写在表里。</li>
<li><b>为什么不拿「逐字比对正文」当主证据。</b>我们试过用上游条目标题原文去各站做精确匹配，14 项里 13 项 <b>0 命中</b> —— 因为各站普遍会改写标题。真正能比的是站点的<b>数据文件</b>（比如 howtolivebetter.net 把正文完整打在 <code>book-index-*.js</code> 里，对上游标题 <b>684/685 = 99.9% 命中</b>），但每个站的数据文件位置都不一样，得逐站定制，通用性差。所以本页把「条数」作为主证据，逐字比对只在个别站点做交叉验证。</li>
<li><b>「落后多少条」用上游官方口径复算过。</b>上游条目数由 <code>git log -p -- book/</code> 逐次累积统计得出（本机复算 <b>${UP_COUNT} 条</b>，共 ${UP.totalCommits} 次提交），再与各项目的实测/自述条数相减。两个输入都能独立复核。</li>
<li><b>「落后 N 天」有粒度盲区。</b>${UP_COUNT} 条是某天某一刻达到的，而当天很多提交只改文档、不改条数。所以我们优先用站点<b>自己声明的构建 / 修订时间</b>（构建产物时间、更新记录页、App 版本发布日期），拿不到才退回 sitemap 的 <code>lastmod</code>，再拿不到才用「该条数首次出现在上游的时间」。准确说法是：<b>「若内容停在达到 N 条的那次提交，则大约落后 N 天」</b>。要更准只能逐站 diff 正文。</li>
<li><b>「运行时自动跟进」是读了源码得出的，不是我们替它保证的。</b>例如 daily-life-tip 的 <code>RemoteBook.swift</code> 里写着「内置的那份数据是编译时快照，永远能出内容。这里只负责『书更新了，跟上去』」；shiye-tab 的 <code>src/sources.js</code> 每次打开都拉 <code>raw.githubusercontent.com/eternity4719/…</code> 并按 <code>### </code> 解析。这类项目<b>不该被算作「落后」</b>。</li>
<li><b>「自述」和「实测」在表里是分开的。</b>实测 = 读它自己发布的文件数出来的真数；自述 = 只有它自己写的数字可参考。目前 ${stats.total} 项里有 <b>${stats.measured} 项</b>拿到了实测依据；剩下 ${stats.selfDeclaredOnly} 项是 iOS App，只能读商店页文案 —— <b>App 的条目数不下载安装包就测不了，这是诚实的边界</b>，我们不会拿自述当真数。</li>
<li>「门槛」一列<b>照抄上游 <code>衍生项目.md</code> 的原文口径</b>，标「未标注」= 原文也没写，<b>非本站核验</b>。可达性、延迟、CDN、条目数为本站实测。</li>
<li>可达性是<b>单机单时点</b>结论。Cloudflare 站在国内「时通时不通」，探活全通只说明<b>此刻</b>通畅。</li>
<li>本页<b>不转载正文、不开评论区</b>。正文版权归上游及各衍生作者，有出入时以 <a href="https://github.com/eternity4719/HowToLiveBetter" target="_blank" rel="noopener">上游中文原文</a> 为准（CC BY 4.0）。</li>
<li><b>数据是活的，但不是秒级。</b>本站 Worker 每次请求会去上游取一次最新条目数（边缘缓存 10 分钟）；完整的逐项重算由 <b>GitHub Actions 每天跑一次</b>，结果回灌进本站的数据层，页脚会显示上次重算时间。</li>
</ol>

</div>
</details>

<footer>
上游：<a href="https://github.com/eternity4719/HowToLiveBetter" target="_blank" rel="noopener">eternity4719/HowToLiveBetter</a> · CC BY 4.0 · ${UP.stars ? UP.stars.toLocaleString() : '—'} ★ / ${UP.forks ? UP.forks.toLocaleString() : '—'} forks · 最新提交 <code>${String(UP.headSha).slice(0, 8)}</code>（${UP.headDate ? new Date(UP.headDate).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '—'}）<br>
本站由 <code>fetch-upstream.sh</code>（取上游 git 历史）→ <code>verify-upstream.mjs</code> / <code>verify-ecosystem.mjs</code>（查证）→ <code>build-site.mjs</code>（渲染）→ <code>deploy.mjs</code>（部署到 Cloudflare Worker）串成，生成于 ${genAt}。<br>
逐项重算由 GitHub Actions 每日自动执行并回灌本站数据层；本页构建于：<b id="crawlAt">${genAt}</b>。聚合与查证由 Strange 维护。
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

  // 静态页在 GitHub Pages 上，所以这里要写**绝对**地址指向 Worker 上的动态接口。
  // 异步、失败就保持构建期的快照值，不阻塞渲染。
  fetch('${API_ORIGIN}/api/status.json').then(function(r){return r.json();}).then(function(d){
    if(!d)return;
    var n=document.querySelector('#upn');
    if(n&&d.upstream)n.textContent=d.upstream.entries;
    var c=document.querySelector('#crawlAt');
    if(c)c.textContent=(d.lastCrawlAt?new Date(d.lastCrawlAt).toLocaleString('zh-CN',{hour12:false}):'尚未回灌')+'（实时值）';
  }).catch(function(){});
})();
</script>

<script>
/* ── 页面目录：抽屉开合 / 锚点跳转（自动展开「技术细节」）/ 当前区块高亮 ──
   零依赖。刻意不做「整页平滑滚动到锚点」的自研实现，交给 CSS 的
   html{scroll-behavior:smooth}；这里只负责展开、关抽屉、算高亮。 */
(function () {
  var nav = document.getElementById('toc');
  var mask = document.getElementById('toc-mask');
  var btn = document.getElementById('tocbtn');
  var bar = document.querySelector('header.top');
  var more = document.querySelector('details.more');
  if (!nav || !bar) return;

  /* 顶栏在窄屏会折行，高度不是固定 56px —— 用实测高度写 --bar-h，
     抽屉才不会跟顶栏错位、锚点也不会被 sticky 顶栏盖住 */
  function syncBarH() {
    document.documentElement.style.setProperty('--bar-h', bar.offsetHeight + 'px');
  }
  syncBarH();
  window.addEventListener('resize', syncBarH);

  function drawer(open) {
    nav.classList.toggle('open', open);
    if (mask) mask.classList.toggle('show', open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (btn) btn.addEventListener('click', function () { drawer(!nav.classList.contains('open')); });
  if (mask) mask.addEventListener('click', function () { drawer(false); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') drawer(false); });

  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
  var targets = links.map(function (a) {
    var h = a.getAttribute('href');
    return h.length > 1 ? document.getElementById(h.slice(1)) : null;   /* #top 没有对应元素，靠浏览器原生行为 */
  });

  /* 「技术细节」默认收起 —— 目录里有四项在它内部，不先展开的话点了没反应 */
  function openIfInside(el) {
    if (more && el && more.contains(el) && !more.open) more.open = true;
  }
  links.forEach(function (a) {
    a.addEventListener('click', function () {
      openIfInside(document.getElementById(a.getAttribute('href').slice(1)));
      drawer(false);
    });
  });
  if (location.hash.length > 1) openIfInside(document.getElementById(location.hash.slice(1)));

  /* 当前区块高亮：只认「看得见」的目标 —— 收起时 details 内元素高度为 0，
     放进来比较会把高亮永远卡在第一个技术条目上 */
  var ticking = false;
  function spy() {
    ticking = false;
    var line = window.scrollY + window.innerHeight * 0.32;
    var best = -1;
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      if (!el || el.getBoundingClientRect().height === 0) continue;
      if (el.getBoundingClientRect().top + window.scrollY <= line) best = i;
    }
    for (var j = 0; j < links.length; j++) links[j].classList.toggle('active', j === best);
  }
  function onScroll() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(spy); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', spy);
  if (more) more.addEventListener('toggle', spy);

  /* 「展开 / 收起技术细节」一键开关（那里面装着全页一半的篇幅） */
  var tool = document.getElementById('toc-expand');
  if (tool && more) {
    var sync = function () { tool.textContent = more.open ? '收起技术细节' : '展开技术细节'; };
    tool.addEventListener('click', function () { more.open = !more.open; sync(); });
    more.addEventListener('toggle', sync);
    sync();
  }
  spy();
  /* 首次 spy() 可能在字体、徽章图就位之前就跑完了 —— 那时各行高度还没定，
     高亮会停在错误的条目上（实测：滚动位置 0 时误亮「选一个用」）。
     布局一稳定就重算一遍。 */
  window.addEventListener('load', spy);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(spy);
  setTimeout(spy, 400);
})();
</script>
</body>
</html>`;

const outDir = path.join(DIR, 'site');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');

// 卡片缩略图预检 —— 缺图不会让构建失败，但会让卡片开天窗，先喊出来。
// 图是从各项目真实页面截的，见 README「卡片截图是怎么来的」。
const shotDir = path.join(outDir, 'shot');
const shotMissing = rows.filter((r) => !fs.existsSync(path.join(shotDir, r.slug + '.webp'))).map((r) => r.slug);
if (shotMissing.length) console.warn(`⚠️  缺卡片截图 ${shotMissing.length}/${rows.length}：${shotMissing.join(', ')}`);

// 「另见」区块的 5 张图不在 rows 里，单独查一次，免得卡片开天窗
const EXTRA_SHOTS = ['mirror', 'patch', 'justin-sun-corpus', 'howtoworkbetter', 'shangbanbao'];
const extraMissing = EXTRA_SHOTS.filter((s) => !fs.existsSync(path.join(shotDir, s + '.webp')));
if (extraMissing.length) console.warn(`⚠️  缺「另见」区块截图 ${extraMissing.length}/${EXTRA_SHOTS.length}：${extraMissing.join(', ')}`);

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
    linkLabel: r.linkLabel,
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
    carriedFrom: r.carriedFrom,
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
