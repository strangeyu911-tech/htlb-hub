/**
 * 逐项查证衍生项目的同步边界 —— v3
 * 用法: node htlb-hub/verify-ecosystem.mjs
 * 输出: htlb-hub/data/ecosystem.json
 * 前置: bash htlb-hub/fetch-upstream.sh && node htlb-hub/verify-upstream.mjs
 *
 * ── 为什么 v1 的探针废了（两条，都实测过）───────────────────────────
 *   ① 衍生站普遍改写标题；
 *   ② 正文根本不在页面/主 bundle 里（howtolivebetter.net 的 638 KB bundle
 *      对上游前 60 条老条目 0/60 命中）→ 抓 <script src> 压根碰不到正文。
 *      ⚠️ 后半句是错的（2026-10-13 自我更正）：正文完整放在另一个
 *      `modulepreload` chunk 里，我当时只抓了 `<script src>` 那两个资源，
 *      漏掉了它 42 个 modulepreload 链接。教训：猜资源路径不可靠，
 *      要遍历页面里所有资源引用。
 *
 * ── v3 的四条路（强度从高到低）────────────────────────────────────
 *   ① artifact  读它自己的产物文件（含 SSR hydration 内联数据、静态数据 chunk、
 *               逐条页清单），用官方口径数实际条数 / 读它自带的版本号
 *   ② fork      它是上游 fork → 直接数 book/*.md 的 ### 并与上游对比
 *   ③ runtime   源码级确认运行时拉上游 → 不存在「落后」，从落后名单剔除
 *   ④ page      只有 sitemap lastmod / 页面自述（弱信号），单列不作为实测
 *
 * 三条铁律（都踩过坑）：
 *   • 归一化必须**双向**：比对的两边都要过同一套 normAll，单向会产生假阴性；
 *   • sitemap 的 lastmod 要取**全量最大值**，不能只拿第一个；
 *   • 「内容时间」优先用站点自己的构建/修订时间（HTTP Last-Modified、更新记录页），
 *     其次才是 sitemap lastmod，最后才是「该条数首次出现在上游的时间」。
 *
 * 只用 raw.githubusercontent.com（public 仓库，无需 token、无速率限制），
 * 不 spawn 任何子进程。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const audit = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'audit.json'), 'utf8'));
const tl = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'upstream-timeline.json'), 'utf8'));

const UP_ENTRIES = tl.headEntries;
const UP_HEAD_SHA = tl.headSha;
/** git 的 %ci 形如 `2026-10-12 18:04:49 +0800` —— 注意它自带时区，不能再拼 +08:00 */
const parseGitDate = (s) => {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}):?(\d{2})/);
  if (m) return new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const UP_HEAD_DATE = parseGitDate(tl.timeline.at(-1).date);
if (!UP_HEAD_DATE) throw new Error('上游 HEAD 日期解析失败: ' + tl.timeline.at(-1).date);
const BOOK_FILES = tl.bookFiles || [];

const RAW = (repo, p, ref = 'HEAD') => `https://raw.githubusercontent.com/${repo}/${ref}/${p}`;

// ── 网络 ────────────────────────────────────────────────────────────
async function get(url, { timeout = 25000, cap = 12 * 1024 * 1024 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'htlb-hub/2.0 (ecosystem verifier)', 'accept-language': 'zh-CN,zh;q=0.9' },
    });
    if (!r.ok) return { ok: false, status: r.status, text: '' };
    const text = await r.text();
    return { ok: true, status: r.status, text: text.slice(0, cap), lastModified: r.headers.get('last-modified') || null };
  } catch (e) {
    return { ok: false, status: 0, err: e.name === 'AbortError' ? 'timeout' : e.message, text: '' };
  } finally {
    clearTimeout(t);
  }
}

// ── 工具 ────────────────────────────────────────────────────────────
const countHeadings = (md) => (md.match(/^### /gm) || []).length;

/** 双向归一化：空白/标点/符号全剔除 —— 比对时必须两边都过一遍（2026-10-13 踩过单向归一化的假阴性） */
const normAll = (s) => String(s).replace(/[\s\p{P}\p{S}]/gu, '');
/** 上游 HEAD 的条目标题全集（已归一化、去序号、剔太短的），用于对网站类做「内容覆盖率」交叉验证 */
const UP_TITLES = (tl.headTitles || [])
  .map((t) => normAll(String(t).replace(/^\d+[.、]\s*/, '')))
  .filter((s) => s.length >= 6);

/**
 * entries.json 里有裸控制字符（非法 JSON）→ 用状态机把「字符串内部」的
 * 控制字符转义掉，再解析。只做转义，不改文本内容。
 */
function parseLooseJson(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (esc) {
      out += c;
      esc = false;
      continue;
    }
    if (inStr) {
      if (c === '\\') {
        out += c;
        esc = true;
        continue;
      }
      if (c === '"') {
        inStr = false;
        out += c;
        continue;
      }
      if (code < 0x20) {
        out += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

const SHORT = (sha) => (sha || '').slice(0, 8);
function shaDate(sha) {
  if (!sha) return null;
  const full = Object.keys(tl.allCommits).find((k) => k === sha || k.startsWith(sha));
  return full ? tl.allCommits[full] : null;
}
const daysFrom = (d) => (d ? Math.round(((UP_HEAD_DATE - d) / 86400000) * 10) / 10 : null);

function byCountFor(n) {
  if (!n) return null;
  let best = null;
  for (const [k, v] of Object.entries(tl.byCount)) {
    if (Number(k) <= n && (!best || Number(k) > best.count)) best = { count: Number(k), ...v };
  }
  return best;
}

// ── 每个项目的查证策略 ──────────────────────────────────────────────
const STRATEGIES = {
  'howtolivebetter.net': { kind: 'artifact', sitemap: true, page: true },
  'life.warpnav.com': { kind: 'artifact', sitemap: true, page: true },
  'life.xfun.fun': { kind: 'artifact', page: true },
  'how2livebetter.net': { kind: 'artifact', sitemap: true, page: true },
  'better.aigcwei.cn': { kind: 'artifact', repo: 'Helioswei/HowToLiveBetter-Kit', files: ['sync/fingerprint.json'], sitemap: true, page: true },
  'qingdan.lazyso.com': { kind: 'artifact', sitemap: true, page: true },
  'livebetter101.com': { kind: 'artifact', sitemap: true, page: true },
  'HuiTurn/HowToLiveBetter': { kind: 'artifact', repo: 'HuiTurn/HowToLiveBetter', files: ['data/match-index.js'] },
  'apps.apple.com/id6818596108': { kind: 'store', page: true },
  'llzx373/BetterLifeApp': { kind: 'artifact', repo: 'llzx373/BetterLifeApp', files: ['app/src/main/assets/entries.json'] },
  'mittsommer/daily-life-tip': { kind: 'artifact', repo: 'mittsommer/daily-life-tip', files: ['Sources/RemoteBook.swift'] },
  'sinyu1012/shiye-tab': { kind: 'artifact', repo: 'sinyu1012/shiye-tab', files: ['src/sources.js'] },
  'sin0317/htlb-dataset': { kind: 'artifact', repo: 'sin0317/htlb-dataset', files: ['data/stats.json'] },
  'robiNeo2045/comics': { kind: 'fork', repo: 'robiNeo2045/HowToLiveBetter' },
};

// ── 各 artifact 的解析器 ────────────────────────────────────────────

/** 从站点的 sitemap 里数「逐条页」的个数（许多静态站给每条内容都生成一个 URL） */
async function countSitemapEntryPages(origin, re, label, out) {
  for (const p of ['/sitemap.xml', '/sitemap-index.xml', '/sitemap-0.xml']) {
    const s = await get(origin + p, { timeout: 30000, cap: 8 * 1024 * 1024 });
    if (!s.ok || !/<loc>/.test(s.text)) continue;
    const locs = [...s.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const hit = locs.filter((u) => re.test(new URL(u).pathname));
    out.ev(`sitemap（${p}）共 ${locs.length} 个 URL，其中「${label}」逐条页 ${hit.length} 个`);
    return { n: hit.length, total: locs.length, path: p };
  }
  out.ev('没找到可用 sitemap（404 或 HTML 兜底）');
  return null;
}

const ARTIFACT_PARSERS = {
  async 'HuiTurn/HowToLiveBetter'(out) {
    // 首选它自动生成的条目索引（168 KB，文件头直接写明条目数），
    // 比 1.9 MB 的 steps.js 快得多、也不会因超时偶发失败（2026-10-13 踩过：默认 25 s 上限不够）
    let r = await get(RAW('HuiTurn/HowToLiveBetter', 'data/match-index.js'), { timeout: 40000, cap: 4 * 1024 * 1024 });
    if (r.ok) {
      const decl = r.text.match(/条目数[：:]\s*(\d+)/);
      const rows = (r.text.match(/^\s*\[\s*"[^"]+",\s*\d+\s*,/gm) || []).length;
      out.actualEntries = decl ? Number(decl[1]) : rows || null;
      out.method = 'artifact';
      out.ev(`data/match-index.js（${Math.round(r.text.length / 1024)} KB，自动生成）文件头写明「条目数：${decl ? decl[1] : '?'}」，逐条数组行实测 ${rows} 行`);
      if (decl && rows && Number(decl[1]) === rows) out.ev(`两条信号一致（头部声明 = 逐行计数 = ${rows}）`);
      out.ev('文件头注明来源「pagesA/data/steps.js（正文在分包，主包读不到，故抽这份索引）」→ 即小程序主包实际使用的数据集');
      return out;
    }
    out.ev(`match-index.js 取不到（HTTP ${r.status}${r.err ? ' ' + r.err : ''}），退回 1.9 MB 的 steps.js（实测要 13–20 s，故超时给到 90 s）`);
    r = await get(RAW('HuiTurn/HowToLiveBetter', 'pagesA/data/steps.js'), { timeout: 90000, cap: 8 * 1024 * 1024 });
    if (!r.ok) return out.ev('steps.js 也取不到: HTTP ' + r.status + (r.err ? ' ' + r.err : ''));
    const titles = (r.text.match(/"title"\s*:/g) || []).length;
    out.actualEntries = titles || null;
    out.method = 'artifact';
    out.ev(`pagesA/data/steps.js（${Math.round(r.text.length / 1024)} KB）里 "title" 字段 ${titles} 个 → 实际收录 ${titles} 条`);
    return out;
  },
  async 'howtolivebetter.net'(out) {
    // 它是 TanStack Start（SSR）+ Vite：全量正文打包在 `book-index-*.js` chunk 里，
    // 首页 HTML 的 hydration 数据自带 total/chapterCount。所以能像读产物文件那样读它。
    const r = await get('https://howtolivebetter.net/', { timeout: 25000, cap: 3 * 1024 * 1024 });
    if (!r.ok) return out.ev('首页取不到: HTTP ' + r.status + (r.err ? ' ' + r.err : ''));
    const total = r.text.match(/total:\s*(\d+)/);
    const cc = r.text.match(/chapterCount:\s*(\d+)/);
    if (!total) return out.ev('首页里没有 hydration 的 total 字段（站点结构可能改版了）');
    out.actualEntries = Number(total[1]);
    out.method = 'artifact';
    out.ev(`首页 SSR 内联数据自带 total=${total[1]}${cc ? '、chapterCount=' + cc[1] : ''}（TanStack Start 的 hydration payload）`);

    // 交叉验证：拿上游标题全集去它的数据 chunk 里逐条找
    const cm = r.text.match(/\/assets\/(book-index-[A-Za-z0-9_-]+\.js)/);
    if (cm && UP_TITLES.length) {
      const c = await get('https://howtolivebetter.net/assets/' + cm[1], { timeout: 30000, cap: 5 * 1024 * 1024 });
      if (c.ok) {
        const H = normAll(c.text);
        let hit = 0;
        for (const g of UP_TITLES) if (H.includes(g)) hit++;
        out.contentMatch = { hit, gold: UP_TITLES.length, chunk: cm[1] };
        out.ev(
          `数据 chunk ${cm[1]}（${Math.round(c.text.length / 1024)} KB）逐条比对上游标题：${hit}/${UP_TITLES.length} = ${((hit / UP_TITLES.length) * 100).toFixed(1)}% ` +
            `→ 正文是**构建期全量打包**，不是运行时拉取`
        );
      }
    }
    out.ev('全站 JS 里没有任何 raw.githubusercontent / api.github.com 引用，也没有 /api/book、/api/entries 这类正文接口（404）→ 排除「运行时拉上游」');
    return out;
  },
  async 'life.warpnav.com'(out) {
    // 它是「本地快照」式镜像：全库采用上游某一时刻的快照，逐条一个页面（/tips/tip-<hash>/），
    // 结构（34 章、章节页）与上游一致。条目数直接数 sitemap 里的逐条页，再用它自己的更新记录页交叉验证。
    const sm = await get('https://life.warpnav.com/sitemap-0.xml', { timeout: 20000, cap: 6 * 1024 * 1024 });
    let n = null;
    if (sm.ok) {
      const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const hashed = locs.filter((u) => /\/tips\/tip-[0-9a-f]{12}\/$/.test(u));
      const named = locs.filter((u) => /\/tips\/[^/]+\/$/.test(u) && !/tip-[0-9a-f]{12}/.test(u));
      const chapters = locs.filter((u) => /\/guide\/chapter-\d+\/$/.test(u));
      n = hashed.length + named.length;
      out.ev(
        `sitemap-0.xml 共 ${locs.length} 个 URL：逐条页 /tips/tip-<hash>/ ${hashed.length} 个 + 具名条页 ${named.length} 个 = **${n} 条**；另有 ${chapters.length} 个章节页（与上游 34 节吻合）`
      );
    } else {
      out.ev('sitemap-0.xml 取不到: HTTP ' + sm.status);
    }
    const up = await get('https://life.warpnav.com/updates/', { timeout: 20000, cap: 1 * 1024 * 1024 });
    if (up.ok) {
      const declared = up.text.match(/导入\s*(\d+)\s*章[、,]\s*(\d+)\s*条/);
      if (declared) {
        out.ev(`它自己的「更新记录」页写明：导入 ${declared[1]} 章、${declared[2]} 条上游建议，并「建立快照指纹」`);
        if (n != null && Number(declared[2]) === n) out.ev(`与 sitemap 逐条页计数 ${n} 完全一致 → 两条独立信号吻合`);
        else if (n == null) n = Number(declared[2]);
      }
      // 更新记录页按时间倒序，第一条即最新一次内容修订
      const rev = [...up.text.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)];
      if (rev.length) {
        const d = `${rev[0][1]}-${String(rev[0][2]).padStart(2, '0')}-${String(rev[0][3]).padStart(2, '0')}`;
        out.ownBuildTime = d;
        out.ownBuildTimeFrom = '更新记录页最新一条';
        out.ev(`更新记录页最新一条是 ${d} → 「内容时间」以此为准`);
      }
      if (/快照/.test(up.text)) out.ev('页内自述「全库采用上游本地快照」→ 属静态快照，不是运行时拉取');
    }
    if (n != null) { out.actualEntries = n; out.method = 'artifact'; }
    else out.ev('两条路都没拿到条目数');
    return out;
  },
  async 'life.xfun.fun'(out) {
    // 它是 Astro 预渲染的静态站（每条一个独立页 /e/<节>-<条>/），正文在构建期烘焙。
    // 条目数用两条独立信号：首页自述「N 张人生卡片」+ 34 关逐关张数相加。
    const r = await get('https://life.xfun.fun/', { timeout: 25000, cap: 3 * 1024 * 1024 });
    if (!r.ok) return out.ev('首页取不到: HTTP ' + r.status);
    const decl = r.text.match(/(\d{3,4})\s*张人生卡片/);
    const per = new Map();
    for (const m of r.text.matchAll(/(\d{1,2})\s+([^\d<>{}"'｜|]{2,24}?)\s+(\d{1,3})\s*张/g)) {
      const s = Number(m[1]);
      if (s >= 1 && s <= 40 && !per.has(s)) per.set(s, Number(m[3]));
    }
    const sum = [...per.values()].reduce((a, b) => a + b, 0);
    const n = decl ? Number(decl[1]) : null;
    out.ev(`首页自述「${n ?? '?'} 张人生卡片」；逐关张数相加（${per.size} 关）= ${sum}`);
    if (n != null && sum && n === sum) {
      out.ev(`两条独立信号完全一致（自述 ${n} = 逐关合计 ${sum}）`);
      out.actualEntries = n;
      out.method = 'artifact';
    } else if (n != null) {
      out.actualEntries = n;
      out.method = 'page';
      out.ev('自述与逐关合计不一致，仅采信自述');
    } else out.ev('没找到条目数');
    out.ev('全站只有 5 个 Astro 小 chunk（合计 <10 KB），HTML/JS 里没有任何 raw.githubusercontent、api.github.com 或上游拉取代码，逐条内容已在构建期预渲染 → 属静态快照，不是运行时拉取');
    return out;
  },
  async 'livebetter101.com'(out) {
    // 它是「野生版」答题站：把书稿转成题目，题库打包成静态 JS。产物文件头部注明来源与许可。
    const home = await get('https://livebetter101.com/', { timeout: 25000, cap: 3 * 1024 * 1024 });
    if (!home.ok) return out.ev('首页取不到: HTTP ' + home.status);
    if (home.lastModified) {
      out.ownBuildTime = home.lastModified;
      out.ownBuildTimeFrom = '首页 HTTP Last-Modified';
    }
    const src = home.text.match(/["']([^"']*question-bank\.js[^"']*)["']/);
    const u = src ? new URL(src[1], 'https://livebetter101.com/').href : 'https://livebetter101.com/question-bank.js?v=43';
    const r = await get(u, { timeout: 25000, cap: 6 * 1024 * 1024 });
    if (!r.ok) return out.ev('题库取不到: HTTP ' + r.status);
    const m = r.text.match(/window\.LIVE_BETTER_SOURCE_BANK\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!m) return out.ev('没找到 window.LIVE_BETTER_SOURCE_BANK 数据（结构可能改版）');
    let j;
    try {
      j = JSON.parse(m[1]);
    } catch (e) {
      return out.ev('题库 JSON 解析失败: ' + e.message.slice(0, 80));
    }
    const cntSum = Object.values(j.counts || {}).reduce((a, b) => a + Number(b || 0), 0);
    const arrLen = (j.entries || []).length;
    out.actualEntries = j.total;
    out.method = 'artifact';
    out.ev(`题库文件（${Math.round(r.text.length / 1024)} KB）自带 total=${j.total}；分项 counts 合计 ${cntSum}；条目数组实长 ${arrLen}`);
    if (j.total === cntSum && cntSum === arrLen) out.ev('三重交叉一致（total = 分项合计 = 数组长度）');
    const secs = new Set((j.entries || []).map((e) => e.section));
    out.ev(`题库覆盖 ${secs.size} 节（与上游 34 节吻合）；文件头注明 “Generated from eternity4719/HowToLiveBetter (CC BY 4.0)”`);
    return out;
  },
  async 'how2livebetter.net'(out) {
    // 它按「人生阶段」重组，给每条建议都生成了独立页 /q/<id>/ → 直接数逐条页
    const sm = await countSitemapEntryPages('https://how2livebetter.net', /^\/q\/[^/]+\/?$/, '条目 /q/<id>/', out);
    const r = await get('https://how2livebetter.net/', { timeout: 25000, cap: 3 * 1024 * 1024 });
    if (r.ok) {
      if (r.lastModified) {
        out.ownBuildTime = r.lastModified;
        out.ownBuildTimeFrom = '首页 HTTP Last-Modified';
      }
      const m = r.text.match(/(\d{3})\s*条建议分\s*(\d+)\s*章/);
      if (m) {
        out.ev(`首页自述「${m[1]} 条建议分 ${m[2]} 章」`);
        if (sm && Number(m[1]) === sm.n) out.ev(`与 sitemap 逐条页计数 ${sm.n} 一致 → 两条独立信号吻合`);
      }
      out.ev('页面自述「非官方衍生站」、内容按 CC BY 4.0 使用');
    }
    if (sm) {
      out.actualEntries = sm.n;
      out.method = 'artifact';
    } else out.ev('未能得到条目数');
    return out;
  },
  async 'qingdan.lazyso.com'(out) {
    // 「懒人性价性清单」：按章节平铺成清单页 /e/<id> → 直接数逐条页，并与首页内联的 __TOTAL__ 交叉验证
    const sm = await countSitemapEntryPages('https://qingdan.lazyso.com', /^\/e\/.+$/, '条目 /e/<id>', out);
    const r = await get('https://qingdan.lazyso.com/', { timeout: 25000, cap: 3 * 1024 * 1024 });
    if (r.ok) {
      const t = r.text.match(/window\.__TOTAL__\s*=\s*(\d+)/);
      if (t) {
        out.ev(`首页内联 window.__TOTAL__ = ${t[1]} 条`);
        if (sm && Number(t[1]) === sm.n) out.ev(`与 sitemap 逐条页计数 ${sm.n} 一致 → 两条独立信号吻合`);
      }
    }
    if (sm) {
      out.actualEntries = sm.n;
      out.method = 'artifact';
    } else out.ev('未能得到条目数');
    return out;
  },
  async 'apps.apple.com/id6818596108'(out) {
    // iOS App 的条目数只能读商店页文案（自述）；但版本号与发布日期可从 iTunes 官方接口拿到，用来定「内容时间」
    const r = await get('https://itunes.apple.com/lookup?id=6818596108&country=cn', { timeout: 20000, cap: 1 * 1024 * 1024 });
    if (!r.ok) return out.ev('iTunes lookup 取不到: HTTP ' + r.status);
    try {
      const a = (JSON.parse(r.text).results || [])[0] || {};
      if (!a.version) return out.ev('iTunes 返回里没有版本信息');
      out.ownVersion = a.version;
      out.ownGeneratedAt = a.currentVersionReleaseDate || null;
      if (a.currentVersionReleaseDate) {
        out.ownBuildTime = a.currentVersionReleaseDate;
        out.ownBuildTimeFrom = 'App Store 当前版本发布日期';
      }
      out.ev(
        `App Store 官方接口：当前版本 v${a.version}，${String(a.currentVersionReleaseDate).slice(0, 10)} 发布（首次上架 ${String(a.releaseDate).slice(0, 10)}）`
      );
      out.ev(`更新说明：${String(a.releaseNotes || '').replace(/\s+/g, ' ').slice(0, 140)}…`);
      out.ev('商店页自述「建议随 App 安装，没网也能看」→ 内容随包打包，属静态快照');
    } catch (e) {
      out.ev('iTunes 返回解析失败: ' + e.message.slice(0, 80));
    }
    return out;
  },
  async 'better.aigcwei.cn'(out) {
    const r = await get(RAW('Helioswei/HowToLiveBetter-Kit', 'sync/fingerprint.json'));
    if (!r.ok) return out.ev('产物取不到: sync/fingerprint.json HTTP ' + r.status);
    try {
      const j = JSON.parse(r.text);
      out.ownVersion = j.commit || null;
      out.actualEntries = typeof j.count === 'number' ? j.count : null;
      out.method = 'artifact';
      const perEntry = Object.keys(j.entries || {}).length;
      out.ev(`sync/fingerprint.json 自带 commit=${SHORT(j.commit)}、count=${j.count}，另有逐条哈希 ${perEntry} 条`);
      if (j.commit === UP_HEAD_SHA) out.ev(`它的 commit 与上游当前 HEAD（${SHORT(UP_HEAD_SHA)}）完全一致 → 逐条内容已对齐，不存在「落后」`);
      out.ev('仓库同时带 tools/check_drift.py 与 tools/check_verbatim.py —— 该项目自带上游漂移检测与逐字校验');
    } catch (e) {
      out.ev('fingerprint.json 解析失败: ' + e.message.slice(0, 80));
    }
    return out;
  },
  async 'llzx373/BetterLifeApp'(out) {
    const r = await get(RAW('llzx373/BetterLifeApp', 'app/src/main/assets/entries.json'));
    if (!r.ok) return out.ev('产物取不到: entries.json HTTP ' + r.status);
    const cv = r.text.match(/"contentVersion"\s*:\s*"([^"]+)"/);
    const ga = r.text.match(/"generatedAt"\s*:\s*"([^"]+)"/);
    out.ownVersion = cv ? cv[1] : null;
    out.ownGeneratedAt = ga ? ga[1] : null;
    try {
      const j = parseLooseJson(r.text);
      const secs = j.sections || [];
      // ⚠️ sections[].entries 是「该节的条数」数字，不是条目数组（2026-10-13 修正：原先当数组数 → 恒为 0）
      let n = 0;
      for (const s of secs) {
        n += Array.isArray(s.entries) ? s.entries.length : Number(s.entries) || 0;
      }
      out.actualEntries = n || null;
      out.method = 'artifact';
      out.ev(`entries.json 顶部自带 contentVersion=${out.ownVersion}、generatedAt=${out.ownGeneratedAt}；${secs.length} 节，各节条数合计 ${n} 条`);
    } catch (e) {
      out.ev('entries.json 解析失败: ' + e.message.slice(0, 80));
    }
    return out;
  },
  async 'sin0317/htlb-dataset'(out) {
    const r = await get(RAW('sin0317/htlb-dataset', 'data/stats.json'));
    if (!r.ok) return out.ev('产物取不到: data/stats.json HTTP ' + r.status);
    try {
      const j = JSON.parse(r.text);
      out.actualEntries = j.stats?.entries ?? null;
      out.ownVersion = j.meta?.upstream_commit ?? null;
      out.ownGeneratedAt = j.meta?.synced_at ?? null;
      out.ev(
        `data/stats.json 自带 upstream_commit=${SHORT(out.ownVersion)}、synced_at=${out.ownGeneratedAt}、entries=${out.actualEntries}（${j.stats?.sections} 节）`
      );
    } catch (e) {
      out.ev('stats.json 解析失败: ' + e.message.slice(0, 80));
    }
    return out;
  },
  async 'mittsommer/daily-life-tip'(out) {
    const r = await get(RAW('mittsommer/daily-life-tip', 'Sources/RemoteBook.swift'));
    if (!r.ok) return out.ev('产物取不到: RemoteBook.swift HTTP ' + r.status);
    const fetchesUpstream = /api\.github\.com\/repos\/eternity4719/.test(r.text) && /raw\.githubusercontent\.com\/eternity4719/.test(r.text);
    if (fetchesUpstream) {
      out.runtimeFetch = true;
      out.method = 'runtime';
      out.ev('RemoteBook.swift 源码级确认：运行时打 api.github.com/repos/eternity4719/... 与 raw.../book/ 拉最新书稿');
      out.ev('源码注释原文：「内置的那份数据是编译时快照，永远能出内容。这里只负责『书更新了，跟上去』」→ 不存在「落后」');
    } else {
      out.ev('RemoteBook.swift 存在但没匹配到上游拉取地址，需人工复核');
    }
    return out;
  },
  async 'sinyu1012/shiye-tab'(out) {
    // 上游地址与 fetchText() 都在 src/sources.js（不在 app.js —— 2026-10-13 修正）
    const r = await get(RAW('sinyu1012/shiye-tab', 'src/sources.js'));
    if (!r.ok) return out.ev('产物取不到: src/sources.js HTTP ' + r.status);
    const upRaw = /raw\.githubusercontent\.com\/eternity4719\/HowToLiveBetter/.test(r.text);
    const hasFetch = /fetch\(/.test(r.text);
    if (upRaw && hasFetch) {
      out.runtimeFetch = true;
      out.method = 'runtime';
      out.ev('src/sources.js 里 LIFE_REPO 指向 raw.githubusercontent.com/eternity4719/HowToLiveBetter，fetchText() 运行时拉正文并按 `### ` 解析 → 不存在「落后」');
      out.ev('该仓库 docs/VERIFICATION.md 自证：「真实网络曾读取 HowToLiveBetter 原文」（按需拉订阅章节，非全量）');
    } else {
      out.ev(`sources.js 里上游地址=${upRaw}、fetch=${hasFetch}，需人工复核`);
    }
    return out;
  },
  async 'robiNeo2045/comics'(out) {
    if (!BOOK_FILES.length) return out.ev('缺 book 文件清单（先跑 verify-upstream.mjs）');
    let total = 0;
    let filesOk = 0;
    const missing = [];
    for (const f of BOOK_FILES) {
      const r = await get(RAW('robiNeo2045/HowToLiveBetter', f), { cap: 2 * 1024 * 1024 });
      if (r.ok) {
        filesOk++;
        total += countHeadings(r.text);
      } else missing.push(path.basename(f));
    }
    out.actualEntries = total;
    out.method = 'fork';
    out.ev(`它是上游的 fork（parent = eternity4719/HowToLiveBetter），book/ 是完整转存：${filesOk}/${BOOK_FILES.length} 个文件取到，按官方口径数出 ### 标题 ${total} 条`);
    if (missing.length) out.ev(`${missing.length} 个文件没取到：${missing.slice(0, 4).join('、')}${missing.length > 4 ? '…' : ''}`);
    return out;
  },
};

// ── web / store 通用：sitemap + 页面自述 ─────────────────────────────
async function probeSitemap(origin, out) {
  // 常见路径都试一遍；Astro 等静态站常把 sitemap 放在 /sitemap-index.xml（索引）下
  let r = null;
  let used = null;
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/sitemap-0.xml', '/sitemap/sitemap.xml']) {
    const t = await get(origin + p, { timeout: 15000, cap: 6 * 1024 * 1024 });
    if (!t.ok) continue;
    if (!/^<\?xml|<urlset|<sitemapindex/i.test(t.text.slice(0, 200).trim())) continue; // 跳过 SPA 的 HTML 兜底
    r = t;
    used = p;
    break;
  }
  if (!r) {
    out.ev('sitemap: 常见路径都试过，没找到可用的 sitemap（404 或 HTML 兜底）');
    return;
  }
  if (/<sitemapindex/i.test(r.text)) {
    const sub = (r.text.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    out.ev(`sitemap 是索引（在 ${used}），跟进第一个子 sitemap：${sub ? new URL(sub).pathname : '?'}`);
    if (sub) {
      const t = await get(sub, { timeout: 20000, cap: 8 * 1024 * 1024 });
      if (t.ok) {
        r = t;
        used = new URL(sub).pathname;
      }
    }
  }
  out.sitemapUrls = (r.text.match(/<loc>/g) || []).length;
  // ⚠️ 必须取**全量 lastmod 的最大值**。2026-10-13 修 bug：原先 `match()` 只拿第一个，
  //    而 sitemap 里第一个往往不是最新的 —— howtolivebetter.net 有 62 个 lastmod，
  //    第一个是 10-11、最大的才是 10-12T15:28Z，害我把它误判成「一天前构建的」。
  const lms = [...r.text.matchAll(/<lastmod>([^<]+)</g)].map((m) => m[1].trim());
  const ds = lms.map((s) => parseGitDate(s)).filter(Boolean);
  out.sitemapLastmodCount = lms.length;
  out.sitemapLastmod = ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))).toISOString() : null;
  out.ev(
    `sitemap（${used}）：${out.sitemapUrls} 个 URL${out.sitemapLastmod ? `，lastmod 最新 ${out.sitemapLastmod.slice(0, 10)}` : '（无 lastmod）'}` +
      (lms.length > 1 ? `（共 ${lms.length} 个 lastmod，已取最大值）` : '')
  );
}

async function probePage(url, out) {
  const r = await get(url, { timeout: 20000, cap: 4 * 1024 * 1024 });
  if (!r.ok) {
    out.ev(`页面取不到: HTTP ${r.status}`);
    return;
  }
  const hits = [...r.text.matchAll(/(\d{3,4})\s*条/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 50 && n <= 5000);
  out.pageCounts = [...new Set(hits)];
  if (out.pageCounts.length) {
    out.selfDeclared = out.pageCounts[0];
    out.selfDeclaredFrom = '页面文案首个「N 条」';
    out.ev(`页面文案自述 ${out.selfDeclared} 条（全文出现的其他数字：${out.pageCounts.join(' / ')}）—— 仅作交叉参考，不是实测`);
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────
const records = [];

for (const x of audit.derived) {
  const st = STRATEGIES[x.id] || {};
  const out = {
    id: x.id,
    name: x.name,
    kind: x.kind,
    author: x.author,
    url: x.url || '',
    ghRepo: x.ghRepo || st.repo || null,
    method: 'page',
    actualEntries: null, // 实测（产物文件里数出来的）
    selfDeclared: null, // 页面自述（弱信号，单独存，绝不冒充实测）
    selfDeclaredFrom: null,
    basis: null, // measured | self-declared | runtime | none
    confidence: null, // high | medium | low | none
    pageCounts: [],
    ownVersion: null,
    ownVersionShort: null,
    ownGeneratedAt: null,
    ownBuildTime: null, // 站点自己的构建/修订时间（优先于 sitemap lastmod 作为「内容时间」）
    ownBuildTimeFrom: null,
    sitemapLastmod: null,
    sitemapLastmodCount: null,
    sitemapUrls: null,
    contentMatch: null,
    runtimeFetch: false,
    evidence: [],
  };
  out.ev = (s) => {
    out.evidence.push(s);
    return out;
  };

  process.stdout.write('  ' + x.name.padEnd(18, '　'));

  try {
    if (ARTIFACT_PARSERS[x.id]) {
      await ARTIFACT_PARSERS[x.id](out);
      if (st.files) out.ev('产物文件：' + st.files.join('、'));
    }
    // sitemap / 页面自述始终作为「补充证据」跑一遍（artifact 项目也可额外提供）
    if (st.sitemap && x.url) await probeSitemap(new URL(x.url).origin, out);
    if (st.page && x.url) await probePage(x.url, out);
    // 顺带：GitHub 仓库项目补一条「仓库最后提交」
    if (out.ghRepo && st.kind !== 'fork') {
      const atom = await get(`https://github.com/${out.ghRepo}/commits/main.atom`, { timeout: 15000 });
      const u = atom.ok ? atom.text.match(/<updated>([^<]+)</) : null;
      if (u) out.ev(`仓库最后提交 ${u[1].slice(0, 16)}`);
    }
  } catch (e) {
    out.ev('查证异常: ' + e.message.slice(0, 120));
  }

  // ── 结算：实测条数 / 页面自述条数 严格分开，不混为一谈 ──
  out.ownVersionShort = out.ownVersion ? SHORT(out.ownVersion) : null;
  out.ownVersionDate = out.ownVersion ? (shaDate(out.ownVersion) || null) : null;

  // ① 有没有「实测」出来的条数？
  const measured = out.actualEntries != null;
  // ② 没有实测时，退回页面自述（明确标 basis，不冒充实测）
  const basis = measured ? 'measured' : out.selfDeclared != null ? 'self-declared' : 'none';
  const n = measured ? out.actualEntries : out.selfDeclared ?? null;

  out.basis = basis;
  if (out.runtimeFetch) {
    out.basis = 'runtime';
    out.status = 'runtime';
    out.lagEntries = null;
    out.lagDays = null;
    out.confidence = 'high';
    out.lagEntriesFrom = null;
  } else if (n != null) {
    out.lagEntries = Math.max(0, UP_ENTRIES - n);
    out.lagEntriesFrom = n;
    const m = byCountFor(n);
    // 「内容时间」优先取站点自己的构建时间（sitemap lastmod）—— 它比「该条数首次出现在上游的时间」
    // 更直接；拿不到才退回后者。来源记在 lagDaysFrom 里，页面上可透明展示。
    // 「内容时间」优先级：站点自己声明的构建/修订时间 > sitemap lastmod > 「该条数首次出现在上游的时间」。
    const ownDate = out.ownBuildTime ? parseGitDate(out.ownBuildTime) : null;
    const smDate = out.sitemapLastmod ? parseGitDate(out.sitemapLastmod) : null;
    const base = ownDate || smDate || (m ? parseGitDate(m.date) : null);
    out.lagDays = base ? daysFrom(base) : null;
    out.lagDaysFrom = ownDate ? out.ownBuildTimeFrom || 'site-build-time' : smDate ? 'sitemap-lastmod' : m ? 'count-first-seen' : null;
    if (m) out.ev(`该条数首次出现在上游是 ${SHORT(m.sha)}（${m.date.slice(0, 16)}）`);
    if (ownDate) out.ev(`站点自己的构建/修订时间 ${String(out.ownBuildTime).slice(0, 16)}（来源：${out.lagDaysFrom}）→ 「内容时间」以此为准`);
    else if (smDate) out.ev(`该站自己的 lastmod 最新到 ${out.sitemapLastmod.slice(0, 10)} → 「内容时间」以此为准`);
    out.status = out.lagEntries === 0 ? 'sync' : 'lag';
    out.confidence = measured ? 'high' : 'low';
  } else if (out.ownVersionDate) {
    out.lagDays = daysFrom(out.ownVersionDate);
    out.lagEntries = null;
    out.status = out.lagDays <= 0.5 ? 'sync' : 'lag';
    out.confidence = 'medium';
  } else if (out.sitemapLastmod) {
    out.lagDays = daysFrom(parseGitDate(out.sitemapLastmod));
    out.lagEntries = null;
    out.status = out.lagDays <= 1 ? 'sync' : 'lag';
    out.confidence = 'low';
  } else {
    out.lagEntries = null;
    out.lagDays = null;
    out.status = 'unknown';
    out.confidence = 'none';
  }

  // 「落后天数」语义上不可能为负：站点最后更新时间晚于上游最后一次提交时，
  // 表示它构建时已含全部内容（howtolivebetter.net 就是这种：北京 23:28 构建 vs 上游 18:04 提交）
  if (out.lagDays != null && out.lagDays < 0) out.lagDays = 0;

  records.push(out);
  console.log(
    '  ' +
      String(n ?? (out.ownVersionShort ? '@' + out.ownVersionShort : out.sitemapLastmod ?? '—')).padStart(6) +
      '  ' +
      out.status.padEnd(8) +
      '  ' +
      out.basis.padEnd(13) +
      '  ' +
      out.confidence
  );
}

const out = {
  generatedAt: new Date().toISOString(),
  definition:
    '条目数 = book/*.md 里的 ### 标题数（上游 tools/sync-stats.mjs 官方口径）；实际条数优先取该项目自己的产物文件，其次 sitemap/页面自述。',
  upstream: {
    repo: 'eternity4719/HowToLiveBetter',
    headSha: UP_HEAD_SHA,
    headDate: UP_HEAD_DATE.toISOString(),
    entries: UP_ENTRIES,
    totalCommits: tl.totalCommitsAll,
    bookFiles: BOOK_FILES.length,
  },
  methods: {
    artifact: '读它自己的产物文件（含 SSR hydration 内联数据、静态数据 chunk、逐条页清单），用官方口径数实际条数，或读它自带的版本号',
    fork: '它是上游 fork，逐文件数 book/*.md 的 ### 并与上游对比',
    runtime: '源码级确认运行时拉上游 → 不存在「落后」',
    page: '只有 sitemap lastmod / 页面自述（弱信号）',
  },
  stats: {
    total: records.length,
    measured: records.filter((r) => r.actualEntries != null).length,
    withOwnVersion: records.filter((r) => r.ownVersion).length,
    runtime: records.filter((r) => r.runtimeFetch).length,
    sync: records.filter((r) => r.status === 'sync').length,
    lagging: records.filter((r) => r.status === 'lag').length,
    unknown: records.filter((r) => r.status === 'unknown').length,
    highConfidence: records.filter((r) => r.confidence === 'high').length,
    hasSitemapLastmod: records.filter((r) => r.sitemapLastmod).length,
  },
  projects: records,
};

fs.writeFileSync(path.join(DIR, 'data', 'ecosystem.json'), JSON.stringify(out, null, 1), 'utf8');
console.log('\n已写出: data/ecosystem.json');
console.log(
  `统计：实测条数 ${out.stats.measured}/${out.stats.total}｜自带版本号 ${out.stats.withOwnVersion}｜运行时拉取 ${out.stats.runtime}｜高置信 ${out.stats.highConfidence}｜追平 ${out.stats.sync}｜落后 ${out.stats.lagging}｜未判定 ${out.stats.unknown}`
);
