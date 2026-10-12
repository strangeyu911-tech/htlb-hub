/**
 * htlb-hub Cloudflare Worker —— 聚合站 + 动态 badge 接口
 *
 * 路由：
 *   GET  /                      聚合站首页（内嵌静态 HTML 作兜底，页面加载后用 /api/status.json 覆写为实时值）
 *   GET  /badge/<slug>.svg      动态同步状态徽章（数字实时）
 *   GET  /badge/                全部徽章一览
 *   GET  /api/status.json       机器可读状态（页面就靠它刷新）
 *   GET  /api/upstream.json     上游实时指纹
 *   GET  /api/ingest            看 KV 里有没有被回灌过、什么时候
 *   POST /api/ingest            接收 GitHub Actions 的每日重算结果（需 X-Ingest-Secret）
 *   GET  /health
 *
 * 数据来源两层：
 *   ① KV（key = ecosystem）—— 由 GitHub Actions 每天重算后 POST 回灌，是权威源
 *   ② 内嵌 DATA —— 部署时打进 worker 的快照，KV 为空时的兜底
 * 动态性来源：每次请求去上游取一次最新条目数（边缘缓存 10 分钟），
 * 再和各项目「实际/自述条数」相减，得到落后条数。上游一更新，徽章自动变。
 *
 * 本文件由 build-worker.mjs 生成，请不要直接改 deploy/worker.js。
 */
const HTML = /*__HTML__*/ '';
const DATA = /*__DATA__*/ { upstream: {}, projects: [] };

const CACHE_SECONDS = 600;
const ORIGIN = 'https://htlb.strangeyu.xyz';
const KV_KEY = 'ecosystem';

const README_URL = DATA.upstream.readmeRaw;
const ATOM_URL = 'https://github.com/' + DATA.upstream.repo + '/commits/main.atom';

let _live = null;
let _liveAt = 0;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function badge(left, right, color) {
  const cw = (s) => Math.round(s.length * 6.4 + 12);
  const lw = cw(left);
  const rw = cw(right);
  const W = lw + rw;
  const lx = (lw / 2) * 10;
  const rx = (lw + rw / 2) * 10;
  const L = esc(left);
  const R = esc(right);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="20" viewBox="0 0 ' + W * 10 + ' 200" role="img" aria-label="' + L + ': ' + R + '">' +
    '<title>' + L + ': ' + R + '</title>' +
    '<g><rect width="' + lw * 10 + '" height="200" fill="#5f5e5a"/>' +
    '<rect x="' + lw * 10 + '" width="' + rw * 10 + '" height="200" fill="' + color + '"/>' +
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110">' +
    '<text x="' + lx + '" y="140" fill="#010101" fill-opacity=".3" transform="scale(.1)">' + L + '</text>' +
    '<text x="' + lx + '" y="130" transform="scale(.1)">' + L + '</text>' +
    '<text x="' + rx + '" y="140" fill="#010101" fill-opacity=".3" transform="scale(.1)">' + R + '</text>' +
    '<text x="' + rx + '" y="130" transform="scale(.1)">' + R + '</text>' +
    '</g></g></svg>'
  );
}

/** 两层数据：KV 优先，内嵌兜底 */
async function getData(env) {
  if (env && env.HTLB_KV) {
    try {
      const kv = await env.HTLB_KV.get(KV_KEY, 'json');
      if (kv && Array.isArray(kv.projects) && kv.projects.length) {
        return { upstream: kv.upstream || DATA.upstream, projects: kv.projects, generatedAt: kv.generatedAt, source: 'kv', pushedAt: kv.pushedAt || null };
      }
    } catch {
      /* KV 不可用就当没有 */
    }
  }
  return { upstream: DATA.upstream, projects: DATA.projects, generatedAt: DATA.generatedAt, source: 'embedded', pushedAt: null };
}

/** 算「落后多少条」：实测优先，自述次之；用实时上游条目数重算。
 *  ⚠️ 三种非条数型状态必须在这里显式短路，否则会被当成「未标注」：
 *     runtime = 运行时拉上游（不存在落后）；fixed = 作者声明固定快照。 */
function statusOf(p, upEntries) {
  if (p.status === 'runtime') return { kind: 'runtime', lag: null, n: null };
  if (p.status === 'fixed') {
    return { kind: 'fixed', lag: null, n: p.actualEntries != null ? p.actualEntries : p.selfDeclared != null ? p.selfDeclared : null };
  }
  const n = p.actualEntries != null ? p.actualEntries : p.selfDeclared != null ? p.selfDeclared : null;
  if (n == null) return { kind: 'unknown', lag: null, n: null };
  const lag = Math.max(0, upEntries - n);
  return { kind: lag === 0 ? 'sync' : 'lag', lag, n };
}

function badgeFor(p, upEntries) {
  const s = statusOf(p, upEntries);
  if (s.kind === 'runtime') return badge('高性价比人生指南', '运行时跟随上游', '#1d9e75');
  if (s.kind === 'fixed') return badge('高性价比人生指南', '固定快照 ' + s.n + ' 条', '#888780');
  if (s.kind === 'unknown') return badge('高性价比人生指南', '版本未标注', '#a32d2d');
  if (s.kind === 'sync') return badge('高性价比人生指南', '已同步 · ' + s.n + ' 条', '#1d9e75');
  return badge('高性价比人生指南', '落后 ' + s.lag + ' 条 · ' + s.n + '/' + upEntries, '#ba7517');
}

/** 全局边缘缓存键（Cache API 跨 isolate / 跨 colo 生效） */
const CACHE_KEY = 'https://htlb-cache.internal/upstream-live.json';
const hasCache = typeof caches !== 'undefined' && caches.default;

/** 取上游实时指纹：README 里的条目数 + Atom feed 的最新提交时间。都不需要 token、无速率限制。 */
async function fetchLive(ctx) {
  const now = Date.now();
  if (_live && now - _liveAt < CACHE_SECONDS * 1000) return _live;

  if (hasCache) {
    try {
      const hit = await caches.default.match(CACHE_KEY);
      if (hit) {
        _live = await hit.json();
        _liveAt = now;
        return _live;
      }
    } catch {
      /* 缓存不可用就当没有 */
    }
  }

  const get = async (url) => {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'htlb-hub/2.0 (+' + ORIGIN + ')' } });
      if (!r.ok) return null;
      return await r.text();
    } catch {
      return null;
    }
  };

  const [readme, atom] = await Promise.all([get(README_URL), get(ATOM_URL)]);

  let entries = null;
  if (readme) {
    const m =
      readme.match(/(\d{2,4})\s*条建议/) ||
      readme.match(/全书\s*(\d{2,4})\s*条/) ||
      readme.match(/%E6%9D%A1%E7%9B%AE-(\d{2,4})/) ||
      readme.match(/badge\/[^)\s]*?-(\d{2,4})%20/);
    if (m) entries = Number(m[1]);
  }

  let lastCommitAt = null;
  let lastSha = null;
  if (atom) {
    const u = atom.match(/<updated>([^<]+)<\/updated>/);
    if (u) lastCommitAt = u[1];
    const idm = atom.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{7,40})<\/id>/);
    if (idm) lastSha = idm[1];
  }

  _live = { entries, lastCommitAt, lastSha, fetchedAt: new Date().toISOString(), ok: entries != null };
  _liveAt = now;

  if (hasCache && entries != null) {
    const put = caches.default
      .put(
        CACHE_KEY,
        new Response(JSON.stringify(_live), {
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + CACHE_SECONDS },
        })
      )
      .catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return _live;
}

function statusPayload(data, live) {
  const upEntries = live && live.entries ? live.entries : data.upstream.entries;
  const norm = data.projects.map((p) => {
    const s = statusOf(p, upEntries);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      kind: p.kind,
      author: p.author,
      url: p.url,
      status: s.kind,
      lag: s.lag,
      entries: s.n,
      actualEntries: p.actualEntries != null ? p.actualEntries : null,
      selfDeclared: p.selfDeclared != null ? p.selfDeclared : null,
      basis: p.basis || null,
      confidence: p.confidence || null,
      runtimeFetch: !!p.runtimeFetch,
      ownVersion: p.ownVersionShort || null,
      ownVersionDate: p.ownVersionDate || null,
      sitemapLastmod: p.sitemapLastmod || null,
      lagDays: p.lagDays != null ? p.lagDays : null,
      reachable: p.total ? p.ok + '/' + p.total : null,
      avgMs: p.avg || null,
      cdn: p.cdn || null,
      badge: ORIGIN + '/badge/' + p.slug + '.svg',
    };
  });
  const withN = norm.filter((p) => p.entries != null);
  return {
    generatedAt: data.generatedAt,
    servedAt: new Date().toISOString(),
    dataSource: data.source,
    lastCrawlAt: data.pushedAt,
    upstream: {
      repo: data.upstream.repo,
      license: data.upstream.license,
      entries: upEntries,
      entriesLive: !!(live && live.entries),
      snapshotEntries: data.upstream.entries,
      headSha: (live && live.lastSha) || data.upstream.headSha,
      lastCommitAt: (live && live.lastCommitAt) || null,
      url: 'https://github.com/' + data.upstream.repo,
    },
    stats: {
      projects: norm.length,
      reachable: data.projects.reduce((a, p) => a + (p.ok || 0), 0),
      probes: data.projects.reduce((a, p) => a + (p.total || 0), 0),
      measured: norm.filter((p) => p.actualEntries != null).length,
      selfDeclaredOnly: norm.filter((p) => p.actualEntries == null && p.selfDeclared != null).length,
      runtime: norm.filter((p) => p.status === 'runtime').length,
      fixed: norm.filter((p) => p.status === 'fixed').length,
      synced: norm.filter((p) => p.status === 'sync').length,
      lagging: norm.filter((p) => p.status === 'lag').length,
      unknown: norm.filter((p) => p.status === 'unknown').length,
      maxLag: withN.length ? Math.max(...withN.map((p) => p.lag || 0)) : 0,
      withOwnVersion: norm.filter((p) => p.ownVersion).length,
    },
    projects: norm,
  };
}

function badgeIndex(data, live) {
  const upEntries = live && live.entries ? live.entries : data.upstream.entries;
  const rows = data.projects
    .map((p) => {
      const s = statusOf(p, upEntries);
      const label =
        s.kind === 'runtime' ? '运行时跟随上游'
          : s.kind === 'fixed' ? '固定快照（作者声明不自动同步）'
            : s.kind === 'unknown' ? '未标注版本'
              : s.kind === 'sync' ? '已追平' : '落后 ' + s.lag + ' 条';
      return (
        '<li><img src="/badge/' + p.slug + '.svg" height="20" alt="' + esc(p.name) + '"> ' +
        '<a href="' + esc(p.url) + '">' + esc(p.name) + '</a> <code>' + esc(p.slug) + '</code> · ' + label +
        '</li>'
      );
    })
    .join('');
  return (
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>同步状态徽章 · 高性价比人生指南墙内聚合</title>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:15px/1.9 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#2c2c2a;background:#faf9f7}' +
    'code{background:#f4f2ee;padding:1px 5px;border-radius:4px;font-size:12.5px}a{color:#185fa5}li{margin-bottom:10px}img{vertical-align:middle}</style></head><body>' +
    '<h1>同步状态徽章</h1><p>上游当前 <b>' + upEntries + '</b> 条' + (live && live.entries ? '（实时）' : '（快照）') +
    '，数据源 <code>' + data.source + '</code>。用法：<code>![同步状态](' + ORIGIN + '/badge/&lt;slug&gt;.svg)</code></p>' +
    '<ul>' + rows + '</ul>' +
    '<p><a href="/">← 回到聚合站</a> · <a href="/api/status.json">/api/status.json</a></p></body></html>'
  );
}

const SVG_HEADERS = { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=' + CACHE_SECONDS + ', s-maxage=' + CACHE_SECONDS };
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60, s-maxage=' + CACHE_SECONDS };
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' };
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

const json = (o, status = 200, headers = JSON_HEADERS) => new Response(JSON.stringify(o, null, 2), { status, headers });

/** GitHub Actions 每天把重算结果写进来 */
async function handleIngest(request, env, data) {
  if (!env || !env.HTLB_KV) return json({ ok: false, error: 'no KV binding' }, 500);
  if (request.method === 'GET') {
    const cur = await getData(env);
    return json({
      ok: true,
      hasKVData: cur.source === 'kv',
      pushedAt: cur.pushedAt,
      projects: cur.projects.length,
      hint: 'POST 需要 X-Ingest-Secret 头',
    });
  }
  const secret = request.headers.get('x-ingest-secret') || '';
  if (!env.INGEST_SECRET || secret.length < 16 || secret !== env.INGEST_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid json' }, 400);
  }
  if (!body || !Array.isArray(body.projects) || !body.projects.length) {
    return json({ ok: false, error: 'projects[] required' }, 400);
  }
  const payload = {
    generatedAt: body.generatedAt || new Date().toISOString(),
    upstream: body.upstream || {},
    stats: body.stats || {},
    projects: body.projects,
    pushedAt: new Date().toISOString(),
    pushedFrom: request.headers.get('user-agent') || '',
  };
  const size = JSON.stringify(payload).length;
  if (size > 24 * 1024 * 1024) return json({ ok: false, error: 'payload too large: ' + size }, 413);
  await env.HTLB_KV.put(KV_KEY, JSON.stringify(payload));
  return json({ ok: true, projects: payload.projects.length, bytes: size, pushedAt: payload.pushedAt });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname;

  if (p === '/api/ingest') return handleIngest(request, env, null);

  if (p === '/' || p === '/index.html') {
    return new Response(HTML, { headers: HTML_HEADERS });
  }

  if (p === '/health') {
    const [live, data] = await Promise.all([fetchLive(ctx), getData(env)]);
    return json({ ok: true, live: live.ok, entries: live.entries, dataSource: data.source, projects: data.projects.length, lastCrawlAt: data.pushedAt });
  }

  if (p === '/api/status.json' || p === '/api/status') {
    const [live, data] = await Promise.all([fetchLive(ctx), getData(env)]);
    return json(statusPayload(data, live));
  }

  if (p === '/api/upstream.json') {
    const live = await fetchLive(ctx);
    return json(Object.assign({ repo: DATA.upstream.repo }, live));
  }

  if (p === '/badge' || p === '/badge/') {
    const [live, data] = await Promise.all([fetchLive(ctx), getData(env)]);
    return new Response(badgeIndex(data, live), { headers: HTML_HEADERS });
  }

  const bm = p.match(/^\/badge\/([a-z0-9-]+)\.svg$/i);
  if (bm) {
    const slug = bm[1].toLowerCase();
    const [live, data] = await Promise.all([fetchLive(ctx), getData(env)]);
    const proj = data.projects.find((x) => x.slug === slug);
    if (!proj) return new Response(badge('高性价比人生指南', '未知项目', '#a32d2d'), { status: 404, headers: SVG_HEADERS });
    const upEntries = live && live.entries ? live.entries : data.upstream.entries;
    return new Response(badgeFor(proj, upEntries), { headers: SVG_HEADERS });
  }

  if (p === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: TEXT_HEADERS });

  return new Response('404 Not Found\n可访问：/ · /badge/ · /badge/<slug>.svg · /api/status.json · /api/upstream.json · /health\n', {
    status: 404,
    headers: TEXT_HEADERS,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD' && !(request.method === 'POST' && new URL(request.url).pathname === '/api/ingest')) {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD, POST /api/ingest' } });
    }
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      return new Response('Internal Error: ' + (e && e.message ? e.message : 'unknown'), { status: 500, headers: TEXT_HEADERS });
    }
  },
};
