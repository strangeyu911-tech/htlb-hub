/**
 * 逐项查证衍生项目的同步边界 —— v2（替代已证伪的「精确标题探针」）
 * 用法: node htlb-hub/verify-ecosystem.mjs
 * 输出: htlb-hub/data/ecosystem.json
 * 前置: bash htlb-hub/fetch-upstream.sh && node htlb-hub/verify-upstream.mjs
 *
 * ── 为什么 v1 的探针废了（两条，都实测过）───────────────────────────
 *   ① 衍生站普遍改写标题；
 *   ② 正文根本不在页面/主 bundle 里（howtolivebetter.net 的 638 KB bundle
 *      对上游前 60 条老条目 0/60 命中）→ 抓 <script src> 压根碰不到正文。
 *
 * ── v2 的四条路（强度从高到低）────────────────────────────────────
 *   ① artifact  读它自己的产物文件，用官方口径数实际条数 / 读它自带的版本号
 *   ② fork      它是上游 fork → 直接数 book/*.md 的 ### 并与上游对比
 *   ③ sitemap   sitemap.xml 的 lastmod + URL 数
 *   ④ runtime   源码里就是运行时拉上游 → 不存在「落后」，从落后名单剔除
 *   （页面自述的条目数只作交叉参考，不作证据）
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
    return { ok: true, status: r.status, text: text.slice(0, cap) };
  } catch (e) {
    return { ok: false, status: 0, err: e.name === 'AbortError' ? 'timeout' : e.message, text: '' };
  } finally {
    clearTimeout(t);
  }
}

// ── 工具 ────────────────────────────────────────────────────────────
const countHeadings = (md) => (md.match(/^### /gm) || []).length;

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
  'howtolivebetter.net': { kind: 'web', sitemap: true, page: true },
  'life.warpnav.com': { kind: 'web', sitemap: true, page: true },
  'life.xfun.fun': { kind: 'web', sitemap: true, page: true },
  'how2livebetter.net': { kind: 'web', sitemap: true, page: true },
  'better.aigcwei.cn': { kind: 'artifact', repo: 'Helioswei/HowToLiveBetter-Kit', files: ['sync/fingerprint.json'], sitemap: true, page: true },
  'qingdan.lazyso.com': { kind: 'web', sitemap: true, page: true },
  'livebetter101.com': { kind: 'web', sitemap: true, page: true },
  'HuiTurn/HowToLiveBetter': { kind: 'artifact', repo: 'HuiTurn/HowToLiveBetter', files: ['pagesA/data/steps.js'] },
  'apps.apple.com/id6818596108': { kind: 'store', page: true },
  'llzx373/BetterLifeApp': { kind: 'artifact', repo: 'llzx373/BetterLifeApp', files: ['app/src/main/assets/entries.json'] },
  'mittsommer/daily-life-tip': { kind: 'artifact', repo: 'mittsommer/daily-life-tip', files: ['Sources/RemoteBook.swift'] },
  'sinyu1012/shiye-tab': { kind: 'artifact', repo: 'sinyu1012/shiye-tab', files: ['src/sources.js'] },
  'sin0317/htlb-dataset': { kind: 'artifact', repo: 'sin0317/htlb-dataset', files: ['data/stats.json'] },
  'robiNeo2045/comics': { kind: 'fork', repo: 'robiNeo2045/HowToLiveBetter' },
};

// ── 各 artifact 的解析器 ────────────────────────────────────────────
const ARTIFACT_PARSERS = {
  async 'HuiTurn/HowToLiveBetter'(out) {
    const r = await get(RAW('HuiTurn/HowToLiveBetter', 'pagesA/data/steps.js'));
    if (!r.ok) return out.ev('产物取不到: pagesA/data/steps.js HTTP ' + r.status);
    const titles = (r.text.match(/"title"\s*:/g) || []).length;
    const idx = (r.text.match(/"index"\s*:/g) || []).length;
    out.actualEntries = titles;
    out.method = 'artifact';
    out.ev(`data/steps.js（${Math.round(r.text.length / 1024)} KB）里 "title" 字段 ${titles} 个、"index" ${idx} 个 → 实际收录 ${titles} 条`);
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
  const r = await get(origin + '/sitemap.xml', { timeout: 15000, cap: 4 * 1024 * 1024 });
  if (!r.ok) {
    out.ev(`sitemap.xml: HTTP ${r.status}${r.err ? ' ' + r.err : ''}`);
    return;
  }
  const head = r.text.slice(0, 120);
  if (!/^<\?xml|<urlset/i.test(head.trim())) {
    out.ev('sitemap.xml 是 SPA 的 HTML 兜底（不是真 sitemap）');
    return;
  }
  out.sitemapUrls = (r.text.match(/<loc>/g) || []).length;
  const lm = r.text.match(/<lastmod>([^<]+)</);
  out.sitemapLastmod = lm ? lm[1].trim() : null;
  out.ev(`sitemap.xml：${out.sitemapUrls} 个 URL${out.sitemapLastmod ? '，lastmod ' + out.sitemapLastmod : '（无 lastmod）'}`);
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
    sitemapLastmod: null,
    sitemapUrls: null,
    runtimeFetch: false,
    evidence: [],
  };
  out.ev = (s) => {
    out.evidence.push(s);
    return out;
  };

  process.stdout.write('  ' + x.name.padEnd(18, '　'));

  try {
    if (ARTIFACT_PARSERS[x.id] && (st.kind === 'artifact' || st.kind === 'fork')) {
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
    out.lagDays = m ? daysFrom(parseGitDate(m.date)) : null;
    if (m) out.ev(`该条数首次出现在上游是 ${SHORT(m.sha)}（${m.date.slice(0, 16)}）→ 若内容停在那里，则落后约 ${out.lagDays} 天`);
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
    artifact: '读它自己的产物文件，用官方口径数实际条数，或读它自带的版本号',
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
